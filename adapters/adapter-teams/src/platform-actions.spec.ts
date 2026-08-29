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
        ]) {
            expect(TEAMS_PLATFORM_ACTIONS.has(action)).toBe(true);
        }
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
});
