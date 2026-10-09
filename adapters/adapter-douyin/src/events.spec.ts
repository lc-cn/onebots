import type { AnyNoticeEvent, GroupJoinRequest, MessageEvent } from "douyin-im";
import { describe, expect, it, vi } from "vitest";
import type { CommonTypes } from "onebots";
import { projectDouyinGroupRequest, projectDouyinMessage, projectDouyinNotice } from "./events.js";

vi.mock("douyin-im/protocol", () => ({
    parseMessageContent: (content: string) => {
        const parsed = JSON.parse(content) as { text: string };
        return { kind: "text", text: parsed.text, aweType: 0 };
    },
}));

const createId = (source: string | number): CommonTypes.Id => ({
    source,
    string: String(source),
    number: Number(source),
});
const context = { botId: createId("bot"), createId };

describe("Douyin 事件投影", () => {
    it("完整投影入群申请的申请人、群、理由和 flag", () => {
        const event = {
            requestId: "request-1",
            time: 1_700_000_000,
            applicantUid: "applicant-1",
            displayName: "申请人",
            applicantAvatar: "https://example.com/avatar.png",
            reason: "申请理由",
            group: { groupId: "group-1", name: "测试群" },
        } as unknown as GroupJoinRequest;

        expect(projectDouyinGroupRequest(event, context)).toMatchObject({
            id: createId("request:request-1"),
            timestamp: 1_700_000_000_000,
            type: "request",
            request_type: "group",
            sub_type: "add",
            user: {
                id: createId("applicant-1"),
                name: "申请人",
                avatar: "https://example.com/avatar.png",
            },
            group: { id: createId("group-1"), name: "测试群" },
            comment: "申请理由",
            flag: "request-1",
        });
    });

    it("无平台消息 ID 时生成稳定且可区分的 fallback ID", () => {
        const base = {
            isGroup: false,
            chatType: "private",
            threadId: "conversation-1",
            conversationShortId: "short-1",
            senderUid: "user-1",
            time: 1_700_000_000,
            messageType: 1,
            rawContent: '{"text":"第一条"}',
            text: "第一条",
            content: { kind: "text", text: "第一条", aweType: 0 },
            mentions: [],
            friend: { nickname: "用户" },
        } as unknown as MessageEvent;
        const changed = {
            ...base,
            rawContent: '{"text":"第二条"}',
            text: "第二条",
            content: { kind: "text", text: "第二条", aweType: 0 },
        } as unknown as MessageEvent;

        const first = projectDouyinMessage(base, context);
        expect(projectDouyinMessage(base, context).id).toEqual(first.id);
        expect(projectDouyinMessage(changed, context).id).not.toEqual(first.id);
    });

    it("reaction ID 包含行为人、emoji 与 enabled，并使用 user 字段", () => {
        const event = reaction({ operatorUid: "user-1", emoji: "👍", enabled: true });
        const projected = projectDouyinNotice(event, context);

        expect(projected).toMatchObject({
            notice_type: "reaction_added",
            message_id: createId("message-1"),
            user: { id: createId("user-1") },
            reaction: "👍",
            sub_type: "group",
            scene_id: createId("conversation-1"),
            group: { id: createId("conversation-1") },
        });
        expect(projected).not.toHaveProperty("operator");
        expect(projectDouyinNotice(event, context)?.id).toEqual(projected?.id);
        expect(
            projectDouyinNotice(
                reaction({ operatorUid: "user-2", emoji: "👍", enabled: true }),
                context,
            )?.id,
        ).not.toEqual(projected?.id);
        expect(
            projectDouyinNotice(
                reaction({ operatorUid: "user-1", emoji: "❤️", enabled: true }),
                context,
            )?.id,
        ).not.toEqual(projected?.id);
        expect(
            projectDouyinNotice(
                reaction({ operatorUid: "user-1", emoji: "👍", enabled: false }),
                context,
            )?.id,
        ).not.toEqual(projected?.id);
    });

    it("delete 使用 client ID fallback 并保留 private 会话上下文", () => {
        const event = {
            type: "message.delete",
            time: 1_700_000_000,
            conversationId: "private-conversation",
            conversationType: 1,
            serverMessageId: undefined,
            clientMessageId: "client-message",
            message: {
                senderUid: "sender-1",
                content: "",
                msgType: 1,
            },
        } as unknown as AnyNoticeEvent;

        expect(projectDouyinNotice(event, context)).toMatchObject({
            notice_type: "message_deleted",
            message_id: createId("client-message"),
            user: { id: createId("sender-1") },
            sub_type: "private",
            scene_id: createId("private-conversation"),
            group: undefined,
        });
    });

    it("update 解析 SDK message content 并保留 group 会话上下文", () => {
        const event = {
            type: "message.update",
            time: 1_700_000_000,
            conversationId: "group-conversation",
            conversationType: 2,
            serverMessageId: "message-1",
            clientMessageId: "client-message",
            message: {
                senderUid: "sender-1",
                content: '{"text":"更新后"}',
                msgType: 1,
            },
        } as unknown as AnyNoticeEvent;

        expect(projectDouyinNotice(event, context)).toMatchObject({
            notice_type: "message_updated",
            message_id: createId("message-1"),
            user: { id: createId("sender-1") },
            message: [{ type: "text", data: { text: "更新后" } }],
            sub_type: "group",
            scene_id: createId("group-conversation"),
            group: { id: createId("group-conversation") },
        });
    });
});

function reaction(
    fields: Pick<
        Extract<AnyNoticeEvent, { type: "message.reaction" }>,
        "operatorUid" | "emoji" | "enabled"
    >,
): Extract<AnyNoticeEvent, { type: "message.reaction" }> {
    return {
        type: "message.reaction",
        time: 1_700_000_000,
        conversationId: "conversation-1",
        conversationType: 2,
        serverMessageId: "message-1",
        clientMessageId: "client-message",
        ...fields,
    } as Extract<AnyNoticeEvent, { type: "message.reaction" }>;
}
