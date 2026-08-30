import { describe, expect, test, vi } from "vitest";
import { KookOAuthClient } from "./oauth.js";
import type { KookConfig } from "./types.js";

const config: Pick<KookConfig, "api_base_url" | "oauth"> = {
    oauth: {
        client_id: "client-id",
        client_secret: "client-secret",
        redirect_uri: "https://example.test/oauth/callback",
    },
};

describe("KOOK OAuth client", () => {
    test("生成带 state 和官方 scope 的授权地址", () => {
        const client = new KookOAuthClient(config);
        const url = new URL(
            client.buildAuthorizationUrl(["get_user_info", "get_user_guilds"], "csrf-state"),
        );

        expect(url.origin + url.pathname).toBe("https://www.kookapp.cn/app/oauth2/authorize");
        expect(Object.fromEntries(url.searchParams)).toEqual({
            client_id: "client-id",
            redirect_uri: "https://example.test/oauth/callback",
            response_type: "code",
            scope: "get_user_info get_user_guilds",
            state: "csrf-state",
        });
    });

    test("换码请求只发送 OAuth 应用凭据", async () => {
        const transport = vi.fn().mockResolvedValue(
            Response.json({
                access_token: "user-token",
                expires_in: 2_678_400,
                token_type: "Bearer",
                scope: "get_user_info",
            }),
        );
        const client = new KookOAuthClient(config, transport);

        await expect(client.exchangeCode("authorization-code")).resolves.toMatchObject({
            access_token: "user-token",
        });
        const [url, init] = transport.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://www.kookapp.cn/api/oauth2/token");
        expect(new Headers(init.headers).get("authorization")).toBeNull();
        expect(new URLSearchParams(String(init.body))).toEqual(
            new URLSearchParams({
                grant_type: "authorization_code",
                client_id: "client-id",
                client_secret: "client-secret",
                code: "authorization-code",
                redirect_uri: "https://example.test/oauth/callback",
            }),
        );
    });

    test("用户资源只使用 Bearer 并解析 KOOK envelope", async () => {
        const transport = vi.fn().mockResolvedValue(
            Response.json({
                code: 0,
                message: "操作成功",
                data: { id: "user-1", username: "Alice" },
            }),
        );
        const client = new KookOAuthClient(config, transport);

        await expect(client.getUserInfo("user-token")).resolves.toEqual({
            id: "user-1",
            username: "Alice",
        });
        const [, init] = transport.mock.calls[0] as [string, RequestInit];
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer user-token");
    });

    test("底层调用拒绝跳出 /v3 与路径穿越", async () => {
        const client = new KookOAuthClient(config, vi.fn());
        await expect(client.call("token", "/oauth2/token")).rejects.toMatchObject({
            code: "KOOK_OAUTH_PATH_INVALID",
        });
        await expect(client.call("token", "/v3/user/%2e%2e/me")).rejects.toMatchObject({
            code: "KOOK_OAUTH_PATH_INVALID",
        });
    });

    test("独立客户端也校验 OAuth 凭据与端点", () => {
        expect(
            () =>
                new KookOAuthClient({
                    oauth: {
                        client_id: "client-id",
                        client_secret: "client-secret",
                        redirect_uri: "https://example.test/callback",
                        token_url: "http://example.test/token",
                    },
                }),
        ).toThrow("HTTPS");
        expect(
            () =>
                new KookOAuthClient({
                    oauth: {
                        client_id: "",
                        client_secret: "client-secret",
                        redirect_uri: "https://example.test/callback",
                    },
                }),
        ).toThrow("client_id");
    });
});
