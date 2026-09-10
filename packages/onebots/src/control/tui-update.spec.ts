import { expect, it, vi } from "vitest";
import { ControlClient } from "@onebots/core/control";
import { runControlUpdate } from "./tui-update.js";

const base = { generationId: null, configRevision: "a".repeat(64) };
function fixture(state = "updates_available", answers = [["yes"], ["no"]]) {
    const request = vi.fn(async <T>(_method: "GET" | "POST", route: string): Promise<T> => {
        let result: unknown;
        if (route.endsWith("source")) result = { state: "ready", base };
        else if (route.endsWith("plan"))
            result = {
                state,
                base,
                packages: [{ name: "onebots", current: "1.0.0", target: "1.0.1" }],
                installationPlan: {
                    id: "upgrade-plan",
                    packages: [],
                    peers: [],
                    recommendations: [],
                    removed: { adapters: [], protocols: [], applications: [] },
                },
            };
        else if (route === "/api/control/installations") throw new Error("lost response");
        else if (route.endsWith("same-id"))
            result = { phase: "verified", candidateId: "candidate" };
        else throw new Error("unexpected route");
        return result as T;
    });
    const prompt = { ask: vi.fn(async () => answers.shift() ?? []), report: vi.fn() };
    return { client: new ControlClient({ request }), request, prompt };
}

it("最新版本只查摘要和升级计划，不读取配置正文、不询问安装", async () => {
    const f = fixture("current");
    await runControlUpdate(f.client, f.prompt);
    expect(f.request.mock.calls.map(call => call[1])).toEqual([
        "/api/control/configuration/source",
        "/api/control/updates/plan",
    ]);
    expect(f.request).toHaveBeenLastCalledWith("POST", "/api/control/updates/plan", {
        expected: base,
    });
    expect(f.prompt.ask).not.toHaveBeenCalled();
});

it("取消升级确认不创建安装任务", async () => {
    const f = fixture("updates_available", [["no"]]);
    await runControlUpdate(f.client, f.prompt);
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.prompt.report.mock.calls.flat().join(" ")).toContain("1.0.0 → 1.0.1");
});

it("安装响应丢失仍查询同一任务，拒绝激活时不切换", async () => {
    const f = fixture();
    await runControlUpdate(f.client, f.prompt, { requestId: () => "same-id" });
    expect(f.request).toHaveBeenCalledWith("POST", "/api/control/installations", {
        id: "same-id",
        planId: "upgrade-plan",
    });
    expect(
        f.request.mock.calls.filter(call => call[1] === "/api/control/installations"),
    ).toHaveLength(1);
    expect(f.request).toHaveBeenLastCalledWith("GET", "/api/control/installations/same-id");
    expect(f.prompt.ask).toHaveBeenCalledTimes(2);
});

it("损坏配置不解析发布版本或安装", async () => {
    const request = vi.fn(async <T>() => ({ state: "damaged", base }) as T);
    const prompt = { ask: vi.fn(), report: vi.fn() };
    await runControlUpdate(new ControlClient({ request }), prompt);
    expect(request).toHaveBeenCalledTimes(1);
    expect(prompt.ask).not.toHaveBeenCalled();
});
