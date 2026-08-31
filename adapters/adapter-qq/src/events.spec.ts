import { describe, expect, it } from "vitest";
import { projectQQMessage, projectQQRawEvent } from "./events.js";

const createId = (value: string | number) => ({ string: String(value), source: value, number: 1 });
const context = { botId: createId("bot"), createId };

describe("QQ 事件投影", () => {
    it("完整投影群消息、提及、附件与原始事件", () => {
        const raw = {
            rawEventType: "GROUP_AT_MESSAGE_CREATE",
            kind: "group" as const,
            senderId: "u1",
            content: "你好",
            messageId: "m1",
            timestamp: "2026-08-29T00:00:00.000Z",
            groupOpenid: "g1",
            mentions: [{ member_openid: "u2" }],
            attachments: [{ content_type: "image/png", url: "https://example.com/a.png" }],
            raw: {} as never,
            replyTarget: { scope: "group" as const, targetId: "g1" },
        };
        const event = projectQQMessage(raw, context);
        expect(event.message_type).toBe("group");
        expect(event.group?.id.string).toBe("g1");
        expect(event.message.map(segment => segment.type)).toEqual(["at", "text", "image"]);
        expect(event.raw_event).toBe(raw.raw);
    });

    it("未知平台事件仍以 custom notice 无损下发", () => {
        const raw = { id: "e1", guild_id: "g1", future_field: 42 };
        const event = projectQQRawEvent("FUTURE_EVENT", raw, context);
        expect(event).toMatchObject({ type: "notice", notice_type: "custom", raw_event: raw });
    });

    it("频道消息分别保留 Guild 与 Channel 地址", () => {
        const platformEvent = { id: "m1", guild_id: "guild-1", channel_id: "channel-1" };
        const message = {
            rawEventType: "AT_MESSAGE_CREATE",
            kind: "guild" as const,
            senderId: "u1",
            senderName: "Alice",
            content: "你好",
            messageId: "m1",
            timestamp: "2026-08-29T00:00:00.000Z",
            guildId: "guild-1",
            channelId: "channel-1",
            raw: platformEvent as never,
        };

        expect(projectQQMessage(message, context)).toMatchObject({
            message_type: "channel",
            group: {
                id: { string: "channel-1" },
                guild_id: { string: "guild-1" },
                channel_id: { string: "channel-1" },
            },
            raw_event: platformEvent,
        });
    });

    it("频道私信从 SDK typed message 投影为 direct", () => {
        expect(
            projectQQMessage(
                {
                    rawEventType: "DIRECT_MESSAGE_CREATE",
                    kind: "dm" as const,
                    senderId: "u1",
                    content: "你好",
                    messageId: "m1",
                    timestamp: "2026-08-29T00:00:00.000Z",
                    guildId: "dm-guild-1",
                    raw: { id: "m1", guild_id: "dm-guild-1" } as never,
                },
                context,
            ),
        ).toMatchObject({
            message_type: "direct",
            sender: { id: { string: "u1" } },
            extensions: { qq: { guild_id: "dm-guild-1" } },
        });
    });

    it("加群邀请完整投影申请人、验证信息与平台扩展", () => {
        const event = projectQQRawEvent(
            "GROUP_JOIN_REQUEST",
            {
                group_openid: "g1",
                member_openid: "u1",
                username: "Alice",
                join_request_id: "r1",
                apply_at: "2026-08-29T00:00:00.000Z",
                apply_source: "invited",
                invited_by: { member_openid: "admin-1" },
                verify_info: { method: "message", verify_message: "请拉我进群" },
                auto_approved: false,
            },
            context,
        );
        expect(event).toMatchObject({
            id: { string: "r1" },
            type: "request",
            request_type: "group",
            sub_type: "invite",
            user: { id: { string: "u1" }, name: "Alice" },
            group: { id: { string: "g1" } },
            comment: "请拉我进群",
            flag: "r1",
            extensions: {
                qq: {
                    apply_source: "invited",
                    invited_by: { member_openid: "admin-1" },
                    verify_info: { method: "message", verify_message: "请拉我进群" },
                    auto_approved: false,
                },
            },
        });
    });

    it("投影 Guild 成员生命周期并保留频道服务器地址", () => {
        const event = projectQQRawEvent(
            "GUILD_MEMBER_ADD",
            {
                id: "e1",
                guild_id: "guild-1",
                user: { id: "u1", username: "Alice", avatar: "https://example.com/a.png" },
                op_user_id: "admin-1",
            },
            context,
        );
        expect(event).toMatchObject({
            type: "notice",
            notice_type: "member_joined",
            user: { id: { string: "u1" }, name: "Alice" },
            operator: { id: { string: "admin-1" } },
            group: { id: { string: "guild-1" } },
        });
    });

    it.each([
        ["FRIEND_DEL", "friend_remove"],
        ["GROUP_ADD_ROBOT", "group_increase"],
        ["GROUP_DEL_ROBOT", "group_decrease"],
        ["GROUP_MSG_REJECT", "message_status"],
        ["C2C_MSG_RECEIVE", "message_status"],
        ["SUBSCRIBE_MESSAGE_STATUS", "message_status"],
    ])("将 %s 投影为 canonical %s 通知", (eventType, noticeType) => {
        const event = projectQQRawEvent(
            eventType,
            { id: "e1", group_openid: "g1", user_openid: "u1" },
            context,
        );
        expect(event).toMatchObject({ type: "notice", notice_type: noticeType });
    });

    it.each([
        ["GROUP_MEMBER_ADD", "member_joined"],
        ["GROUP_MEMBER_REMOVE", "member_left"],
    ])("投影群成员事件 %s", (eventType, noticeType) => {
        const event = projectQQRawEvent(
            eventType,
            { id: "e1", group_openid: "g1", member_openid: "u1" },
            context,
        );
        expect(event).toMatchObject({
            notice_type: noticeType,
            group: { id: { string: "g1" } },
            user: { id: { string: "u1" } },
        });
    });

    it("表态事件投影消息、用户、频道地址与原生 emoji", () => {
        const raw = {
            id: "e1",
            guild_id: "guild-1",
            channel_id: "channel-1",
            user_id: "u1",
            target: { id: "message-1", type: 0 },
            emoji: { id: "128077", type: 1 },
        };
        const event = projectQQRawEvent("MESSAGE_REACTION_ADD", raw, context);
        expect(event).toMatchObject({
            notice_type: "reaction_added",
            user: { id: { string: "u1" } },
            group: {
                id: { string: "channel-1" },
                guild_id: { string: "guild-1" },
                channel_id: { string: "channel-1" },
            },
            message_id: { string: "message-1" },
            extensions: { qq: { emoji: raw.emoji } },
        });
    });

    it("交互事件读取 resolved 中的用户与消息标识", () => {
        const event = projectQQRawEvent(
            "INTERACTION_CREATE",
            {
                id: "interaction-1",
                guild_id: "guild-1",
                channel_id: "channel-1",
                data: { resolved: { user_id: "u1", message_id: "message-1" } },
            },
            context,
        );
        expect(event).toMatchObject({
            notice_type: "interaction",
            user: { id: { string: "u1" } },
            message_id: { string: "message-1" },
            extensions: { qq: { interaction_id: "interaction-1" } },
        });
    });

    it("群交互事件读取 group_member_openid", () => {
        const event = projectQQRawEvent(
            "INTERACTION_CREATE",
            { id: "interaction-1", group_openid: "g1", group_member_openid: "u1" },
            context,
        );
        expect(event).toMatchObject({
            notice_type: "interaction",
            user: { id: { string: "u1" } },
            group: { id: { string: "g1" } },
        });
    });

    it.each(["MESSAGE_AUDIT_PASS", "MESSAGE_AUDIT_REJECT"])("将 %s 投影为消息状态", eventType => {
        expect(projectQQRawEvent(eventType, { id: "e1" }, context)).toMatchObject({
            notice_type: "message_status",
        });
    });

    it("从消息删除载荷中投影消息、作者、操作者与频道地址", () => {
        const event = projectQQRawEvent(
            "PUBLIC_MESSAGE_DELETE",
            {
                id: "e1",
                message: {
                    id: "m1",
                    guild_id: "guild-1",
                    channel_id: "channel-1",
                    author: { id: "u1", username: "Alice" },
                },
                op_user: { id: "admin-1", username: "Admin" },
            },
            context,
        );
        expect(event).toMatchObject({
            notice_type: "message_deleted",
            message_id: { string: "m1" },
            user: { id: { string: "u1" }, name: "Alice" },
            operator: { id: { string: "admin-1" }, name: "Admin" },
            group: {
                id: { string: "channel-1" },
                guild_id: { string: "guild-1" },
                channel_id: { string: "channel-1" },
            },
        });
    });
});
