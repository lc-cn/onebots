import { describe, expect, it } from "vitest";
import { projectZulipEvents } from "./events.js";

const createId = (value: string | number) => ({
    string: String(value),
    source: value,
    number: Number(value) || 1,
});
const context = {
    botId: createId(1),
    botUserId: 1,
    serverUrl: "https://example.zulipchat.com",
    createId,
};

describe("Zulip 事件投影", () => {
    it("保留频道话题、附件和原始事件", () => {
        const raw = {
            id: 7,
            type: "message" as const,
            message: {
                id: 42,
                type: "stream" as const,
                sender_id: 2,
                sender_email: "alice@example.com",
                sender_full_name: "Alice",
                content: "原始 Markdown",
                display_recipient: "engineering",
                stream_id: 5,
                subject: "release",
                timestamp: 100,
                attachments: [{ id: 3, name: "a.png", size: 12, path: "/user_uploads/a.png" }],
            },
        };

        const event = projectZulipEvents(raw, context)[0];

        expect(event).toMatchObject({
            type: "message",
            message_type: "group",
            raw_event: raw,
            group: { id: { string: "5/release" }, name: "engineering" },
            message: [
                { type: "text", data: { text: "原始 Markdown" } },
                {
                    type: "image",
                    data: {
                        name: "a.png",
                        url: "https://example.zulipchat.com/user_uploads/a.png",
                    },
                },
            ],
        });
    });

    it("投影反应、心跳和未知事件", () => {
        expect(
            projectZulipEvents(
                {
                    id: 8,
                    type: "reaction",
                    op: "remove",
                    message_id: 42,
                    emoji_name: "thumbs_up",
                    emoji_code: "1f44d",
                    reaction_type: "unicode_emoji",
                    user_id: 2,
                },
                context,
            )[0],
        ).toMatchObject({ type: "notice", notice_type: "reaction_removed" });
        expect(projectZulipEvents({ id: 9, type: "heartbeat" }, context)[0]).toMatchObject({
            type: "meta",
            meta_type: "heartbeat",
        });
        expect(
            projectZulipEvents({ id: 10, type: "typing", op: "start" }, context)[0],
        ).toMatchObject({
            timestamp: 0,
            type: "notice",
            notice_type: "custom",
        });
    });

    it("区分多人私聊并保留可回复的收件人场景", () => {
        const event = projectZulipEvents(
            {
                id: 11,
                type: "message",
                message: {
                    id: 43,
                    type: "private",
                    sender_id: 2,
                    sender_email: "alice@example.com",
                    sender_full_name: "Alice",
                    content: "hello team",
                    timestamp: 100,
                    display_recipient: [
                        { id: 1, email: "bot@example.com", full_name: "Bot" },
                        { id: 2, email: "alice@example.com", full_name: "Alice" },
                        { id: 3, email: "bob@example.com", full_name: "Bob" },
                    ],
                },
            },
            context,
        )[0];

        expect(event).toMatchObject({
            type: "message",
            message_type: "direct",
            extensions: { zulip: { scene_id: "2,3" } },
        });
    });

    it("区分组织成员停用与恢复，同时保持统一 user_updated 事件", () => {
        expect(
            projectZulipEvents(
                {
                    id: 17,
                    type: "realm_user",
                    op: "update",
                    person: { user_id: 12, is_active: false },
                },
                context,
            )[0],
        ).toMatchObject({
            notice_type: "user_updated",
            sub_type: "deactivated",
            user: { id: { string: "12" }, is_active: false },
        });
        expect(
            projectZulipEvents(
                {
                    id: 18,
                    type: "realm_user",
                    op: "update",
                    person: { user_id: 12, is_active: true },
                },
                context,
            )[0],
        ).toMatchObject({
            notice_type: "user_updated",
            sub_type: "reactivated",
            user: { is_active: true },
        });
    });

    it("投影用户组资源生命周期并使用平台创建时间", () => {
        expect(
            projectZulipEvents(
                {
                    id: 12,
                    type: "user_group",
                    op: "add",
                    group: {
                        id: 2,
                        name: "backend",
                        description: "Backend team",
                        date_created: 1_717_484_476,
                        members: [12],
                    },
                },
                context,
            )[0],
        ).toMatchObject({
            timestamp: 1_717_484_476_000,
            notice_type: "user_group_created",
            resource: {
                type: "user_group",
                id: { string: "2" },
                name: "backend",
                members: [12],
            },
        });

        expect(
            projectZulipEvents(
                {
                    id: 13,
                    type: "user_group",
                    op: "update",
                    group_id: 2,
                    data: { deactivated: true },
                },
                context,
            )[0],
        ).toMatchObject({ timestamp: 0, notice_type: "user_group_deactivated" });
    });

    it("逐成员和子组拆分批量变化并生成稳定 ID", () => {
        const members = projectZulipEvents(
            {
                id: 14,
                type: "user_group",
                op: "add_members",
                group_id: 2,
                user_ids: [10, 12],
            },
            context,
        );
        expect(members).toHaveLength(2);
        expect(members[0]).toMatchObject({
            id: { string: "event:14:10" },
            notice_type: "user_group_member_added",
            user: { id: { string: "10" } },
        });
        expect(members[1]).toMatchObject({ id: { string: "event:14:12" } });

        const subgroups = projectZulipEvents(
            {
                id: 15,
                type: "user_group",
                op: "remove_subgroups",
                group_id: 2,
                direct_subgroup_ids: [3],
            },
            context,
        );
        expect(subgroups[0]).toMatchObject({
            notice_type: "user_group_subgroup_removed",
            resource: { related_user_group_id: { string: "3" } },
        });

        expect(
            projectZulipEvents(
                { id: 16, type: "user_group", op: "add_members", group_id: 2, user_ids: [] },
                context,
            )[0],
        ).toMatchObject({ notice_type: "custom", sub_type: "add_members" });
    });
});
