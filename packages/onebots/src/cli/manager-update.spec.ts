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
    expect(f.output.mock.calls[0][0]).toContain("不升级常驻管理服务");
});
it("交互取消确认沿统一TUI流程，无原地更新或安装", async () => {
    const f = fixture("updates_available");
    const prompt = { ask: vi.fn(async () => ["no"]), report: vi.fn() };
    expect(await runManagerUpdate([], { ...f, interactive: true, prompt })).toBe(0);
    expect(prompt.ask).toHaveBeenCalledOnce();
    expect(f.request).toHaveBeenCalledTimes(2);
});
