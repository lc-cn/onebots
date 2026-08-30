import { describe, expect, it } from "vitest";
import {
    projectICQQDiscussMessage,
    projectICQQFriendChange,
    projectICQQGuildMessage,
    projectICQQMessage,
    projectICQQMembership,
    projectICQQMute,
    projectICQQPoke,
    projectICQQRecall,
    projectICQQReaction,
    projectICQQReadSync,
    projectICQQRequest,
} from "./events.js";

function id(value: string | number) {
    return { string: String(value), source: value, number: Number(value) || 0 };
}

const context = { botId: id(10000), createId: id };

describe("ICQQ 事件投影", () => {
    it("消息保留原始事件、群发送者扩展与未知消息元素", () => {
        const raw = { message_type: "group", extra: true };
        const event = projectICQQMessage(
            {
                raw_event: raw,
                message_id: "msg-1",
                group_id: 20000,
                user_id: 30000,
                message: [
                    { type: "text", text: "hello" },
                    { type: "icqq_raw", data: { type: "markdown", content: "# title" } },
                ],
                raw_message: "hello",
                time: 1_700_000_000,
                sub_type: "normal",
                anonymous: null,
                block: false,
                atall: false,
                sender: {
                    user_id: 30000,
                    user_uid: "u_alice",
                    nickname: "Alice",
                    sub_id: "sub",
                    card: "管理员",
                    sex: "female",
                    age: 20,
                    area: "广东",
                    level: 12,
                    role: "admin",
                    title: "活跃成员",
                },
                group: { group_id: 20000, group_name: "Group" },
                atme: true,
            },
            context,
        );
        expect(event.raw_event).toBe(raw);
        expect(event.message.map(segment => segment.type)).toEqual(["text", "icqq_raw"]);
        expect(event.extensions?.icqq).toMatchObject({ at_me: true });
    });

    it("投影禁言、撤回与戳一戳，不再丢弃底层已监听事件", () => {
        const mute = projectICQQMute(
            {
                raw_event: {},
                group_id: 1,
                user_id: 2,
                operator_id: 3,
                duration: 60,
                time: 100,
            },
            context,
        );
        const recall = projectICQQRecall(
            { raw_event: {}, message_id: "m", user_id: 2, seq: 10, rand: 11, time: 101 },
            context,
        );
        const poke = projectICQQPoke(
            {
                raw_event: {},
                group_id: 1,
                operator_id: 2,
                target_id: 3,
                action: "戳了戳",
                suffix: "",
                time: 102,
            },
            context,
        );
        expect(mute).toMatchObject({ notice_type: "group_ban", sub_type: "ban", duration: 60 });
        expect(recall).toMatchObject({ notice_type: "message_deleted", sub_type: "private" });
        expect(poke).toMatchObject({ notice_type: "interaction", sub_type: "poke" });
    });

    it("申请事件保留 ICQQ 身份、来源和群邀请上下文", () => {
        const friend = projectICQQRequest(
            {
                raw_event: {},
                request_id: "friend-flag",
                user_id: 2,
                nickname: "Alice",
                comment: "申请好友",
                source: "search",
                sub_type: "single",
                age: 20,
                sex: "female",
                time: 100,
            },
            context,
        );
        const group = projectICQQRequest(
            {
                raw_event: {},
                request_id: "group-flag",
                group_id: 1,
                group_name: "OneBots",
                user_id: 2,
                nickname: "Alice",
                sub_type: "add",
                comment: "申请入群",
                inviter_id: 3,
                tips: "来自群邀请",
                time: 100,
            },
            context,
        );

        expect(friend.extensions).toEqual({
            icqq: { sub_type: "single", source: "search", age: 20, sex: "female" },
        });
        expect(group.extensions).toEqual({
            icqq: {
                group_name: "OneBots",
                inviter_id: 3,
                tips: "来自群邀请",
                role: undefined,
            },
        });
    });

    it("群成员减少保留踢出语义、解散标记并生成互不冲突的事件 ID", () => {
        const first = projectICQQMembership(
            {
                raw_event: {},
                group_id: 1,
                user_id: 2,
                operator_id: 3,
                sub_type: "kick",
                is_dismiss: true,
                time: 100,
            },
            context,
        );
        const second = projectICQQMembership(
            {
                raw_event: {},
                group_id: 1,
                user_id: 4,
                operator_id: 3,
                sub_type: "kick",
                is_dismiss: false,
                time: 100,
            },
            context,
        );
        expect(first.extensions).toEqual({ icqq: { is_dismiss: true } });
        expect(first.id.string).not.toBe(second.id.string);
    });

    it("将群消息表情回应投影为可区分增删的通用事件", () => {
        const event = projectICQQReaction(
            {
                raw_event: { type: 1 },
                group_id: 1,
                user_id: 2,
                message_seq: 42,
                face_id: "66",
                reaction_type: "face",
                is_add: false,
                time: 100,
            },
            context,
        );

        expect(event).toMatchObject({
            notice_type: "reaction_removed",
            sub_type: "face",
            face_id: "66",
            reaction_type: "face",
            is_add: false,
            message_id: { number: 42 },
        });
    });

    it("投影讨论组与 QQ 频道消息，并为讨论组隔离 ID 命名空间", () => {
        const discuss = projectICQQDiscussMessage(
            {
                raw_event: {},
                message_id: "d1",
                discuss_id: 20000,
                discuss_name: "讨论组",
                user_id: 30000,
                message: [{ type: "text", text: "hello" }],
                raw_message: "hello",
                time: 100,
                sender: { user_id: 30000, nickname: "Alice" },
                atme: true,
            },
            context,
        );
        const guild = projectICQQGuildMessage(
            {
                raw_event: {},
                guild_id: "guild",
                guild_name: "频道",
                channel_id: "channel",
                channel_name: "子频道",
                message_id: "g1",
                user_id: "tiny",
                message: [{ type: "text", text: "hello" }],
                raw_message: "hello",
                time: 100,
                is_delete: false,
                sender: { user_id: "tiny", nickname: "Alice" },
            },
            context,
        );

        expect(discuss).toMatchObject({
            message_type: "group",
            group: { id: { string: "discuss:20000" } },
            extensions: { icqq: { scene_type: "discuss", at_me: true } },
        });
        expect(guild).toMatchObject({
            message_type: "channel",
            group: {
                id: { string: "channel" },
                guild_id: { string: "guild" },
                channel_id: { string: "channel" },
            },
        });
    });

    it("频道删除、好友变更与已读同步进入 canonical notice", () => {
        const deleted = projectICQQGuildMessage(
            {
                raw_event: {},
                guild_id: "guild",
                guild_name: "频道",
                channel_id: "channel",
                channel_name: "子频道",
                message_id: "g1",
                user_id: "tiny",
                message: [],
                raw_message: "",
                time: 100,
                is_delete: true,
                sender: { user_id: "tiny", nickname: "Alice" },
            },
            context,
        );
        const friend = projectICQQFriendChange(
            {
                raw_event: {},
                change_type: "increase",
                user_id: 2,
                nickname: "Alice",
                time: 100,
            },
            context,
        );
        const read = projectICQQReadSync(
            {
                raw_event: {},
                scene_type: "group",
                scene_id: 1,
                cursor: 42,
                time: 100,
            },
            context,
        );

        expect(deleted).toMatchObject({ notice_type: "message_deleted", sub_type: "channel" });
        expect(friend).toMatchObject({ notice_type: "friend_add", sub_type: "increase" });
        expect(read).toMatchObject({
            notice_type: "message_status",
            sub_type: "read",
            group: { id: { number: 1 } },
            cursor: 42,
        });
    });
});
