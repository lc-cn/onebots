import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authFetch, getToken, login, loginWithToken, refresh, setToken } from "./useAuth.js";

function memoryStorage(): Storage {
    const values = new Map<string, string>();
    return {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: key => values.get(key) ?? null,
        key: index => [...values.keys()][index] ?? null,
        removeItem: key => values.delete(key),
        setItem: (key, value) => values.set(key, value),
    };
}

describe("Web 鉴权码登录", () => {
    beforeEach(() => {
        vi.stubGlobal("localStorage", memoryStorage());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("服务端拒绝候选鉴权码时保留已有会话", async () => {
        setToken("existing-token", null, null);
        vi.stubGlobal(
            "fetch",
            vi.fn(
                async () =>
                    new Response(JSON.stringify({ message: "鉴权码错误" }), {
                        status: 401,
                        headers: { "Content-Type": "application/json" },
                    }),
            ),
        );

        await expect(loginWithToken("wrong-token")).resolves.toEqual({
            ok: false,
            message: "鉴权码错误",
        });
        expect(getToken()).toBe("existing-token");
    });

    it("服务端确认候选鉴权码后才替换会话", async () => {
        setToken("existing-token", null, null);
        vi.stubGlobal(
            "fetch",
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            success: true,
                            token: "verified-token",
                            expiresAt: null,
                            refreshToken: null,
                        }),
                        { status: 200, headers: { "Content-Type": "application/json" } },
                    ),
            ),
        );

        await expect(loginWithToken("verified-token")).resolves.toMatchObject({ ok: true });
        expect(getToken()).toBe("verified-token");
    });

    it("登录超时返回可解释失败，刷新超时也会有界结束", async () => {
        setToken("existing-token", null, "refresh-token");
        const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            expect(init?.signal).toBeInstanceOf(AbortSignal);
            throw new DOMException("timeout", "TimeoutError");
        });
        vi.stubGlobal("fetch", fetcher);

        await expect(login("user", "password")).resolves.toEqual({
            ok: false,
            unavailable: true,
            message: "认证请求超时，请检查网关或反向代理",
        });
        await expect(refresh()).resolves.toEqual({ ok: false, unavailable: true });
        expect(getToken()).toBe("existing-token");
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("成功状态但响应契约损坏时不提交候选会话", async () => {
        setToken("existing-token", null, null);
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("not-json", { status: 200 })),
        );

        await expect(loginWithToken("candidate-token")).resolves.toEqual({
            ok: false,
            unavailable: true,
            message: "登录响应格式无效",
        });
        expect(getToken()).toBe("existing-token");
    });

    it("刷新服务暂时不可用时保留会话，只有明确拒绝才触发清理", async () => {
        setToken("expired-token", null, "refresh-token");
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(new Response(null, { status: 401 }))
            .mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
        vi.stubGlobal("fetch", fetcher);

        const response = await authFetch("/api/adapters");

        expect(response.status).toBe(401);
        expect(getToken()).toBe("expired-token");
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
});
