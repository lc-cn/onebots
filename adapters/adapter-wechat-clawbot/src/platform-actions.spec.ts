import { describe, expect, it, vi } from "vitest";
import type { WechatIlinkBot } from "./bot.js";
import {
    executeWechatClawbotPlatformAction,
    WECHAT_CLAWBOT_PLATFORM_ACTIONS,
} from "./platform-actions.js";

describe("微信 ClawBot 平台动作", () => {
    it("公开当前回复上下文而不伪造缺失令牌", async () => {
        const getLatestContextToken = vi
            .fn()
            .mockResolvedValueOnce("context-1")
            .mockResolvedValueOnce(undefined);
        const client = { getLatestContextToken } as unknown as WechatIlinkBot;
        await expect(
            executeWechatClawbotPlatformAction(client, "get_context_token", {
                user_id: "peer-1",
            }),
        ).resolves.toEqual({ context_token: "context-1" });
        await expect(
            executeWechatClawbotPlatformAction(client, "get_context_token", {
                user_id: "peer-2",
            }),
        ).resolves.toEqual({ context_token: null });
        expect(WECHAT_CLAWBOT_PLATFORM_ACTIONS.size).toBe(3);
    });

    it("拒绝命名动作的未知参数和非安全媒体索引", async () => {
        const downloadRecentMedia = vi.fn();
        const client = { downloadRecentMedia } as unknown as WechatIlinkBot;
        await expect(
            executeWechatClawbotPlatformAction(client, "download_media", {
                message_id: "message-1",
                output: "file",
            }),
        ).rejects.toMatchObject({ code: "INVALID_ACTION_PARAMS" });
        await expect(
            executeWechatClawbotPlatformAction(client, "download_media", {
                message_id: "message-1",
                item_index: Number.MAX_SAFE_INTEGER + 1,
            }),
        ).rejects.toMatchObject({ code: "INVALID_ACTION_PARAMS" });
        expect(downloadRecentMedia).not.toHaveBeenCalled();
    });
});
