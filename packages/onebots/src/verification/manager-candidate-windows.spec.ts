import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createGenerationPlan } from "../installation/generation-plan.js";
import { verifyGeneration } from "../installation/generation-verify.js";

const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync }));
vi.mock("../installation/generation-verify.js", () => ({ verifyGeneration: vi.fn() }));
vi.mock("../service-host.js", () => ({
    createDefaultServiceHost: () => ({ windowsSid: "S-1-5-18" }),
}));
vi.mock("../windows-service-security.js", () => ({
    secureWindowsServiceDirectory: (_host: unknown, directory: string) =>
        fs.mkdirSync(directory, { recursive: true }),
}));

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("Windows 在一个 native Job Object worker 内完成通用和管理候选验证", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-manager-windows-"));
    roots.push(root);
    const candidate = path.join(root, "candidate");
    const privateRoot = path.join(root, "private");
    fs.mkdirSync(candidate);
    const plan = createGenerationPlan({
        host: { name: "onebots", version: "1.2.12", spec: "1.2.12" },
        core: { name: "@onebots/core", version: "1.2.9", spec: "1.2.9" },
        extensions: [],
        selection: { adapters: [], protocols: [], applications: [] },
    });
    const originalStatSync = fs.statSync.bind(fs);
    vi.spyOn(fs, "statSync").mockImplementation(file => {
        if (String(file).endsWith("onebots-windows-host.exe"))
            return { isFile: () => true, size: 100_001 } as fs.Stats;
        return originalStatSync(file);
    });
    spawnSync.mockImplementation((_executable: string, args: string[]) => {
        const request = args[args.indexOf("--request") + 2];
        const result = args[args.indexOf("--result") + 2];
        const input = JSON.parse(fs.readFileSync(request, "utf8"));
        expect(input.plan).toEqual(plan);
        fs.writeFileSync(
            result,
            JSON.stringify({
                schemas: JSON.stringify({
                    schemaVersion: 1,
                    adapters: {},
                    protocols: {},
                    applications: {},
                    runtimeOnly: [],
                }),
                verification: input.expected,
            }),
        );
        return { status: 1, signal: null };
    });
    const { verifyManagerCandidateInstallation } = await import("./manager-candidate.js");
    const verification = await verifyManagerCandidateInstallation(candidate, plan, {
        privateRoot,
    });
    expect(verifyGeneration).not.toHaveBeenCalled();
    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(verification.dependencies.checks).toEqual({
        packageIdentity: true,
        peerDependencies: true,
        singleHost: true,
        loadRegistration: true,
        schemas: true,
    });
    expect(verification.management.checks.closed).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(candidate, "schemas.json"), "utf8"))).toMatchObject(
        {
            schemaVersion: 1,
        },
    );
});

it("Windows worker 固定失败阶段保留在私有验证目录且不被当成成功", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-manager-windows-failure-"));
    roots.push(root);
    const candidate = path.join(root, "candidate");
    const privateRoot = path.join(root, "private");
    fs.mkdirSync(candidate);
    const plan = createGenerationPlan({
        host: { name: "onebots", version: "1.2.12", spec: "1.2.12" },
        core: { name: "@onebots/core", version: "1.2.9", spec: "1.2.9" },
        extensions: [],
        selection: { adapters: [], protocols: [], applications: [] },
    });
    const originalStatSync = fs.statSync.bind(fs);
    vi.spyOn(fs, "statSync").mockImplementation(file => {
        if (String(file).endsWith("onebots-windows-host.exe"))
            return { isFile: () => true, size: 100_001 } as fs.Stats;
        return originalStatSync(file);
    });
    spawnSync.mockImplementation((_executable: string, args: string[]) => {
        const result = args[args.indexOf("--result") + 2];
        fs.writeFileSync(result, JSON.stringify({ failed: true, stage: "management-startup" }));
        return { status: 1, signal: null };
    });

    const { verifyManagerCandidateInstallation } = await import("./manager-candidate.js");
    await expect(
        verifyManagerCandidateInstallation(candidate, plan, { privateRoot }),
    ).rejects.toThrow("Windows 管理程序候选未通过 Job Object 隔离验证");
    const allocations = fs.readdirSync(privateRoot);
    expect(allocations).toHaveLength(1);
    expect(
        JSON.parse(fs.readFileSync(path.join(privateRoot, allocations[0], "result.json"), "utf8")),
    ).toEqual({ failed: true, stage: "management-startup" });
});

it("Windows native watchdog 超时保留父原因和 worker 最后完整阶段", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-manager-windows-timeout-"));
    roots.push(root);
    const candidate = path.join(root, "candidate");
    const privateRoot = path.join(root, "private");
    fs.mkdirSync(candidate);
    const plan = createGenerationPlan({
        host: { name: "onebots", version: "1.2.12", spec: "1.2.12" },
        core: { name: "@onebots/core", version: "1.2.9", spec: "1.2.9" },
        extensions: [],
        selection: { adapters: [], protocols: [], applications: [] },
    });
    const originalStatSync = fs.statSync.bind(fs);
    vi.spyOn(fs, "statSync").mockImplementation(file => {
        if (String(file).endsWith("onebots-windows-host.exe"))
            return { isFile: () => true, size: 100_001 } as fs.Stats;
        return originalStatSync(file);
    });
    spawnSync.mockImplementation((_executable: string, args: string[]) => {
        const result = args[args.indexOf("--result") + 2];
        fs.writeFileSync(
            path.join(path.dirname(result), "checkpoint-01-dependencies.json"),
            JSON.stringify({ schemaVersion: 1, stage: "dependencies" }),
        );
        return {
            status: null,
            signal: "SIGTERM",
            error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
        };
    });

    const { verifyManagerCandidateInstallation } = await import("./manager-candidate.js");
    await expect(
        verifyManagerCandidateInstallation(candidate, plan, { privateRoot, timeoutMs: 10 }),
    ).rejects.toThrow("Windows 管理程序候选未通过 Job Object 隔离验证");
    const allocation = path.join(privateRoot, fs.readdirSync(privateRoot)[0]);
    expect(
        JSON.parse(fs.readFileSync(path.join(allocation, "parent-failure.json"), "utf8")),
    ).toEqual({ schemaVersion: 1, reason: "native-timeout" });
    expect(
        JSON.parse(
            fs.readFileSync(path.join(allocation, "checkpoint-01-dependencies.json"), "utf8"),
        ),
    ).toEqual({ schemaVersion: 1, stage: "dependencies" });
    expect(fs.existsSync(path.join(allocation, "result.json"))).toBe(false);
});

it("Windows schemas 提交失败时不清理 native 验证证据", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-manager-windows-schema-"));
    roots.push(root);
    const candidate = path.join(root, "candidate");
    const privateRoot = path.join(root, "private");
    fs.mkdirSync(candidate);
    fs.mkdirSync(path.join(candidate, "schemas.json"));
    const plan = createGenerationPlan({
        host: { name: "onebots", version: "1.2.12", spec: "1.2.12" },
        core: { name: "@onebots/core", version: "1.2.9", spec: "1.2.9" },
        extensions: [],
        selection: { adapters: [], protocols: [], applications: [] },
    });
    const originalStatSync = fs.statSync.bind(fs);
    vi.spyOn(fs, "statSync").mockImplementation(file => {
        if (String(file).endsWith("onebots-windows-host.exe"))
            return { isFile: () => true, size: 100_001 } as fs.Stats;
        return originalStatSync(file);
    });
    spawnSync.mockImplementation((_executable: string, args: string[]) => {
        const request = args[args.indexOf("--request") + 2];
        const result = args[args.indexOf("--result") + 2];
        const input = JSON.parse(fs.readFileSync(request, "utf8"));
        fs.writeFileSync(
            result,
            JSON.stringify({
                schemas: JSON.stringify({
                    schemaVersion: 1,
                    adapters: {},
                    protocols: {},
                    applications: {},
                    runtimeOnly: [],
                }),
                verification: input.expected,
            }),
        );
        return { status: 1, signal: null };
    });
    const { verifyManagerCandidateInstallation } = await import("./manager-candidate.js");
    await expect(
        verifyManagerCandidateInstallation(candidate, plan, { privateRoot }),
    ).rejects.toThrow("Windows 管理程序候选未通过 Job Object 隔离验证");
    const allocation = path.join(privateRoot, fs.readdirSync(privateRoot)[0]);
    expect(
        JSON.parse(fs.readFileSync(path.join(allocation, "parent-failure.json"), "utf8")),
    ).toEqual({ schemaVersion: 1, reason: "schema-commit" });
    expect(fs.existsSync(path.join(allocation, "result.json"))).toBe(true);
    expect(fs.lstatSync(path.join(candidate, "schemas.json")).isDirectory()).toBe(true);
});
