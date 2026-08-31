import { describe, expect, test } from "vitest";
import type { CommonEvent, CommonTypes } from "onebots";
import { projectSatoriNotice } from "./notice-projector.js";

const id = (value: string | number): CommonTypes.Id => ({
    string: String(value),
    number: Number(value),
    source: value,
});
const context = { id: 1, platform: "kook", selfId: "bot" };
const base: CommonEvent.Notice = {
    id: id("event"),
    timestamp: 1_700_000_000_000,
    type: "notice",
    platform: "kook",
    bot_id: id("bot"),
    notice_type: "custom",
    group: { id: id("channel-1"), guild_id: id("guild-1"), channel_id: id("channel-1") },
};

describe("Satori notice 资源投影", () => {
    test("频道资源使用原生 channel 生命周期事件", () => {
        expect(
            projectSatoriNotice(
                {
                    ...base,
                    notice_type: "channel_created",
                    resource: {
                        type: "channel",
                        id: id("channel-1"),
                        name: "News",
                        channel_type: 2,
                        parent_id: "category-1",
                    },
                },
                context,
            ),
        ).toMatchObject({
            type: "channel-added",
            guild: { id: "guild-1" },
            channel: { id: "channel-1", type: 2, name: "News", parent_id: "category-1" },
        });
    });

    test.each([
        ["member_joined", "guild-member-added"],
        ["member_left", "guild-member-removed"],
        ["message_updated", "message-updated"],
        ["message_deleted", "message-deleted"],
        ["reaction_added", "reaction-added"],
        ["reaction_removed", "reaction-removed"],
    ] as const)("将 %s 映射为 %s", (noticeType, eventType) => {
        expect(
            projectSatoriNotice(
                {
                    ...base,
                    notice_type: noticeType,
                    user: { id: id("user-1"), name: "Alice" },
                    message_id: id("message-1"),
                    face_id: "wave",
                },
                context,
            ),
        ).toMatchObject({ type: eventType });
    });

    test("角色与服务器资源使用原生实体", () => {
        expect(
            projectSatoriNotice(
                {
                    ...base,
                    notice_type: "guild_role_updated",
                    resource: { type: "role", id: id(702), name: "管理员" },
                },
                context,
            ),
        ).toMatchObject({
            type: "guild-role-updated",
            guild: { id: "guild-1" },
            role: { id: "702", name: "管理员" },
        });

        expect(
            projectSatoriNotice(
                {
                    ...base,
                    notice_type: "guild_updated",
                    resource: { type: "guild", id: id("guild-1"), name: "OneBots" },
                },
                context,
            ),
        ).toMatchObject({
            type: "guild-updated",
            guild: { id: "guild-1", name: "OneBots" },
        });
    });

    test("标准事件缺少必需资源时回退 internal 而不伪造空实体", () => {
        expect(
            projectSatoriNotice(
                {
                    ...base,
                    group: undefined,
                    notice_type: "message_deleted",
                    user: { id: id("user-1") },
                    message_id: id("message-1"),
                },
                context,
            ),
        ).toMatchObject({ type: "internal", _type: "kook.message_deleted" });
    });
});
