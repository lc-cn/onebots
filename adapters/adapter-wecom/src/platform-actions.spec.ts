import { describe, expect, it, vi } from "vitest";
import type { WeComClient } from "./client.js";
import { executeWeComPlatformAction, WECOM_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("企业微信平台动作", () => {
    it("应用群聊使用 appchat 原生 API", async () => {
        const sendAppChatMessage = vi.fn().mockResolvedValue("m1");
        const client = { sendAppChatMessage } as unknown as WeComClient;
        await executeWeComPlatformAction(client, "send_appchat_message", {
            chat_id: "chat1",
            message: { msgtype: "text", text: { content: "hi" } },
        });
        expect(sendAppChatMessage).toHaveBeenCalledWith(
            "chat1",
            expect.objectContaining({ msgtype: "text" }),
        );
    });

    it("公开通讯录、媒体和通用 API 能力", () => {
        expect(WECOM_PLATFORM_ACTIONS.has("create_appchat")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("upload_temporary_media")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("batch_get_external_contacts")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("list_external_contact_groups")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("add_group_welcome_template")).toBe(true);
        expect(WECOM_PLATFORM_ACTIONS.has("wecom_call")).toBe(true);
    });
});
