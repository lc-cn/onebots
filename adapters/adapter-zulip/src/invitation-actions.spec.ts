import { describe, expect, it, vi } from "vitest";
import { ZulipClient } from "./client.js";
import { executeZulipPlatformAction } from "./platform-actions.js";
import type { ZulipConfig } from "./types.js";

const config: ZulipConfig = {
    account_id: "bot",
    server_url: "https://example.zulipchat.com",
    email: "bot@example.com",
    api_key: "secret",
};

describe("Zulip 邀请动作", () => {
    it("完整覆盖邀请查询、创建、重发和两类撤销路径", async () => {
        const { client, call } = mockClient();

        await executeZulipPlatformAction(client, "list_invitations", {});
        await executeZulipPlatformAction(client, "send_invitations", {
            invitee_emails: "alice@example.com,bob@example.com",
            stream_ids: [1, 10],
            group_ids: [20],
            invite_as: 400,
            notify_referrer_on_join: false,
        });
        await executeZulipPlatformAction(client, "create_invitation_link", {
            invite_expires_in_minutes: null,
            include_realm_default_subscriptions: true,
            welcome_message_custom_text: "欢迎加入",
        });
        await executeZulipPlatformAction(client, "resend_email_invitation", { invite_id: 7 });
        await executeZulipPlatformAction(client, "revoke_email_invitation", { invite_id: 7 });
        await executeZulipPlatformAction(client, "revoke_invitation_link", { invite_id: 9 });

        expect(call).toHaveBeenNthCalledWith(1, "invites");
        expect(call).toHaveBeenNthCalledWith(2, "invites", "POST", {
            invitee_emails: "alice@example.com,bob@example.com",
            stream_ids: [1, 10],
            group_ids: [20],
            invite_as: 400,
            notify_referrer_on_join: false,
        });
        expect(call).toHaveBeenNthCalledWith(3, "invites/multiuse", "POST", {
            invite_expires_in_minutes: null,
            include_realm_default_subscriptions: true,
            welcome_message_custom_text: "欢迎加入",
        });
        expect(call).toHaveBeenNthCalledWith(4, "invites/7/resend", "POST");
        expect(call).toHaveBeenNthCalledWith(5, "invites/7", "DELETE");
        expect(call).toHaveBeenNthCalledWith(6, "invites/multiuse/9", "DELETE");
    });

    it.each([
        ["list_invitations", { unexpected: true }],
        ["send_invitations", { invitee_emails: "alice@example.com" }],
        [
            "send_invitations",
            { invitee_emails: "alice@example.com", stream_ids: [1], invite_as: 500 },
        ],
        ["create_invitation_link", { notify_referrer_on_join: true }],
        ["create_invitation_link", { welcome_message_custom_text: "x".repeat(8001) }],
        ["resend_email_invitation", { invite_id: 7, unexpected: true }],
    ])("%s 在请求前拒绝非官方参数", async (action, params) => {
        const { client, call } = mockClient();

        await expect(executeZulipPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
        expect(call).not.toHaveBeenCalled();
    });
});

function mockClient(): { client: ZulipClient; call: ReturnType<typeof vi.spyOn> } {
    const client = new ZulipClient(config, { transport: async () => ({}) });
    const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });
    return { client, call };
}
