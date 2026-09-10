import { expect, it, vi } from "vitest";
import { ControlClient } from "@onebots/core/control";
import { runManagerUpdate } from "./manager-update.js";
const base = { generationId: null, configRevision: "a".repeat(64) };
function fixture(state = "current") {
    const request = vi.fn(async <T>(_method: "GET" | "POST", route: string): Promise<T> => {
        if (route.endsWith("source")) return { state: "ready", base } as T;
        if (route.endsWith("plan"))
            return {
                state,
                base,
                packages: [],
                peers: [],
                recommendations: [],
                ...(state === "updates_available"
                    ? {
                          installationPlan: {
                              id: "plan",
                              packages: [],
                              peers: [],
                              recommendations: [],
                              removed: { adapters: [], protocols: [], applications: [] },
                          },
                      }
                    : {}),
            } as T;
        throw new Error("unexpected mutation");
    });
    const client = vi.fn(() => new ControlClient({ request }));
    return { client, request, output: vi.fn(), interactive: false };
}
it.each([
    ["current", 0],
    ["updates_available", 2],
] as const)("check %s只请求管理服务，返回%d", async (state, code) => {
    const f = fixture(state);
    expect(await runManagerUpdate(["--check", "--data-dir", "/tmp/upgrade-check"], f)).toBe(code);
    expect(f.client).toHaveBeenCalledWith("/tmp/upgrade-check");
    expect(f.request.mock.calls.map(call => call[1])).toEqual([
        "/api/control/configuration/source",
        "/api/control/updates/plan",
    ]);
    expect(JSON.parse(f.output.mock.calls[0][0])).toMatchObject({ scope: "gateway", state });
});
it.each(["--yes", "--packages-only", "--system", "-c", "-r", "-p", "-t", "--url", "--token"])(
    "旧参数%s拒绝且无控制请求",
    async flag => {
        const f = fixture();
        await expect(runManagerUpdate([flag, "secret"], f)).rejects.not.toThrow("secret");
        expect(f.client).not.toHaveBeenCalled();
    },
);
it("非交互隐式更新拒绝，help不连接服务并说明范围", async () => {
    const f = fixture();
    await expect(runManagerUpdate([], f)).rejects.toThrow("不会自动更新");
    expect(await runManagerUpdate(["--help"], f)).toBe(0);
    expect(f.client).not.toHaveBeenCalled();
    expect(f.output.mock.calls[0][0]).toContain("update --manager");
});
it("交互取消确认沿统一TUI流程，无原地更新或安装", async () => {
    const f = fixture("updates_available");
    const prompt = { ask: vi.fn(async () => ["no"]), report: vi.fn() };
    expect(await runManagerUpdate([], { ...f, interactive: true, prompt })).toBe(0);
    expect(prompt.ask).toHaveBeenCalledOnce();
    expect(f.request).toHaveBeenCalledTimes(2);
});

it("--manager从公开update入口传递精确版本、确认和system范围", async () => {
    const f = fixture();
    const resolve = vi.fn(async () => ({
        host: { name: "onebots", version: "1.2.13", spec: "1.2.13" },
        core: { name: "@onebots/core", version: "1.2.13", spec: "1.2.13" },
        extensionVersions: {},
        archiveSha256: "b".repeat(64),
        archives: {
            host: { bytes: Buffer.from("host"), sha256: "b".repeat(64) },
            core: { bytes: Buffer.from("core"), sha256: "c".repeat(64) },
        },
    }));
    const host = {
        platform: "linux" as const,
        homedir: "/root",
        uid: 0,
        env: {},
        exec: vi.fn(),
        spawn: vi.fn(),
    };
    expect(
        await runManagerUpdate(["--manager", "--check", "--version", "1.2.13", "--system"], {
            ...f,
            managerDependencies: {
                host,
                resolve,
                inspect: () => ({ version: "1.2.12", digest: "a".repeat(64) }),
                operationExists: () => false,
            },
        }),
    ).toBe(2);
    expect(resolve).toHaveBeenCalledWith("1.2.13");
    expect(JSON.parse(f.output.mock.calls[0][0])).toMatchObject({
        scope: "manager",
        serviceScope: "system",
    });
    expect(f.client).not.toHaveBeenCalled();
});

it("管理程序更新拒绝网关工作区及相互冲突的恢复检查参数", async () => {
    const f = fixture();
    await expect(
        runManagerUpdate(["--manager", "--data-dir", "/tmp/data", "--check"], f),
    ).rejects.toThrow("--data-dir");
    await expect(
        runManagerUpdate(["--manager", "--operation", "original", "--check"], f),
    ).rejects.toThrow("不能与只读 --check");
    expect(f.client).not.toHaveBeenCalled();
});

it("离线运行工件只允许管理程序入口并传递绝对清单路径", async () => {
    const f = fixture();
    const resolve = vi.fn(async () => ({
        host: { name: "onebots", version: "1.2.13", spec: "1.2.13" },
        core: { name: "@onebots/core", version: "1.2.13", spec: "1.2.13" },
        extensionVersions: {},
        archiveSha256: "b".repeat(64),
        archives: {
            host: { bytes: Buffer.from("host"), sha256: "b".repeat(64) },
            core: { bytes: Buffer.from("core"), sha256: "c".repeat(64) },
        },
    }));
    const inspect = vi.fn(() => ({ version: "1.2.12", digest: "a".repeat(64) }));
    await runManagerUpdate(["--manager", "--check", "--artifacts", "fixtures/release.json"], {
        ...f,
        managerDependencies: {
            resolve,
            inspect,
            operationExists: () => false,
            host: {
                platform: "linux",
                homedir: "/tmp",
                uid: 1000,
                env: {},
                exec: vi.fn(),
                spawn: vi.fn(),
            },
        },
    });
    expect(resolve).toHaveBeenCalledWith(undefined);
    await expect(runManagerUpdate(["--artifacts", "fixtures/release.json"], f)).rejects.toThrow(
        "仅可与 --manager",
    );
});
