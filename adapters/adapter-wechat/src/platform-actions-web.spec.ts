import { describe, expect, it, vi } from "vitest";
import type { WechatClient } from "./client.js";
import { executeWechatPlatformAction } from "./platform-actions.js";

function createClient(): {
    client: WechatClient;
    call: ReturnType<typeof vi.fn>;
    getJsApiTicket: ReturnType<typeof vi.fn>;
} {
    const call = vi.fn().mockResolvedValue({ errcode: 0 });
    const getJsApiTicket = vi.fn().mockResolvedValue("ticket-1");
    return {
        client: {
            call,
            getJsApiTicket,
            config: { app_id: "wx-app", app_secret: "secret" },
        } as unknown as WechatClient,
        call,
        getJsApiTicket,
    };
}

describe("微信公众号网页动作", () => {
    it("生成闭合参数的网页授权地址", async () => {
        const { client } = createClient();
        const result = await executeWechatPlatformAction(client, "build_oauth_url", {
            redirect_uri: "https://example.com/callback?source=wechat",
            scope: "snsapi_userinfo",
            state: "opaque-state",
        });
        expect(result).toEqual({
            url: "https://open.weixin.qq.com/connect/oauth2/authorize?appid=wx-app&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback%3Fsource%3Dwechat&response_type=code&scope=snsapi_userinfo&state=opaque-state#wechat_redirect",
        });
    });

    it("通过独立 OAuth token 调用网页授权接口", async () => {
        const { client, call } = createClient();
        await executeWechatPlatformAction(client, "exchange_oauth_code", { code: "code-1" });
        expect(call).toHaveBeenLastCalledWith({
            path: "/sns/oauth2/access_token",
            query: {
                appid: "wx-app",
                secret: "secret",
                code: "code-1",
                grant_type: "authorization_code",
            },
            token: false,
        });

        await executeWechatPlatformAction(client, "get_oauth_user_info", {
            oauth_access_token: "oauth-token",
            openid: "user-1",
            lang: "en",
        });
        expect(call).toHaveBeenLastCalledWith({
            path: "/sns/userinfo",
            query: { access_token: "oauth-token", openid: "user-1", lang: "en" },
            token: false,
        });
    });

    it("拒绝不受支持的 scope、语言和带凭据回调地址", async () => {
        const { client } = createClient();
        await expect(
            executeWechatPlatformAction(client, "build_oauth_url", {
                redirect_uri: "https://example.com/callback",
                scope: "openid",
            }),
        ).rejects.toMatchObject({ code: "WECHAT_INVALID_PARAMETER" });
        await expect(
            executeWechatPlatformAction(client, "get_oauth_user_info", {
                oauth_access_token: "token",
                openid: "user",
                lang: "fr",
            }),
        ).rejects.toMatchObject({ code: "WECHAT_INVALID_PARAMETER" });
        await expect(
            executeWechatPlatformAction(client, "build_oauth_url", {
                redirect_uri: "https://user:password@example.com/callback",
            }),
        ).rejects.toMatchObject({ code: "WECHAT_INVALID_PARAMETER" });
    });

    it("获取 ticket 并生成可直接用于 JS-SDK 的签名配置", async () => {
        const { client, getJsApiTicket } = createClient();
        await expect(
            executeWechatPlatformAction(client, "get_jsapi_ticket", { force: true }),
        ).resolves.toEqual({ ticket: "ticket-1" });
        expect(getJsApiTicket).toHaveBeenLastCalledWith(true);

        await expect(
            executeWechatPlatformAction(client, "sign_jsapi_config", {
                url: "https://example.com/%7Epage?x=1#client-route",
                nonce_str: "nonce",
                timestamp: 1_700_000_000,
            }),
        ).resolves.toEqual({
            appId: "wx-app",
            timestamp: 1_700_000_000,
            nonceStr: "nonce",
            signature: "8f3f7c1734dbe082b71f1590c8bcccbc2e0f0fe7",
        });
    });
});
