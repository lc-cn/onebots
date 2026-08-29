import { describe, expect, it } from "vitest";
import {
    projectICQQMessage,
    projectICQQMembership,
    projectICQQMute,
    projectICQQPoke,
    projectICQQRecall,
    projectICQQReaction,
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
                sender: { user_id: 30000, nickname: "Alice", role: "admin" },
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
            { raw_event: {}, message_id: "m", user_id: 2, time: 101 },
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
});
