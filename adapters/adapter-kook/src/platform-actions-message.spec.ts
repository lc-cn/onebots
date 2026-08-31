import { describe, expect, test, vi } from "vitest";
import { executeKookPlatformAction } from "./platform-actions.js";

describe("KOOK 消息扩展动作", () => {
    test("频道历史使用官方参考消息分页字段", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await executeKookPlatformAction(bot, "list_channel_messages", {
            target_id: "channel",
            msg_id: "message",
            pin: 1,
            flag: "before",
            page_size: 50,
        });

        expect(callApi).toHaveBeenCalledWith("/v3/message/list", {
            query: {
                target_id: "channel",
                msg_id: "message",
                pin: 1,
                flag: "before",
                page_size: 50,
            },
        });
        await expect(
            executeKookPlatformAction(bot, "list_channel_messages", {
                target_id: "channel",
                pin: 2,
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
        await expect(
            executeKookPlatformAction(bot, "list_channel_messages", {}),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_REQUIRED" });
        await expect(
            executeKookPlatformAction(bot, "list_channel_messages", { page: 1 }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_UNKNOWN" });
    });

    test("私信历史要求会话或用户目标，并限制分页大小", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await executeKookPlatformAction(bot, "list_direct_messages", {
            target_id: "user",
            page: 2,
            page_size: 50,
        });
        expect(callApi).toHaveBeenCalledWith("/v3/direct-message/list", {
            query: { target_id: "user", page: 2, page_size: 50 },
        });

        await expect(
            executeKookPlatformAction(bot, "list_direct_messages", {}),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_REQUIRED" });
        await expect(
            executeKookPlatformAction(bot, "list_direct_messages", {
                chat_code: "chat",
                page_size: 51,
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
    });

    test("管道消息分离访问令牌查询参数与模板输入 body", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await executeKookPlatformAction(bot, "send_pipe_message", {
            access_token: "pipe-token",
            type: 9,
            target_id: "channel",
            body: { title: "构建完成", build: 42 },
        });
        expect(callApi).toHaveBeenCalledWith("/v3/message/send-pipemsg", {
            method: "POST",
            query: { access_token: "pipe-token", type: 9, target_id: "channel" },
            body: { title: "构建完成", build: 42 },
        });

        await expect(
            executeKookPlatformAction(bot, "send_pipe_message", {
                access_token: "pipe-token",
                body: {},
                content: "错误的顶层字段",
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_UNKNOWN" });
        await expect(
            executeKookPlatformAction(bot, "send_pipe_message", {
                access_token: "pipe-token",
                type: 12,
                body: {},
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
        await expect(
            executeKookPlatformAction(bot, "send_pipe_message", {
                access_token: "pipe-token",
                body: [],
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
        await expect(
            executeKookPlatformAction(bot, "send_pipe_message", {
                access_token: "pipe-token",
                body: new Date(0),
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
        await expect(
            executeKookPlatformAction(bot, "send_pipe_message", { body: {} }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_REQUIRED" });
    });
});
