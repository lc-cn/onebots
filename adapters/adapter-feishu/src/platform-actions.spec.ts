import { describe, expect, it, vi } from "vitest";
import { executeFeishuPlatformAction } from "./platform-actions.js";

describe("executeFeishuPlatformAction", () => {
    it("按开放平台 endpoint 回复消息", async () => {
        const callApi = vi.fn().mockResolvedValue({ code: 0 });
        await executeFeishuPlatformAction({ callApi } as never, "reply_message", {
            message_id: "om_1",
            msg_type: "text",
            content: '{"text":"ok"}',
        });
        expect(callApi).toHaveBeenCalledWith("/im/v1/messages/om_1/reply", {
            method: "POST",
            body: { msg_type: "text", content: '{"text":"ok"}' },
        });
    });

    it("通用入口拒绝目录穿越 path", async () => {
        await expect(
            executeFeishuPlatformAction({ callApi: vi.fn() } as never, "call_feishu_api", {
                path: "/im/v1/../auth",
            }),
        ).rejects.toMatchObject({ code: "FEISHU_INVALID_PARAM" });
    });
});
