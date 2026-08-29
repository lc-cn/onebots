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

describe("Zulip 平台动作", () => {
    it("消息反应使用官方路径和字段", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, "add_reaction", {
            message_id: 42,
            emoji_name: "thumbs_up",
            emoji_code: "1f44d",
            reaction_type: "unicode_emoji",
        });

        expect(call).toHaveBeenCalledWith("messages/42/reactions", "POST", {
            emoji_name: "thumbs_up",
            emoji_code: "1f44d",
            reaction_type: "unicode_emoji",
        });
    });

    it("底层调用拒绝绝对 URL 和非法方法", async () => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        await expect(
            executeZulipPlatformAction(client, "call_zulip_api", {
                path: "https://evil.example",
                method: "GET",
                params: {},
            }),
        ).rejects.toMatchObject({ code: "ZULIP_INVALID_API_PATH" });
        await expect(
            executeZulipPlatformAction(client, "call_zulip_api", {
                path: "messages",
                method: "PUT",
                params: {},
            }),
        ).rejects.toMatchObject({ code: "ZULIP_INVALID_ACTION_PARAM" });
    });

    it.each([
        ["edit_scheduled_message", "scheduled_messages/12", "scheduled_message_id"],
        ["edit_draft", "drafts/12", "draft_id"],
        ["delete_reminder", "reminders/12", "reminder_id"],
        ["edit_saved_snippet", "saved_snippets/12", "saved_snippet_id"],
    ])("%s 使用官方资源路径并移除路径参数", async (action, path, idField) => {
        const client = new ZulipClient(config, { transport: async () => ({}) });
        const call = vi.spyOn(client, "call").mockResolvedValue({ result: "success", msg: "" });

        await executeZulipPlatformAction(client, action, { [idField]: 12, content: "updated" });

        expect(call).toHaveBeenCalledWith(path, action.startsWith("delete_") ? "DELETE" : "PATCH", {
            content: "updated",
        });
    });
});
