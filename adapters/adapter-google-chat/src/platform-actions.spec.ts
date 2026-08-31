import { describe, expect, it, vi } from "vitest";
import type { GoogleChatClient } from "./client.js";
import { executeGoogleChatPlatformAction } from "./platform-actions.js";

describe("Google Chat 平台动作", () => {
    it("按官方路径发送重复 users 参数、availability 与 read state 请求", async () => {
        const call = vi.fn().mockResolvedValue({});
        const client = { call } as unknown as GoogleChatClient;

        await executeGoogleChatPlatformAction(client, "find_google_chat_group_chats", {
            user_names: ["users/alice", "users/bob@example.com"],
            space_view: "SPACE_VIEW_EXPANDED",
        });
        expect(call).toHaveBeenLastCalledWith("GET", "/v1/spaces:findGroupChats", {
            query: {
                users: ["users/alice", "users/bob@example.com"],
                pageSize: undefined,
                pageToken: undefined,
                spaceView: "SPACE_VIEW_EXPANDED",
            },
        });

        await executeGoogleChatPlatformAction(client, "mark_google_chat_do_not_disturb", {
            user_name: "users/me",
            ttl: "3600s",
        });
        expect(call).toHaveBeenLastCalledWith(
            "POST",
            "/v1/users/me/availability:markAsDoNotDisturb",
            { body: { ttl: "3600s" } },
        );

        await executeGoogleChatPlatformAction(client, "get_google_chat_thread_read_state", {
            name: "users/me/spaces/AAA/threads/T1/threadReadState",
        });
        expect(call).toHaveBeenLastCalledWith(
            "GET",
            "/v1/users/me/spaces/AAA/threads/T1/threadReadState",
        );
    });

    it("拒绝 app 群聊成员、双重 DND 到期条件和畸形 read state", async () => {
        const client = { call: vi.fn() } as unknown as GoogleChatClient;
        await expect(
            executeGoogleChatPlatformAction(client, "find_google_chat_group_chats", {
                user_names: ["users/app"],
            }),
        ).rejects.toThrow(/human user/u);
        await expect(
            executeGoogleChatPlatformAction(client, "mark_google_chat_do_not_disturb", {
                user_name: "users/me",
                ttl: "30s",
                expire_time: "2026-09-01T00:00:00Z",
            }),
        ).rejects.toThrow(/只能提供一个/u);
        await expect(
            executeGoogleChatPlatformAction(client, "get_google_chat_space_read_state", {
                name: "spaces/AAA/spaceReadState",
            }),
        ).rejects.toThrow(/spaceReadState/u);
    });
});
