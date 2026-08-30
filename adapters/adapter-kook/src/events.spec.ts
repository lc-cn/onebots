import { describe, expect, test } from "vitest";
import { projectKookEvents } from "./events.js";
import type { KookEvent, KookSignal } from "./types.js";

const id = (value: string | number) => ({
    string: String(value),
    source: value,
    number: Number(value),
});
const context = { botId: id("bot"), selfId: id("native-bot"), createId: id };

describe("KOOK 事件投影", () => {
    test("频道消息使用频道作为统一 scene 并保留服务器 ID", () => {
        const event = messageEvent();
        const signal: KookSignal = { s: 0, sn: 2, d: event };
        const projected = projectKookEvents(event, signal, context)[0];
        expect(projected).toMatchObject({
            type: "message",
            message_type: "channel",
            group: {
                id: { string: "channel-1" },
                guild_id: { string: "guild-1" },
                channel_id: { string: "channel-1" },
            },
            extensions: { kook: { guild_id: "guild-1" } },
            raw_event: { signal: { sn: 2 } },
        });
    });

    test("私聊回应删除投影为 reaction_removed", () => {
        const event: KookEvent = {
            ...messageEvent(),
            type: 255,
            channel_type: "PERSON",
            extra: {
                type: "private_deleted_reaction",
                body: { user_id: "user-2", msg_id: "message-2", emoji: { name: "👍" } },
            },
        };
        const projected = projectKookEvents(event, { s: 0, d: event }, context)[0];
        expect(projected).toMatchObject({
            type: "notice",
            notice_type: "reaction_removed",
            user: { id: { string: "user-2" } },
            message_id: { string: "message-2" },
        });
    });

    test("未知系统事件不会丢失", () => {
        const event: KookEvent = {
            ...messageEvent(),
            type: 255,
            extra: { type: "future_event", body: { future: true } },
        };
        expect(projectKookEvents(event, { s: 0, d: event }, context)[0]).toMatchObject({
            type: "notice",
            notice_type: "custom",
            extensions: { kook: { event_type: "future_event", body: { future: true } } },
        });
    });

    test("道具消息保留对象 content", () => {
        const event: KookEvent = {
            ...messageEvent(),
            type: 12,
            content: { type: "item", data: { item_id: 10001, target_id: "user-2" } },
        };
        expect(projectKookEvents(event, { s: 0, sn: 3, d: event }, context)[0]).toMatchObject({
            type: "message",
            message: [
                {
                    type: "kook",
                    data: {
                        type: 12,
                        content: { type: "item", data: { item_id: 10001 } },
                    },
                },
            ],
        });
    });

    test("私聊系统事件不会把目标用户伪装成频道", () => {
        const event: KookEvent = {
            ...messageEvent(),
            type: 255,
            channel_type: "PERSON",
            target_id: "bot-user",
            extra: {
                type: "updated_private_message",
                body: {
                    author_id: "user-2",
                    target_id: "bot-user",
                    msg_id: "message-2",
                    content: "updated",
                    chat_code: "chat-1",
                },
            },
        };
        expect(projectKookEvents(event, { s: 0, d: event }, context)[0]).toMatchObject({
            notice_type: "message_updated",
            user: { id: { string: "user-2" } },
            message_id: { string: "message-2" },
            group: undefined,
        });
    });

    test("更新事件保留 Card，并把置顶事件投影为消息状态", () => {
        const card = JSON.stringify([{ type: "card", modules: [] }]);
        const updated = systemEvent("updated_message", {
            msg_id: "message-2",
            channel_id: "channel-1",
            content: card,
        });
        expect(projectKookEvents(updated, { s: 0, d: updated }, context)[0]).toMatchObject({
            notice_type: "message_updated",
            message: [{ type: "card", data: { content: card } }],
        });

        const pinned = systemEvent("pinned_message", {
            msg_id: "message-2",
            channel_id: "channel-1",
            operator_id: "admin-1",
        });
        expect(projectKookEvents(pinned, { s: 0, d: pinned }, context)[0]).toMatchObject({
            notice_type: "message_status",
            sub_type: "pinned_message",
            message_id: { string: "message-2" },
            operator: { id: { string: "admin-1" } },
        });
    });

    test("投影机器人服务器生命周期和语音频道成员", () => {
        const joined = systemEvent("self_joined_guild", { guild_id: "guild-2" }, "PERSON");
        expect(projectKookEvents(joined, { s: 0, d: joined }, context)[0]).toMatchObject({
            notice_type: "group_increase",
            user: { id: { string: "native-bot" } },
            group: { id: { string: "guild-2" }, guild_id: { string: "guild-2" } },
            message_id: undefined,
        });

        const voice = systemEvent("joined_channel", {
            user_id: "user-2",
            channel_id: "voice-1",
        });
        expect(projectKookEvents(voice, { s: 0, d: voice }, context)[0]).toMatchObject({
            notice_type: "member_joined",
            user: { id: { string: "user-2" } },
            group: {
                id: { string: "voice-1" },
                guild_id: { string: "guild-1" },
                channel_id: { string: "voice-1" },
            },
        });
    });

    test("将批量服务器封禁逐用户投影并保留操作人", () => {
        const event = systemEvent("added_block_list", {
            operator_id: "admin-1",
            user_id: ["user-2", "user-3"],
            remark: "spam",
        });
        const projected = projectKookEvents(event, { s: 0, d: event }, context);
        expect(projected).toHaveLength(2);
        expect(projected[0]).toMatchObject({
            id: { string: "system-message:user-2" },
            notice_type: "group_ban",
            sub_type: "ban",
            user: { id: { string: "user-2" } },
            operator: { id: { string: "admin-1" } },
            group: { id: { string: "guild-1" } },
        });
        expect(projected[1]).toMatchObject({ user: { id: { string: "user-3" } } });
    });
});

function systemEvent(
    type: string,
    body: Record<string, unknown>,
    channelType: KookEvent["channel_type"] = "GROUP",
): KookEvent {
    return {
        ...messageEvent(),
        type: 255,
        channel_type: channelType,
        target_id: channelType === "GROUP" ? "guild-1" : "bot-user",
        msg_id: "system-message",
        extra: { type, body },
    };
}

function messageEvent(): KookEvent {
    return {
        channel_type: "GROUP",
        type: 9,
        target_id: "channel-1",
        author_id: "user-1",
        content: "hello",
        msg_id: "message-1",
        msg_timestamp: 1_700_000_000_000,
        extra: {
            guild_id: "guild-1",
            channel_name: "general",
            author: { id: "user-1", username: "Alice" },
        },
    };
}
