import { describe, expect, it } from "vitest";
import { isTeamsGroupConversation } from "./adapter.js";
import type { TeamsConversationReference } from "./types.js";

const reference = (conversationType: string, isGroup = true): TeamsConversationReference => ({
    channelId: "msteams",
    conversation: { id: "conversation", conversationType, isGroup },
});

describe("Teams 会话资源分类", () => {
    it("只把 groupChat 投影为 canonical Group", () => {
        expect(isTeamsGroupConversation(reference("groupChat"))).toBe(true);
        expect(isTeamsGroupConversation(reference("channel"))).toBe(false);
        expect(isTeamsGroupConversation(reference("personal", false))).toBe(false);
    });
});
