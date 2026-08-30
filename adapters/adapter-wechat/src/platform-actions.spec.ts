import { describe, expect, it, vi } from "vitest";
import type { WechatClient } from "./client.js";
import { WechatApiError } from "./errors.js";
import { executeWechatPlatformAction, WECHAT_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("微信公众号平台动作", () => {
    it("将标签作为原生受众管理 API，而不是通用群聊", async () => {
        const call = vi.fn().mockResolvedValue({ errcode: 0 });
        const client = { call } as unknown as WechatClient;
        await executeWechatPlatformAction(client, "tag_users", {
            openids: ["u1", "u2"],
            tag_id: 7,
        });
        expect(call).toHaveBeenCalledWith({
            method: "POST",
            path: "/cgi-bin/tags/members/batchtagging",
            body: { openid_list: ["u1", "u2"], tagid: 7 },
        });
    });

    it("提供通用安全调用覆盖未来接口", async () => {
        const call = vi.fn().mockResolvedValue({ ok: true });
        const client = { call } as unknown as WechatClient;
        await executeWechatPlatformAction(client, "wechat_call", {
            method: "POST",
            path: "/cgi-bin/new/action",
            body: { value: 1 },
        });
        expect(call).toHaveBeenCalledWith(expect.objectContaining({ path: "/cgi-bin/new/action" }));
        expect(WECHAT_PLATFORM_ACTIONS.size).toBe(79);
        expect(WECHAT_PLATFORM_ACTIONS.has("publish_draft")).toBe(true);
        expect(WECHAT_PLATFORM_ACTIONS.has("mass_send_by_tag")).toBe(true);
        expect(WECHAT_PLATFORM_ACTIONS.has("get_wechat_user_info")).toBe(true);
        expect(WECHAT_PLATFORM_ACTIONS.has("get_user_info")).toBe(false);
        expect(WECHAT_PLATFORM_ACTIONS.has("list_customer_service_accounts")).toBe(true);
        expect(WECHAT_PLATFORM_ACTIONS.has("get_api_quota")).toBe(true);
        expect(WECHAT_PLATFORM_ACTIONS.has("get_api_request_details")).toBe(true);
        expect(WECHAT_PLATFORM_ACTIONS.has("clear_api_quota_by_app_secret")).toBe(true);
    });

    it("跨领域分派素材动作并保留未知动作错误", async () => {
        const call = vi.fn().mockResolvedValue({ media_id: "draft-1" });
        const client = { call } as unknown as WechatClient;
        await executeWechatPlatformAction(client, "get_draft", { media_id: "draft-1" });
        expect(call).toHaveBeenCalledWith({
            method: "POST",
            path: "/cgi-bin/draft/get",
            body: { media_id: "draft-1" },
        });

        const promise = executeWechatPlatformAction(client, "missing_action", {});
        await expect(promise).rejects.toBeInstanceOf(WechatApiError);
        await expect(promise).rejects.toMatchObject({ code: "WECHAT_UNKNOWN_ACTION" });
    });

    it("提供受控的 API 配额与 RID 诊断动作", async () => {
        const call = vi.fn().mockResolvedValue({ errcode: 0 });
        const client = {
            call,
            config: { app_id: "wx-app", app_secret: "secret" },
        } as unknown as WechatClient;

        await executeWechatPlatformAction(client, "get_api_quota", {
            path: "/cgi-bin/message/custom/send",
        });
        expect(call).toHaveBeenLastCalledWith({
            method: "POST",
            path: "/cgi-bin/openapi/quota/get",
            body: { cgi_path: "/cgi-bin/message/custom/send" },
        });

        await executeWechatPlatformAction(client, "clear_api_quota_by_app_secret", {});
        expect(call).toHaveBeenLastCalledWith({
            method: "POST",
            path: "/cgi-bin/clear_quota/v2",
            query: { appid: "wx-app", appsecret: "secret" },
            token: false,
        });

        await expect(
            executeWechatPlatformAction(client, "get_api_quota", {
                path: "https://evil.example/api",
            }),
        ).rejects.toMatchObject({ code: "WECHAT_INVALID_PARAMETER" });
    });
});
