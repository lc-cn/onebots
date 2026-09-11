import { afterEach, expect, it, vi } from "vitest";
import { ControlClient, createHttpControlTransport, type ControlTransport } from "./control.js";
afterEach(() => vi.useRealTimers());
it("撤销当前会话且只接受明确回执", async () => {
    const request = vi.fn<ControlTransport["request"]>(async <T>() => ({ loggedOut: true }) as T);
    await expect(new ControlClient({ request }).logout()).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledExactlyOnceWith("POST", "/api/control/auth/logout", {});
});
it.each([null, {}, { loggedOut: false }, { loggedOut: true, token: "unexpected" }])(
    "拒绝损坏回执 %j",
    async result => {
        const request = vi.fn<ControlTransport["request"]>(async <T>() => result as T);
        await expect(new ControlClient({ request }).logout()).rejects.toThrow("未确认");
        expect(request).toHaveBeenCalledTimes(1);
    },
);
it("有界等待且不重试撤销", async () => {
    vi.useFakeTimers();
    const request = vi.fn<ControlTransport["request"]>(() => new Promise(() => {}));
    const result = expect(new ControlClient({ request }).logout()).rejects.toThrow("未确认");
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(request).toHaveBeenCalledTimes(1);
});

it("HTTP 退出请求获得可终止 signal，其他请求保持原契约", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
        setTimeout(() => controller.abort(), milliseconds);
        return controller.signal;
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"loggedOut":true}'));
    const transport = createHttpControlTransport("http://localhost", () => "session", fetcher);
    await transport.request("POST", "/api/control/auth/logout", {});
    const signal = fetcher.mock.calls[0][1]?.signal;
    expect(timeout).toHaveBeenCalledExactlyOnceWith(15_000);
    expect(signal).toBe(controller.signal);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(signal?.aborted).toBe(true);
    fetcher.mockResolvedValue(new Response("{}"));
    await transport.request("GET", "/api/control/status");
    expect(fetcher.mock.calls[1][1]?.signal).toBeUndefined();
    timeout.mockRestore();
});
