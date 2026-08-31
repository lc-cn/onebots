import { describe, expect, it, vi } from "vitest";
import type { WechatClient } from "./client.js";
import { executeWechatPlatformAction, WECHAT_PLATFORM_ACTIONS } from "./platform-actions.js";

function mockClient() {
    const call = vi.fn().mockResolvedValue({ errcode: 0 });
    return { client: { call } as unknown as WechatClient, call };
}

describe("微信公众号多客服动作", () => {
    it("新增、查询和删除客服账号使用官方端点", async () => {
        const { client, call } = mockClient();
        await executeWechatPlatformAction(client, "add_customer_service_account", {
            account: { kf_account: "support@example", nickname: "客服" },
        });
        await executeWechatPlatformAction(client, "delete_customer_service_account", {
            kf_account: "support@example",
        });
        await executeWechatPlatformAction(client, "list_customer_service_accounts", {});
        expect(call.mock.calls).toEqual([
            [
                {
                    method: "POST",
                    path: "/customservice/kfaccount/add",
                    body: { kf_account: "support@example", nickname: "客服" },
                },
            ],
            [
                {
                    path: "/customservice/kfaccount/del",
                    query: { kf_account: "support@example" },
                },
            ],
            [{ path: "/cgi-bin/customservice/getkflist" }],
        ]);
    });

    it("客服头像通过受控 multipart 请求上传", async () => {
        const { client, call } = mockClient();
        await executeWechatPlatformAction(client, "upload_customer_service_avatar", {
            kf_account: "support@example",
            data: Buffer.from("avatar").toString("base64"),
            filename: "avatar.jpg",
        });
        expect(call).toHaveBeenCalledWith({
            method: "POST",
            path: "/customservice/kfaccount/uploadheadimg",
            query: { kf_account: "support@example" },
            body: expect.any(FormData),
        });
    });

    it("公开客服会话能力并拒绝非法头像", async () => {
        const { client, call } = mockClient();
        expect(WECHAT_PLATFORM_ACTIONS.has("create_customer_service_session")).toBe(true);
        expect(WECHAT_PLATFORM_ACTIONS.has("get_customer_service_message_records")).toBe(true);
        await expect(
            executeWechatPlatformAction(client, "upload_customer_service_avatar", {
                kf_account: "support@example",
                data: "not-base64",
            }),
        ).rejects.toMatchObject({ code: "WECHAT_INVALID_PARAMETER" });
        expect(call).not.toHaveBeenCalled();
    });
});
