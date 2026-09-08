import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authFetch, getToken, logout, refresh, setToken } from "./useAuth.js";

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

describe("旧业务请求的会话刷新与退出", () => {
    beforeEach(() => {
        vi.stubGlobal("localStorage", memoryStorage());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("刷新超时有界结束且保留已有会话", async () => {
        setToken("existing-token", null, "refresh-token");
        const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            expect(init?.signal).toBeInstanceOf(AbortSignal);
            throw new DOMException("timeout", "TimeoutError");
        });
        vi.stubGlobal("fetch", fetcher);

        await expect(refresh()).resolves.toEqual({ ok: false, unavailable: true });
        expect(getToken()).toBe("existing-token");
        expect(fetcher).toHaveBeenCalledTimes(1);
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
    it.each([
        "invalid-identity",
        "large-identity",
        "large-receipt",
        "wrong-instance",
        "invalid-json",
    ])("刷新保留共享的身份与响应边界：%s", async failure => {
        setToken("existing-token", null, "refresh-secret");
        const receipt = authenticationResponse(
            { token: "unexpected-session" },
            200,
            failure === "wrong-instance" ? "other-instance" : "instance-current",
        );
        if (failure === "large-receipt")
            receipt.headers.set("content-length", String(64 * 1024 + 1));
        const identity =
            failure === "invalid-identity"
                ? Response.json({ status: "ok" })
                : failure === "large-identity"
                  ? new Response("{}", { headers: { "content-length": String(64 * 1024 + 1) } })
                  : healthResponse();
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(identity)
            .mockResolvedValueOnce(
                failure === "invalid-json"
                    ? new Response("not-json", { headers: receipt.headers })
                    : receipt,
            );
        vi.stubGlobal("fetch", fetcher);
        await expect(refresh()).resolves.toEqual({ ok: false, unavailable: true });
        expect(getToken()).toBe("existing-token");
        if (failure === "invalid-identity" || failure === "large-identity") {
            expect(fetcher).toHaveBeenCalledOnce();
            expect(JSON.stringify(fetcher.mock.calls)).not.toContain("refresh-secret");
        }
    });
});
