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

describe("Zulip 个人偏好动作", () => {
    it("使用官方静音、提醒词与用户状态路径", async () => {
        const { client, call } = mockClient();

        await executeZulipPlatformAction(client, "mute_user", { user_id: 12 });
        await executeZulipPlatformAction(client, "unmute_user", { user_id: 12 });
        await executeZulipPlatformAction(client, "get_alert_words", {});
        await executeZulipPlatformAction(client, "add_alert_words", {
            alert_words: ["production", "值班"],
        });
        await executeZulipPlatformAction(client, "remove_alert_words", {
            alert_words: ["production"],
        });
        await executeZulipPlatformAction(client, "get_user_status", { user_id: 12 });
        await executeZulipPlatformAction(client, "update_user_status", { status_text: "" });
        await executeZulipPlatformAction(client, "update_status_for_user", {
            user_id: 12,
            emoji_name: "car",
            emoji_code: "1f697",
            reaction_type: "unicode_emoji",
        });

        expect(call).toHaveBeenNthCalledWith(1, "users/me/muted_users/12", "POST");
        expect(call).toHaveBeenNthCalledWith(2, "users/me/muted_users/12", "DELETE");
        expect(call).toHaveBeenNthCalledWith(3, "users/me/alert_words");
        expect(call).toHaveBeenNthCalledWith(4, "users/me/alert_words", "POST", {
            alert_words: ["production", "值班"],
        });
        expect(call).toHaveBeenNthCalledWith(5, "users/me/alert_words", "DELETE", {
            alert_words: ["production"],
        });
        expect(call).toHaveBeenNthCalledWith(6, "users/12/status");
        expect(call).toHaveBeenNthCalledWith(7, "users/me/status", "POST", { status_text: "" });
        expect(call).toHaveBeenNthCalledWith(8, "users/12/status", "POST", {
            emoji_name: "car",
            emoji_code: "1f697",
            reaction_type: "unicode_emoji",
        });
    });

    it("通过统一端点更新本人及管理员批量个人设置", async () => {
        const { client, call } = mockClient();

        await executeZulipPlatformAction(client, "update_user_settings", {
            color_scheme: 2,
            web_home_view: "inbox",
            send_read_receipts: false,
        });
        await executeZulipPlatformAction(client, "update_user_settings_for_users", {
            target_users: { group_ids: [4], skip_if_already_edited: true },
            enable_drafts_synchronization: true,
        });
        await executeZulipPlatformAction(client, "update_default_user_settings", {
            web_channel_default_view: 3,
            send_read_receipts: true,
        });

        expect(call).toHaveBeenNthCalledWith(1, "settings", "PATCH", {
            color_scheme: 2,
            web_home_view: "inbox",
            send_read_receipts: false,
        });
        expect(call).toHaveBeenNthCalledWith(2, "settings", "PATCH", {
            target_users: { group_ids: [4], skip_if_already_edited: true },
            enable_drafts_synchronization: true,
        });
        expect(call).toHaveBeenNthCalledWith(3, "realm/user_settings_defaults", "PATCH", {
            web_channel_default_view: 3,
            send_read_receipts: true,
        });
    });

    it.each([
        ["mute_user", { user_id: 12, unexpected: true }],
        ["add_alert_words", { alert_words: [] }],
        ["add_alert_words", { alert_words: ["x".repeat(101)] }],
        ["update_user_status", {}],
        ["update_user_status", { status_text: "x".repeat(61) }],
        ["update_status_for_user", { user_id: 12, reaction_type: "unknown" }],
        ["update_user_settings", {}],
        ["update_user_settings", { dense_mode: true }],
        ["update_user_settings", { color_scheme: 4 }],
        ["update_user_settings", { new_password: "new-secret" }],
        ["update_user_settings", { target_users: { user_ids: [1] }, color_scheme: 2 }],
        ["update_user_settings_for_users", { color_scheme: 2 }],
        [
            "update_user_settings_for_users",
            { target_users: { skip_if_already_edited: true }, color_scheme: 2 },
        ],
        [
            "update_user_settings_for_users",
            { target_users: { user_ids: [1] }, full_name: "Other user" },
        ],
        ["update_default_user_settings", {}],
        ["update_default_user_settings", { default_language: "zh_CN" }],
        ["update_default_user_settings", { web_channel_default_view: 5 }],
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
