import { describe, expect, it, vi } from "vitest";
import { executeTeamsPlatformAction, TEAMS_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("Teams 平台动作", () => {
    it("公开 Activity 成员和 Azure Bot OAuth 原生能力", () => {
        for (const action of [
            "get_activity_members",
            "get_user_token",
            "get_user_aad_tokens",
            "get_user_token_status",
            "sign_out_user",
            "exchange_user_token",
            "reply_to_activity",
            "create_targeted_activity",
            "update_targeted_activity",
            "delete_targeted_activity",
            "send_activity",
        ]) {
            expect(TEAMS_PLATFORM_ACTIONS.has(action)).toBe(true);
        }
    });

    it("发送原生 Activity 并拒绝覆盖可信会话字段", async () => {
        const sendRawActivity = vi.fn().mockResolvedValue({ id: "stream-1" });
        const bot = { sendRawActivity };

        await expect(
            executeTeamsPlatformAction(bot as never, "send_activity", {
                conversation_id: "C1",
                activity: {
                    type: "typing",
                    text: "正在检索…",
                    entities: [
                        { type: "streaminfo", streamType: "informative", streamSequence: 1 },
                    ],
                },
            }),
        ).resolves.toEqual({ id: "stream-1" });
        expect(sendRawActivity).toHaveBeenCalledWith(
            "C1",
            expect.objectContaining({ type: "typing", text: "正在检索…" }),
        );

        await expect(
            executeTeamsPlatformAction(bot as never, "send_activity", {
                conversation_id: "C1",
                activity: { type: "message", text: "伪造", serviceUrl: "https://evil.example" },
            }),
        ).rejects.toMatchObject({ code: "TEAMS_ACTIVITY_CONTEXT_MANAGED" });
    });

    it("按原生参数调用 Activity 成员与 token exchange", async () => {
        const getActivityMembers = vi.fn().mockResolvedValue([{ id: "user-1" }]);
        const exchangeToken = vi.fn().mockResolvedValue({ token: "new-token" });
        const bot = {
            withConversation: vi.fn(async (_conversationId, logic) =>
                logic({
                    client: {
                        conversations: { getActivityMembers },
                        users: { exchangeToken },
                    },
                }),
            ),
        };

        await expect(
            executeTeamsPlatformAction(bot as never, "get_activity_members", {
                conversation_id: "conversation-1",
                message_id: "message-1",
            }),
        ).resolves.toEqual([{ id: "user-1" }]);
        expect(getActivityMembers).toHaveBeenCalledWith("conversation-1", "message-1");

        await expect(
            executeTeamsPlatformAction(bot as never, "exchange_user_token", {
                conversation_id: "conversation-1",
                user_id: "user-1",
                connection_name: "office",
                token: "old-token",
                uri: "api://resource",
            }),
        ).resolves.toEqual({ token: "new-token" });
        expect(exchangeToken).toHaveBeenCalledWith({
            userId: "user-1",
            connectionName: "office",
            channelId: "msteams",
            exchangeRequest: { uri: "api://resource", token: "old-token" },
        });
    });

    it("调用当前 Teams API 的扁平 targeted activity 方法", async () => {
        const replyToActivity = vi.fn().mockResolvedValue({ id: "reply-1" });
        const createTargetedActivity = vi.fn().mockResolvedValue({ id: "target-1" });
        const updateTargetedActivity = vi.fn().mockResolvedValue({ id: "target-1" });
        const deleteTargetedActivity = vi.fn().mockResolvedValue(undefined);
        const bot = {
            withConversation: vi.fn(async (_conversationId, logic) =>
                logic({
                    client: {
                        conversations: {
                            replyToActivity,
                            createTargetedActivity,
                            updateTargetedActivity,
                            deleteTargetedActivity,
                        },
                    },
                }),
            ),
        };

        await executeTeamsPlatformAction(bot as never, "reply_to_activity", {
            conversation_id: "C1",
            activity_id: "M1",
            activity: { type: "message", text: "reply" },
        });
        await executeTeamsPlatformAction(bot as never, "create_targeted_activity", {
            conversation_id: "C1",
            activity: { type: "message", text: "private" },
        });
        await executeTeamsPlatformAction(bot as never, "update_targeted_activity", {
            conversation_id: "C1",
            activity_id: "M2",
            activity: { type: "message", text: "updated" },
        });
        await executeTeamsPlatformAction(bot as never, "delete_targeted_activity", {
            conversation_id: "C1",
            activity_id: "M2",
        });

        expect(replyToActivity).toHaveBeenCalledWith("C1", "M1", {
            type: "message",
            text: "reply",
        });
        expect(createTargetedActivity).toHaveBeenCalledWith("C1", {
            type: "message",
            text: "private",
        });
        expect(updateTargetedActivity).toHaveBeenCalledWith("C1", "M2", {
            type: "message",
            text: "updated",
        });
        expect(deleteTargetedActivity).toHaveBeenCalledWith("C1", "M2");
    });

    it("拒绝类型错误的可选参数而不是静默忽略", async () => {
        const bot = {
            withConversation: vi.fn(async (_conversationId, logic) =>
                logic({ client: { conversations: { getPagedMembers: vi.fn() } } }),
            ),
        };
        await expect(
            executeTeamsPlatformAction(bot as never, "list_conversation_members_paged", {
                conversation_id: "C1",
                page_size: "100",
            }),
        ).rejects.toMatchObject({ code: "TEAMS_PARAM_INVALID" });
    });

    it("文件上传只引用已认证 consent Activity，不接受调用方提供目标 URL", async () => {
        const completeFileConsentUpload = vi.fn().mockResolvedValue({ upload: { status: 201 } });
        const bot = { completeFileConsentUpload };

        await executeTeamsPlatformAction(bot as never, "complete_file_consent_upload", {
            consent_activity_id: "consent-1",
            source: "base64://aGVsbG8=",
        });

        expect(completeFileConsentUpload).toHaveBeenCalledWith("consent-1", {
            source: "base64://aGVsbG8=",
            filename: undefined,
            contentType: undefined,
        });
    });
});
