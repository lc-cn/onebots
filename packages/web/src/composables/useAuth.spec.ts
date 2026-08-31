import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getToken, loginWithToken, setToken } from "./useAuth.js";

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
});
