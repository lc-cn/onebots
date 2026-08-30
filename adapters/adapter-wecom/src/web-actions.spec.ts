import { describe, expect, it, vi } from "vitest";
import type { WeComClient } from "./client.js";
import { executeWeComPlatformAction } from "./platform-actions.js";

function createClient(): {
    client: WeComClient;
    call: ReturnType<typeof vi.fn>;
    getCorpJsApiTicket: ReturnType<typeof vi.fn>;
    getAgentJsApiTicket: ReturnType<typeof vi.fn>;
} {
    const call = vi.fn().mockResolvedValue({ errcode: 0 });
    const getCorpJsApiTicket = vi.fn().mockResolvedValue("corp-ticket");
    const getAgentJsApiTicket = vi.fn().mockResolvedValue("agent-ticket");
    return {
        client: {
            call,
            getCorpJsApiTicket,
            getAgentJsApiTicket,
            config: { corp_id: "ww-corp", agent_id: "100001", corp_secret: "secret" },
        } as unknown as WeComClient,
        call,
        getCorpJsApiTicket,
        getAgentJsApiTicket,
    };
}

describe("企业微信网页动作", () => {
    it("生成绑定当前企业与应用的网页授权地址", async () => {
        const { client } = createClient();
        await expect(
            executeWeComPlatformAction(client, "build_oauth_url", {
                redirect_uri: "https://example.com/callback?source=wecom",
                scope: "snsapi_privateinfo",
                state: "opaque-state",
            }),
        ).resolves.toEqual({
            url: "https://open.weixin.qq.com/connect/oauth2/authorize?appid=ww-corp&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback%3Fsource%3Dwecom&response_type=code&scope=snsapi_privateinfo&state=opaque-state&agentid=100001#wechat_redirect",
        });
    });

    it("使用新版身份接口并以 user_ticket 获取敏感信息", async () => {
        const { client, call } = createClient();
        await executeWeComPlatformAction(client, "get_oauth_user_identity", { code: "code-1" });
        expect(call).toHaveBeenLastCalledWith({
            path: "/cgi-bin/auth/getuserinfo",
            query: { code: "code-1" },
        });
        await executeWeComPlatformAction(client, "get_oauth_user_detail", {
            user_ticket: "user-ticket",
        });
        expect(call).toHaveBeenLastCalledWith({
            method: "POST",
            path: "/cgi-bin/auth/getuserdetail",
            body: { user_ticket: "user-ticket" },
        });
    });

    it("分别生成 wx.config 与 wx.agentConfig 原生字段", async () => {
        const { client } = createClient();
        const input = {
            url: "https://example.com/%7Epage?x=1#route",
            nonce_str: "nonce",
            timestamp: 1_700_000_000,
        };
        await expect(
            executeWeComPlatformAction(client, "sign_corp_jsapi_config", input),
        ).resolves.toEqual({
            appId: "ww-corp",
            timestamp: 1_700_000_000,
            nonceStr: "nonce",
            signature: "135a561c2eda88611b0caf051774b908ba21dcce",
        });
        await expect(
            executeWeComPlatformAction(client, "sign_agent_jsapi_config", input),
        ).resolves.toEqual({
            corpid: "ww-corp",
            agentid: 100001,
            timestamp: 1_700_000_000,
            nonceStr: "nonce",
            signature: "af6136a32e40ffbfcc876f6218a69195221c3384",
        });
    });

    it("拒绝非法 scope、过长 code 和错误的可选标量类型", async () => {
        const { client } = createClient();
        await expect(
            executeWeComPlatformAction(client, "build_oauth_url", {
                redirect_uri: "https://example.com/callback",
                scope: "openid",
            }),
        ).rejects.toMatchObject({ code: "WECOM_INVALID_PARAMETER" });
        await expect(
            executeWeComPlatformAction(client, "get_oauth_user_identity", {
                code: "x".repeat(513),
            }),
        ).rejects.toMatchObject({ code: "WECOM_INVALID_PARAMETER" });
        await expect(
            executeWeComPlatformAction(client, "get_corp_jsapi_ticket", { force: "true" }),
        ).rejects.toMatchObject({ code: "WECOM_INVALID_PARAMETER" });
    });
});
