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

    it.each([
        ["mute_user", { user_id: 12, unexpected: true }],
        ["add_alert_words", { alert_words: [] }],
        ["add_alert_words", { alert_words: ["x".repeat(101)] }],
        ["update_user_status", {}],
        ["update_user_status", { status_text: "x".repeat(61) }],
        ["update_status_for_user", { user_id: 12, reaction_type: "unknown" }],
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
