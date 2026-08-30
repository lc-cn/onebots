import { describe, expect, it, vi } from "vitest";
import { feishuCapabilities } from "./capabilities.js";
import { executeFeishuPlatformAction, FEISHU_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("executeFeishuPlatformAction", () => {
    it("所有已注册平台动作都公开能力声明", () => {
        for (const action of FEISHU_PLATFORM_ACTIONS) {
            expect(feishuCapabilities.actions[action]?.support).toBe("native");
        }
    });

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

    it("通用入口复用核心安全路径规则", async () => {
        await expect(
            executeFeishuPlatformAction({ callApi: vi.fn() } as never, "call_feishu_api", {
                path: "/im/v1/%2e%2e/auth",
            }),
        ).rejects.toMatchObject({ code: "FEISHU_INVALID_PARAM" });
    });

    it("拒绝显式传入的无效可选参数", async () => {
        const bot = { callApi: vi.fn() } as never;
        await expect(
            executeFeishuPlatformAction(bot, "call_feishu_api", {
                path: "/im/v1/messages",
                method: null,
            }),
        ).rejects.toMatchObject({ code: "FEISHU_INVALID_PARAM" });
        await expect(
            executeFeishuPlatformAction(bot, "call_feishu_api", {
                path: "/im/v1/messages",
                body: null,
            }),
        ).rejects.toMatchObject({ code: "FEISHU_INVALID_PARAM" });
        await expect(
            executeFeishuPlatformAction(bot, "merge_forward_messages", {
                receive_id: "oc_1",
                receive_id_type: null,
                message_id_list: ["om_1"],
            }),
        ).rejects.toMatchObject({ code: "FEISHU_INVALID_PARAM" });
        await expect(
            executeFeishuPlatformAction(bot, "forward_message", {
                message_id: "om_1",
                receive_id: "ou_1",
                receive_id_type: "invalid",
            }),
        ).rejects.toMatchObject({ code: "FEISHU_INVALID_PARAM" });
    });

    it("支持合并转发与查询消息已读用户", async () => {
        const callApi = vi.fn().mockResolvedValue({ code: 0 });
        const bot = { callApi } as never;
        await executeFeishuPlatformAction(bot, "merge_forward_messages", {
            receive_id_type: "chat_id",
            receive_id: "oc_1",
            message_id_list: ["om_1", "om_2"],
            uuid: "request-1",
        });
        expect(callApi).toHaveBeenCalledWith("/im/v1/messages/merge_forward", {
            method: "POST",
            params: { receive_id_type: "chat_id", uuid: "request-1" },
            body: { receive_id: "oc_1", message_id_list: ["om_1", "om_2"] },
        });

        await executeFeishuPlatformAction(bot, "get_message_read_users", {
            message_id: "om_1",
            page_size: 20,
        });
        expect(callApi).toHaveBeenLastCalledWith("/im/v1/messages/om_1/read_users", {
            params: { user_id_type: "open_id", page_size: 20 },
        });
    });

    it("把消息和话题转发参数放入开放平台要求的位置", async () => {
        const callApi = vi.fn().mockResolvedValue({ code: 0 });
        const bot = { callApi } as never;

        await executeFeishuPlatformAction(bot, "forward_message", {
            message_id: "om_1",
            receive_id: "oc_1",
            receive_id_type: "chat_id",
            uuid: "forward-1",
        });
        expect(callApi).toHaveBeenLastCalledWith("/im/v1/messages/om_1/forward", {
            method: "POST",
            params: { receive_id_type: "chat_id", uuid: "forward-1" },
            body: { receive_id: "oc_1" },
        });

        await executeFeishuPlatformAction(bot, "forward_thread", {
            thread_id: "omt_1",
            receive_id: "ou_1",
        });
        expect(callApi).toHaveBeenLastCalledWith("/im/v1/threads/omt_1/forward", {
            method: "POST",
            params: { receive_id_type: "open_id" },
            body: { receive_id: "ou_1" },
        });
    });

    it("正确拆分群创建、成员和管理员动作的 query 与 body", async () => {
        const callApi = vi.fn().mockResolvedValue({ code: 0 });
        const bot = { callApi } as never;

        await executeFeishuPlatformAction(bot, "create_chat", {
            name: "项目群",
            user_id_type: "union_id",
            set_bot_manager: true,
            uuid: "chat-1",
        });
        expect(callApi).toHaveBeenLastCalledWith("/im/v1/chats", {
            method: "POST",
            params: { user_id_type: "union_id", set_bot_manager: true, uuid: "chat-1" },
            body: { name: "项目群" },
        });

        await executeFeishuPlatformAction(bot, "add_chat_members", {
            chat_id: "oc_1",
            id_list: ["ou_1"],
            succeed_type: 1,
        });
        expect(callApi).toHaveBeenLastCalledWith("/im/v1/chats/oc_1/members", {
            method: "POST",
            params: { member_id_type: "open_id", succeed_type: 1 },
            body: { id_list: ["ou_1"] },
        });

        await executeFeishuPlatformAction(bot, "add_chat_managers", {
            chat_id: "oc_1",
            manager_ids: ["ou_1"],
        });
        expect(callApi).toHaveBeenLastCalledWith("/im/v1/chats/oc_1/managers/add_managers", {
            method: "POST",
            params: { member_id_type: "open_id" },
            body: { manager_ids: ["ou_1"] },
        });
    });

    it("公开飞书原生互动、公告与批量消息管理动作", async () => {
        const callApi = vi.fn().mockResolvedValue({ code: 0 });
        const bot = { callApi } as never;

        await executeFeishuPlatformAction(bot, "push_follow_up", {
            message_id: "om_1",
            follow_ups: [{ content: "继续" }],
        });
        expect(callApi).toHaveBeenLastCalledWith("/im/v1/messages/om_1/push_follow_up", {
            method: "POST",
            body: { follow_ups: [{ content: "继续" }] },
        });

        await executeFeishuPlatformAction(bot, "get_chat_announcement", { chat_id: "oc_1" });
        expect(callApi).toHaveBeenLastCalledWith("/im/v1/chats/oc_1/announcement", {
            params: { user_id_type: "open_id" },
        });

        await executeFeishuPlatformAction(bot, "get_batch_message_progress", {
            batch_message_id: "bm_1",
        });
        expect(callApi).toHaveBeenLastCalledWith("/im/v1/batch_messages/bm_1/get_progress");
    });
});
