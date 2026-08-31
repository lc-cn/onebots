import { describe, expect, test, vi } from "vitest";
import { executeKookPlatformAction } from "./platform-actions.js";

describe("KOOK 用户平台动作", () => {
    test("按官方字段调用私信会话接口", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await executeKookPlatformAction(bot, "list_user_chats", { page: 2, page_size: 50 });
        await executeKookPlatformAction(bot, "get_user_chat", { chat_code: "chat-1" });
        await executeKookPlatformAction(bot, "create_user_chat", { target_id: "user-1" });
        await executeKookPlatformAction(bot, "delete_user_chat", { chat_code: "chat-1" });

        expect(callApi.mock.calls).toEqual([
            ["/v3/user-chat/list", { query: { page: 2, page_size: 50 } }],
            ["/v3/user-chat/view", { query: { chat_code: "chat-1" } }],
            ["/v3/user-chat/create", { method: "POST", body: { target_id: "user-1" } }],
            ["/v3/user-chat/delete", { method: "POST", body: { chat_code: "chat-1" } }],
        ]);
    });

    test("闭合亲密度字段与官方数值范围", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;

        await executeKookPlatformAction(bot, "get_intimacy", { user_id: "user-1" });
        await executeKookPlatformAction(bot, "update_intimacy", {
            user_id: "user-1",
            score: 2_200,
            social_info: "好友",
            img_id: "image-1",
        });
        await executeKookPlatformAction(bot, "update_intimacy", {
            user_id: "user-1",
            social_info: "",
        });

        expect(callApi.mock.calls).toEqual([
            ["/v3/intimacy/index", { query: { user_id: "user-1" } }],
            [
                "/v3/intimacy/update",
                {
                    method: "POST",
                    body: {
                        user_id: "user-1",
                        score: 2_200,
                        social_info: "好友",
                        img_id: "image-1",
                    },
                },
            ],
            [
                "/v3/intimacy/update",
                { method: "POST", body: { user_id: "user-1", social_info: "" } },
            ],
        ]);

        await expect(
            executeKookPlatformAction(bot, "update_intimacy", {
                user_id: "user-1",
                score: 2_201,
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
    });

    test("拒绝缺失必填字段、超限分页与未声明字段", async () => {
        const bot = { callApi: vi.fn() } as never;

        await expect(executeKookPlatformAction(bot, "get_user_chat", {})).rejects.toMatchObject({
            code: "KOOK_ACTION_PARAM_REQUIRED",
        });
        await expect(
            executeKookPlatformAction(bot, "list_user_chats", { page_size: 51 }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_INVALID" });
        await expect(
            executeKookPlatformAction(bot, "create_user_chat", {
                target_id: "user-1",
                unexpected: true,
            }),
        ).rejects.toMatchObject({ code: "KOOK_ACTION_PARAM_UNKNOWN" });
    });
});
