import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    authFetch,
    getToken,
    login,
    loginWithToken,
    logout,
    refresh,
    setToken,
} from "./useAuth.js";

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

function healthResponse(instanceId = "instance-current"): Response {
    return Response.json({
        status: "ok",
        application: "onebots",
        version: "1.2.8",
        instance_id: instanceId,
        runtime_contract_id: "sha256:contract-current",
    });
}

function authenticationResponse(
    body: unknown,
    status = 200,
    instanceId = "instance-current",
): Response {
    return Response.json(body, {
        status,
        headers: {
            "X-OneBots-Application": "onebots",
            "X-OneBots-Version": "1.2.8",
            "X-OneBots-Instance-Id": instanceId,
            "X-OneBots-Runtime-Contract-Id": "sha256:contract-current",
        },
    });
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
            vi
                .fn()
                .mockResolvedValueOnce(healthResponse())
                .mockResolvedValueOnce(authenticationResponse({ message: "鉴权码错误" }, 401)),
        );

        await expect(loginWithToken("wrong-token")).resolves.toEqual({
            ok: false,
            message: "鉴权码错误",
        });
        expect(getToken()).toBe("existing-token");
    });

    it("服务端确认候选鉴权码后才替换会话", async () => {
        setToken("existing-token", null, null);
        const fetcher = vi
            .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => healthResponse())
            .mockResolvedValueOnce(healthResponse())
            .mockResolvedValueOnce(
                authenticationResponse({
                    success: true,
                    token: "verified-token",
                    expiresAt: null,
                    refreshToken: null,
                }),
            );
        vi.stubGlobal("fetch", fetcher);

        await expect(loginWithToken("verified-token")).resolves.toMatchObject({ ok: true });
        expect(getToken()).toBe("verified-token");
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher.mock.calls[0]?.[0]).toContain("/health");
        expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
            cache: "no-store",
            redirect: "error",
        });
        const authenticationInit = fetcher.mock.calls[1]?.[1] as RequestInit;
        expect(authenticationInit.redirect).toBe("error");
        expect(new Headers(authenticationInit.headers).get("X-OneBots-Expected-Instance-Id")).toBe(
            "instance-current",
        );
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
            message: "拒绝发送管理凭据：health 不可达：timeout",
        });
        await expect(refresh()).resolves.toEqual({ ok: false, unavailable: true });
        expect(getToken()).toBe("existing-token");
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("成功状态但响应契约损坏时不提交候选会话", async () => {
        setToken("existing-token", null, null);
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce(healthResponse())
                .mockResolvedValueOnce(
                    new Response("not-json", {
                        status: 200,
                        headers: {
                            "X-OneBots-Application": "onebots",
                            "X-OneBots-Version": "1.2.8",
                            "X-OneBots-Instance-Id": "instance-current",
                            "X-OneBots-Runtime-Contract-Id": "sha256:contract-current",
                        },
                    }),
                ),
        );

        await expect(loginWithToken("candidate-token")).resolves.toEqual({
            ok: false,
            unavailable: true,
            message: "登录响应格式无效",
        });
        expect(getToken()).toBe("existing-token");
    });

    it("公开身份无效时不发送候选凭据", async () => {
        setToken("existing-token", null, null);
        const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
            Response.json({ status: "ok" }),
        );
        vi.stubGlobal("fetch", fetcher);

        await expect(loginWithToken("candidate-secret")).resolves.toMatchObject({
            ok: false,
            unavailable: true,
            message: expect.stringContaining("拒绝发送管理凭据"),
        });

        expect(fetcher).toHaveBeenCalledOnce();
        expect(fetcher.mock.calls[0]?.[0]).toContain("/health");
        expect(JSON.stringify(fetcher.mock.calls[0])).not.toContain("candidate-secret");
        expect(getToken()).toBe("existing-token");
    });

    it("公开身份正文超限时不发送候选凭据", async () => {
        setToken("existing-token", null, null);
        const fetcher = vi.fn(
            async () =>
                new Response("{}", {
                    headers: { "content-length": String(64 * 1024 + 1) },
                }),
        );
        vi.stubGlobal("fetch", fetcher);

        await expect(loginWithToken("candidate-secret")).resolves.toEqual({
            ok: false,
            unavailable: true,
            message: "拒绝发送管理凭据：health 不可达：响应正文超过 64 KiB 上限",
        });
        expect(fetcher).toHaveBeenCalledOnce();
        expect(JSON.stringify(fetcher.mock.calls[0])).not.toContain("candidate-secret");
        expect(getToken()).toBe("existing-token");
    });

    it("认证回执正文超限时保留已有会话", async () => {
        setToken("existing-token", null, null);
        const oversizedResponse = authenticationResponse({ token: "candidate-token" });
        oversizedResponse.headers.set("content-length", String(64 * 1024 + 1));
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce(healthResponse())
                .mockResolvedValueOnce(oversizedResponse),
        );

        await expect(loginWithToken("candidate-token")).resolves.toEqual({
            ok: false,
            unavailable: true,
            message: "认证响应无效：响应正文超过 64 KiB 上限",
        });
        expect(getToken()).toBe("existing-token");
    });

    it("认证回执来自另一个实例时不提交候选会话", async () => {
        setToken("existing-token", null, null);
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce(healthResponse("instance-a"))
                .mockResolvedValueOnce(
                    authenticationResponse(
                        { success: true, token: "candidate-token" },
                        200,
                        "instance-b",
                    ),
                ),
        );

        await expect(loginWithToken("candidate-token")).resolves.toEqual({
            ok: false,
            unavailable: true,
            message: "认证响应实例不匹配：期望 instance-a，实际 instance-b",
        });
        expect(getToken()).toBe("existing-token");
    });

    it("刷新令牌也先验证公开身份并只接受同实例回执", async () => {
        setToken("old-session", null, "refresh-token");
        const fetcher = vi
            .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => healthResponse())
            .mockResolvedValueOnce(healthResponse())
            .mockResolvedValueOnce(
                authenticationResponse({
                    success: true,
                    token: "new-session",
                    expiresAt: null,
                    refreshToken: "next-refresh-token",
                }),
            );
        vi.stubGlobal("fetch", fetcher);

        await expect(refresh()).resolves.toEqual({ ok: true });

        expect(getToken()).toBe("new-session");
        expect(fetcher).toHaveBeenCalledTimes(2);
        const refreshInit = fetcher.mock.calls[1]?.[1];
        expect(new Headers(refreshInit?.headers).get("X-OneBots-Expected-Instance-Id")).toBe(
            "instance-current",
        );
        expect(refreshInit?.redirect).toBe("error");
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

    it("登出使用有界请求，并在服务端不可达时仍清理本地会话", async () => {
        setToken("session-token", Date.now() + 60_000, "refresh-token");
        const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            expect(init?.signal).toBeInstanceOf(AbortSignal);
            throw new DOMException("timeout", "TimeoutError");
        });
        vi.stubGlobal("fetch", fetcher);

        await expect(logout()).resolves.toBeUndefined();

        expect(getToken()).toBeNull();
        expect(fetcher).toHaveBeenCalledOnce();
    });
});
