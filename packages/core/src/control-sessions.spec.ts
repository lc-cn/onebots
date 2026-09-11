import { afterEach, expect, it, vi } from "vitest";
import { ControlClient, type ControlTransport } from "./control.js";
afterEach(() => vi.useRealTimers());
const id = "a".repeat(32);
const session = { id, issuedAt: 0, expiresAt: 30 * 24 * 60 * 60 * 1000, current: true };
function fixture(response: unknown) {
    const request = vi.fn<ControlTransport["request"]>(async <T>() => response as T);
    return { request, client: new ControlClient({ request }) };
}
it("设备会话共享客户端路由与安全元信息", async () => {
    const f = fixture({ sessions: [session] });
    await expect(f.client.sessions()).resolves.toEqual({ sessions: [session] });
    expect(f.request).toHaveBeenCalledExactlyOnceWith("GET", "/api/control/auth/sessions");
});
it.each([{}, { sessions: [] }, { sessions: [{ ...session, hash: "secret" }] },
    { sessions: [session, session] }, { sessions: [{ ...session, expiresAt: Infinity }] }])(
    "损坏设备元信息被拒绝 %j", async response => {
        await expect(fixture(response).client.sessions()).rejects.toThrow("响应无效");
    },
);
it.each([{}, { revoked: false }, { revoked: true, unexpected: true }])(
    "不将错误撤销回执当作成功 %j", async response => {
        await expect(fixture(response).client.revokeSession(id)).rejects.toThrow("未确认");
    },
);
it("撤销有界等待且不自动重试", async () => {
    vi.useFakeTimers();
    const request = vi.fn<ControlTransport["request"]>(() => new Promise(() => {}));
    const pending = expect(new ControlClient({ request }).revokeSession(id)).rejects.toThrow("未确认");
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    expect(request).toHaveBeenCalledExactlyOnceWith("POST", "/api/control/auth/sessions/revoke", { id });
});
