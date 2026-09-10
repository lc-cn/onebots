import { afterEach, expect, it, vi } from "vitest";
import type { ControlUpdatePlan } from "@onebots/core/control";
import { createControlUpdateCheck } from "./control-update-check.js";
const base = { generationId: "active", configRevision: "a".repeat(64) };
const result: ControlUpdatePlan = {
    state: "updates_available",
    base,
    packages: [
        { name: "onebots", current: "1.2.12", target: "1.2.13" },
        { name: "@onebots/core", current: "1.0.0", target: "1.0.1" },
    ],
    peers: [],
    recommendations: [],
    installationPlan: {
        id: "b".repeat(64),
        planDigest: "c".repeat(64),
        baseGenerationId: "active",
        selection: { adapters: ["mock", "icqq"], protocols: [], applications: ["zhin"] },
        removed: { adapters: [], protocols: [], applications: [] },
        packages: [
            { name: "onebots", version: "1.2.13" },
            { name: "@onebots/core", version: "1.0.1" },
        ],
        peers: [],
        recommendations: [],
    },
};
function fixture() {
    const client = {
        configurationSource: vi.fn(async () => ({ state: "ready" as "ready" | "damaged", base })),
        planUpdate: vi.fn(async () => structuredClone(result)),
    };
    let blocked = false;
    const callbacks = { begin: vi.fn(), accept: vi.fn(), fail: vi.fn(), end: vi.fn() };
    const options = {
        client: () => client,
        blocked: () => blocked,
        bounded: <T>(promise: Promise<T>) => promise,
        ...callbacks,
    };
    return {
        client,
        callbacks,
        check: createControlUpdateCheck(options),
        options,
        block: () => {
            blocked = true;
        },
    };
}
it("只发送源状态的双基线，无token和用户目标，完整安装清单交回原安装链", async () => {
    const f = fixture();
    await f.check.run();
    expect(f.client.configurationSource).toHaveBeenCalledExactlyOnceWith();
    expect(f.client.planUpdate).toHaveBeenCalledExactlyOnceWith(base);
    expect(f.callbacks.accept).toHaveBeenCalledExactlyOnceWith(result);
    expect(f.callbacks.accept.mock.calls[0][0].installationPlan.selection.adapters).toEqual([
        "mock",
        "icqq",
    ]);
    expect(f.callbacks.end).toHaveBeenCalledOnce();
    expect(f.callbacks.fail).not.toHaveBeenCalled();
});
it("current不制造安装计划", async () => {
    const f = fixture();
    f.client.planUpdate.mockResolvedValue({
        ...result,
        state: "current",
        installationPlan: undefined,
    });
    await f.check.run();
    expect(f.callbacks.accept.mock.calls[0][0]).toMatchObject({
        state: "current",
        installationPlan: undefined,
    });
});
it("配置损坏先引导修复，不发升级请求", async () => {
    const f = fixture();
    f.client.configurationSource.mockResolvedValue({ state: "damaged", base });
    await f.check.run();
    expect(f.client.planUpdate).not.toHaveBeenCalled();
    expect(f.callbacks.fail).toHaveBeenCalledExactlyOnceWith("damaged");
});
it("busy或已有tracking由共享门禁阻止检查", async () => {
    const f = fixture();
    f.block();
    await f.check.run();
    expect(f.client.configurationSource).not.toHaveBeenCalled();
    expect(f.callbacks.begin).not.toHaveBeenCalled();
});
it("检查进行中再次点击不会并发，卸载后旧请求不再发送后续或更新状态", async () => {
    const f = fixture();
    let release!: (value: { state: "ready"; base: typeof base }) => void;
    f.client.configurationSource.mockImplementation(
        () =>
            new Promise(resolve => {
                release = resolve;
            }),
    );
    const pending = f.check.run();
    await f.check.run();
    expect(f.client.configurationSource).toHaveBeenCalledOnce();
    f.check.dispose();
    release({ state: "ready", base });
    await pending;
    expect(f.client.planUpdate).not.toHaveBeenCalled();
    expect(f.callbacks.accept).not.toHaveBeenCalled();
    expect(f.callbacks.end).not.toHaveBeenCalled();
});
it("升级结果在卸载后到达，不创建安装预览", async () => {
    const f = fixture();
    let release!: (value: ControlUpdatePlan) => void;
    f.client.planUpdate.mockImplementation(
        () =>
            new Promise(resolve => {
                release = resolve;
            }),
    );
    const pending = f.check.run();
    await vi.waitFor(() => expect(f.client.planUpdate).toHaveBeenCalledOnce());
    f.check.dispose();
    release(result);
    await pending;
    expect(f.callbacks.accept).not.toHaveBeenCalled();
});
it.each([
    { ...result, base: { ...base, configRevision: "d".repeat(64) } },
    { ...result, installationPlan: undefined },
    { ...result, installationPlan: { ...result.installationPlan!, baseGenerationId: "other" } },
    { ...result, state: "current" as const },
    { ...result, installationPlan: { ...result.installationPlan!, id: "invalid" } },
    { ...result, installationPlan: { ...result.installationPlan!, packages: [] } },
])("不接受基线或安装确认不一致的回执", async response => {
    const f = fixture();
    f.client.planUpdate.mockResolvedValue(response);
    await f.check.run();
    expect(f.callbacks.accept).not.toHaveBeenCalled();
    expect(f.callbacks.fail).toHaveBeenCalledExactlyOnceWith("unavailable");
});
it("读取失败只报告检查失败，不派发安装，结束busy可重试", async () => {
    const f = fixture();
    f.client.planUpdate.mockRejectedValue(new Error("private token in untrusted error"));
    await f.check.run();
    expect(f.callbacks.fail).toHaveBeenCalledExactlyOnceWith("unavailable");
    expect(f.callbacks.end).toHaveBeenCalledOnce();
    f.client.planUpdate.mockResolvedValue(result);
    await f.check.run();
    expect(f.callbacks.accept).toHaveBeenCalledOnce();
});

afterEach(() => vi.useRealTimers());
it("升级预览允许120秒读取，超时释放busy且晚到结果不能被接受", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let release!: (value: ControlUpdatePlan) => void;
    f.client.planUpdate.mockImplementation(
        () =>
            new Promise(resolve => {
                release = resolve;
            }),
    );
    const pending = f.check.run();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.callbacks.fail).not.toHaveBeenCalled();
    expect(f.callbacks.end).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(105_000);
    await pending;
    expect(f.callbacks.fail).toHaveBeenCalledExactlyOnceWith("unavailable");
    expect(f.callbacks.end).toHaveBeenCalledOnce();
    release(result);
    await Promise.resolve();
    expect(f.callbacks.accept).not.toHaveBeenCalled();
});
