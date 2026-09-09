import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlManagerService } from "./manager-service-controller.js";
import { installManagerServiceWhileLocked, type ManagerServiceInstallDependencies } from "./manager-service-install.js";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import { randomUUID } from "node:crypto";
import { LAUNCHD_LABEL } from "./service-definition.js";
import { getServiceFiles } from "./service-files.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import {
    readServiceMigrationPending,
    prepareServiceMigrationWorkspace,
    releaseServiceMigrationPending,
} from "./service-migration-workspace.js";
import {
    prepareServiceProcessOwnershipSeed,
    claimServiceProcessOwnership,
} from "./service-migration-processes.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import type { ServiceHost } from "./service-host.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServicePlatform } from "./service-platform.js";
// 仅测试安装事务；产品入口必须先完成 bootstrap 候选验证。
async function installManagerService(spec: ManagerServiceSpec, host: ServiceHost, dependencies: ManagerServiceInstallDependencies) {
    const release = acquireServiceMigrationLock(getServiceFiles(spec.scope, host).stateDir);
    try { return await installManagerServiceWhileLocked(spec, randomUUID(), host, dependencies); }
    finally { release(); }
}
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(platformName: "linux" | "darwin" = "linux") {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/manager-install-integration-"));
    roots.push(root);
    const controls = { absent: true, failReload: false };
    const queries: string[] = [];
    const effects: string[] = [];
    const host: ServiceHost = {
        platform: platformName,
        uid: process.getuid?.(),
        homedir: root,
        env: {},
        exec: (file, args) => {
            if (args.length === 1 && args[0] === "--version") return "v24.0.0";
            if (file === "/bin/launchctl" && args[0] === "print") {
                queries.push("presence");
                if (!controls.absent) return "existing";
                throw Object.assign(new Error("not found"), {
                    status: 113,
                    stderr: `Bad request.\nCould not find service "${LAUNCHD_LABEL}" in domain for user gui: ${process.getuid?.()}\n`,
                });
            }
            if (file !== "systemctl" || !args.includes("show"))
                throw new Error("unexpected OS mutation");
            queries.push("presence");
            return `LoadState=${controls.absent ? "not-found" : "loaded"}\nActiveState=inactive\nSubState=dead\nMainPID=0\nControlPID=0\nControlGroup=\nFragmentPath=\n`;
        },
        spawn: async () => {
            throw new Error("must not spawn");
        },
    };
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { mode: 0o700 });
    const spec: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace,
        workingDirectory: root,
        nodePath: process.execPath,
        binPath: path.join(root, "bin.js"),
        host: "127.0.0.1",
        port: 6727,
    };
    fs.writeFileSync(spec.binPath, "export {};\n", { mode: 0o600 });
    const files = getServiceFiles("user", host);
    const platform: ServicePlatform = {
        inspect: async () => ({
            state: "stopped",
            running: false,
            enabled: true,
            loaded: true,
            definitionPath: files.definition,
            processId: null,
            identity: null,
            quiescent: true,
        }),
        quiesce: async () => {
            effects.push("quiesce");
            throw new Error("must not stop");
        },
        start: async () => {
            effects.push("start");
            throw new Error("must not start");
        },
        reload: async enabled => {
            effects.push(`reload:${enabled}`);
            expect(fs.existsSync(files.definition)).toBe(true);
            expect(fs.existsSync(files.metadata)).toBe(true);
            const directory = path.join(files.stateDir, "manager-operations");
            const name = fs.readdirSync(directory).find(file => file.endsWith(".json"))!;
            expect(JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"))).toMatchObject({
                action: "install",
                phase: "restoring-enablement",
                status: "running",
            });
            if (controls.failReload) throw new Error("synthetic-secret");
        },
    };
    return { root, workspace, spec, host, files, platform, controls, effects, queries };
}
describe("manager installation transaction", () => {
    it.each(["blank", "damaged"])(
        "%s business configuration is neither created nor rewritten; installation never starts manager",
        async mode => {
            const test = fixture();
            const config = path.join(test.workspace, "config.yaml");
            if (mode === "damaged")
                fs.writeFileSync(config, Buffer.from("secret: [\r\n"), { mode: 0o600 });
            const result = await installManagerService(test.spec, test.host, {
                platform: test.platform,
            });
            expect(result).toMatchObject({
                status: "succeeded",
                phase: "completed",
                recoveryRequired: false,
            });
            expect(test.effects).toEqual(["reload:true"]);
            expect(test.queries).toEqual(["presence"]);
            if (mode === "blank") expect(fs.existsSync(config)).toBe(false);
            else expect(fs.readFileSync(config)).toEqual(Buffer.from("secret: [\r\n"));
            expect(readServiceMigrationPending(test.workspace)).toBeNull();
            expect(JSON.parse(fs.readFileSync(test.files.metadata, "utf8"))).toEqual(test.spec);
            expect(
                new FileManagerServiceJournal(
                    path.join(test.files.stateDir, "manager-operations"),
                ).read(result.id),
            ).toEqual(result);
        },
    );
    it("preserves existing control auth, gateway desired and auxiliary files byte-for-byte", async () => {
        const test = fixture();
        const control = path.join(test.workspace, ".control");
        seedWorkspace(test.workspace);
        const content = {
            "auth.json": "synthetic-auth",
            "gateway.json": fs.readFileSync(path.join(control, "gateway.json"), "utf8"),
            "operator-note.txt": "preserved",
        };
        for (const [name, bytes] of Object.entries(content))
            fs.writeFileSync(path.join(control, name), bytes, { mode: 0o600 });
        const entries = fs.readdirSync(control).sort();
        expect(
            (await installManagerService(test.spec, test.host, { platform: test.platform })).status,
        ).toBe("succeeded");
        expect(fs.readdirSync(control).sort()).toEqual([...entries, "operation.log"].sort());
        for (const [name, bytes] of Object.entries(content))
            expect(fs.readFileSync(path.join(control, name), "utf8")).toBe(bytes);
        const operations = fs
            .readFileSync(path.join(control, "operation.log"), "utf8")
            .trim()
            .split("\n")
            .map(line => JSON.parse(line) as Record<string, unknown>);
        expect(operations.at(-1)).toMatchObject({
            id: expect.any(String),
            action: "manager-service.install",
            status: "succeeded",
            phase: "completed",
        });
        expect(JSON.stringify(operations)).not.toContain("synthetic-auth");
    });
    it.each(["control", "legacy", "damaged"])(
        "existing %s metadata is not overwritten and causes zero OS effects",
        async kind => {
            const test = fixture();
            fs.mkdirSync(test.files.stateDir, { recursive: true, mode: 0o700 });
            const text =
                kind === "control"
                    ? JSON.stringify(test.spec)
                    : kind === "damaged"
                      ? "{"
                      : JSON.stringify({
                            scope: "user",
                            configPath: path.join(test.workspace, "old.yaml"),
                            adapters: [],
                            protocols: [],
                            nodePath: process.execPath,
                            binPath: test.spec.binPath,
                            workingDirectory: test.root,
                        });
            fs.writeFileSync(test.files.metadata, text, { mode: 0o600 });
            await expect(
                installManagerService(test.spec, test.host, { platform: test.platform }),
            ).rejects.toThrow();
            expect(test.effects).toEqual([]);
            expect(test.queries).toEqual([]);
            expect(fs.readFileSync(test.files.metadata, "utf8")).toBe(text);
        },
    );
    it("OS identity not explicitly absent refuses before definition or workspace creation", async () => {
        const test = fixture();
        test.controls.absent = false;
        await expect(
            installManagerService(test.spec, test.host, { platform: test.platform }),
        ).rejects.toThrow("无法证明系统服务不存在");
        expect(test.effects).toEqual([]);
        expect(fs.existsSync(test.files.definition)).toBe(false);
        expect(fs.existsSync(path.join(test.workspace, ".control"))).toBe(false);
    });
    it("writing intent persistence failure leaves unknown journal and prevents retry with a new id", async () => {
        const test = fixture();
        const original = fs.renameSync;
        vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
            if (
                String(to).includes("manager-operations") &&
                JSON.parse(fs.readFileSync(String(from), "utf8")).phase === "writing"
            )
                throw new Error("synthetic-secret");
            original(from, to);
        });
        const result = await installManagerService(test.spec, test.host, {
            platform: test.platform,
        });
        expect(result).toMatchObject({ status: "interrupted", recoveryRequired: true });
        expect(test.effects).toEqual([]);
        expect(fs.existsSync(test.files.definition)).toBe(false);
        expect(fs.existsSync(path.join(test.workspace, ".control"))).toBe(false);
        vi.restoreAllMocks();
        await expect(
            installManagerService(test.spec, test.host, { platform: test.platform }),
        ).rejects.toThrow("尚待对账");
        expect(test.effects).toEqual([]);
    });
    it("OS reload failure leaves files and gate intact without inverse stop/delete compensation", async () => {
        const test = fixture();
        test.controls.failReload = true;
        const result = await installManagerService(test.spec, test.host, {
            platform: test.platform,
        });
        expect(result).toMatchObject({ status: "interrupted", recoveryRequired: true });
        expect(JSON.stringify(result)).not.toContain("synthetic-secret");
        expect(test.effects).toEqual(["reload:true"]);
        expect(fs.existsSync(test.files.definition)).toBe(true);
        expect(fs.existsSync(test.files.metadata)).toBe(true);
        expect(readServiceMigrationPending(test.workspace)?.operationId).toBe(result.id);
        expect(
            new FileManagerServiceJournal(
                path.join(test.files.stateDir, "manager-operations"),
            ).health().recoveryRequired,
        ).toBe(true);
    });
});

it.each(["linux", "darwin"] as const)(
    "%s installed definition is accepted by the ordinary stop controller",
    async platformName => {
        const test = fixture(platformName);
        expect(
            (await installManagerService(test.spec, test.host, { platform: test.platform })).status,
        ).toBe("succeeded");
        const controlEffects: string[] = [];
        const platform: ServicePlatform = {
            ...test.platform,
            quiesce: async () => {
                controlEffects.push("quiesce");
            },
            reload: async enabled => {
                controlEffects.push(`reload:${enabled}`);
            },
        };
        const operation = await controlManagerService("stop", "user", test.host, {
            platform: () => platform,
            confirmStopped: async () => true,
        });
        expect(operation.status).toBe("succeeded");
        expect(controlEffects).toEqual(["quiesce", "reload:true"]);
    },
);

function seedWorkspace(workspace: string): void {
    prepareServiceMigrationWorkspace(workspace, "seed-operation", "stopped");
    const unlock = acquireControlWorkspace(workspace);
    try {
        prepareServiceProcessOwnershipSeed(workspace);
        releaseServiceMigrationPending(workspace, "seed-operation");
    } finally {
        unlock();
    }
}
it.each(["missing", "damaged", "live-owner"])(
    "existing control with %s ownership cannot report successful installation",
    async condition => {
        const test = fixture();
        seedWorkspace(test.workspace);
        const receipt = path.join(test.workspace, ".control/process-ownership.json");
        if (condition === "missing") fs.unlinkSync(receipt);
        else if (condition === "damaged") fs.writeFileSync(receipt, '{"synthetic-secret":');
        else {
            const unlock = acquireControlWorkspace(test.workspace);
            try {
                expect(
                    await claimServiceProcessOwnership(
                        test.workspace,
                        "10000000-0000-4000-8000-000000000001",
                        false,
                    ),
                ).toBe(true);
            } finally {
                unlock();
            }
        }
        const content = fs.existsSync(receipt) ? fs.readFileSync(receipt) : null;
        await expect(
            installManagerService(test.spec, test.host, { platform: test.platform }),
        ).rejects.toThrow();
        expect(test.effects).toEqual([]);
        expect(fs.existsSync(test.files.definition)).toBe(false);
        expect(fs.existsSync(test.files.metadata)).toBe(false);
        if (content) expect(fs.readFileSync(receipt)).toEqual(content);
        else expect(fs.existsSync(receipt)).toBe(false);
    },
);

it("已有工作区升级待确认时不借首次安装改写托管契约", async () => {
    const f = fixture();
    fs.mkdirSync(path.join(f.workspace, ".control"), { mode: 0o700 });
    fs.writeFileSync(
        path.join(f.workspace, ".control/manager-upgrade-pending.json"),
        JSON.stringify({
            schemaVersion: 1,
            operationId: "upgrade",
            candidateDigest: "a".repeat(64),
        }),
        { mode: 0o600 },
    );
    await expect(installManagerService(f.spec, f.host, { platform: f.platform })).rejects.toThrow(
        "升级尚待",
    );
    expect(f.effects).toEqual([]);
    expect(fs.existsSync(f.files.definition)).toBe(false);
    expect(fs.existsSync(f.files.metadata)).toBe(false);
});
