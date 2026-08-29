import { describe, expect, it } from "vitest";
import type { CommonEvent } from "onebots";
import { projectMilkyNotice } from "./notice-projector.js";

const id = (value: number) => ({ string: String(value), source: value, number: value });

function notice(fields: Partial<CommonEvent.Notice>): CommonEvent.Notice {
    return {
        id: id(1),
        timestamp: 1_700_000_000_000,
        type: "notice",
        platform: "icqq",
        bot_id: id(10000),
        notice_type: "custom",
        ...fields,
    };
}

describe("Milky notice projector", () => {
    it("将 ICQQ 解散标记投影为 group_disband", () => {
        expect(
            projectMilkyNotice(
                notice({
                    notice_type: "group_decrease",
                    group: { id: id(20000) },
                    user: { id: id(10000) },
                    operator: { id: id(30000) },
                    extensions: { icqq: { is_dismiss: true } },
                }),
            ),
        ).toMatchObject({
            event_type: "group_disband",
            data: { group_id: 20000, operator_id: 30000 },
        });
    });

    it("分别投影成员禁言和全体禁言", () => {
        expect(
            projectMilkyNotice(
                notice({
                    notice_type: "group_ban",
                    group: { id: id(20000) },
                    user: { id: id(10001) },
                    operator: { id: id(10002) },
                    duration: 60,
                }),
            ),
        ).toMatchObject({ event_type: "group_mute", data: { user_id: 10001, duration: 60 } });
        expect(
            projectMilkyNotice(
                notice({
                    notice_type: "group_ban",
                    group: { id: id(20000) },
                    operator: { id: id(10002) },
                    duration: 0,
                }),
            ),
        ).toMatchObject({ event_type: "group_whole_mute", data: { is_mute: false } });
    });

    it("投影撤回、回应和群戳一戳的完整字段", () => {
        expect(
            projectMilkyNotice(
                notice({
                    notice_type: "message_deleted",
                    group: { id: id(20000) },
                    user: { id: id(10001) },
                    operator: { id: id(10002) },
                    message_id: id(42),
                }),
            ),
        ).toMatchObject({
            event_type: "message_recall",
            data: { message_scene: "group", peer_id: 20000, message_seq: 42 },
        });
        expect(
            projectMilkyNotice(
                notice({
                    notice_type: "reaction_added",
                    group: { id: id(20000) },
                    user: { id: id(10001) },
                    message_id: id(42),
                    face_id: "66",
                    reaction_type: "emoji",
                }),
            ),
        ).toMatchObject({
            event_type: "group_message_reaction",
            data: { message_seq: 42, face_id: "66", reaction_type: "emoji", is_add: true },
        });
        expect(
            projectMilkyNotice(
                notice({
                    notice_type: "interaction",
                    sub_type: "poke",
                    group: { id: id(20000) },
                    operator: { id: id(10001) },
                    user: { id: id(10002) },
                    action: "戳了戳",
                    suffix: "的头像",
                }),
            ),
        ).toMatchObject({
            event_type: "group_nudge",
            data: { sender_id: 10001, receiver_id: 10002, display_action: "戳了戳" },
        });
    });

    it("不为不可表达的 custom notice 伪造 Milky 事件", () => {
        expect(projectMilkyNotice(notice({ notice_type: "custom" }))).toBeNull();
    });
});
