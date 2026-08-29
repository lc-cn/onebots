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
});
