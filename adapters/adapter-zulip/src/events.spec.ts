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
            sub_type: "start",
        });
        expect(projectZulipEvents({ id: 11, type: "invites_changed" }, context)[0]).toMatchObject({
            notice_type: "custom",
            sub_type: "invites_changed",
        });
    });

    it("投影批量消息标记变化并保留未读详情", () => {
        expect(
            projectZulipEvents(
                {
                    id: 31,
                    type: "update_message_flags",
                    op: "remove",
                    flag: "read",
                    messages: [42, 43],
                    message_details: {
                        "42": { type: "stream", stream_id: 7, topic: "release" },
                    },
                },
                context,
            )[0],
        ).toMatchObject({
            notice_type: "message_flags_updated",
            sub_type: "remove:read",
            message_ids: [{ string: "42" }, { string: "43" }],
            flag: "read",
            operation: "remove",
            all: false,
            message_details: {
                "42": { type: "stream", stream_id: 7, topic: "release" },
            },
        });
        expect(
            projectZulipEvents(
                {
                    id: 32,
                    type: "update_message_flags",
                    op: "add",
                    flag: "read",
                    messages: [],
                    all: true,
                },
                context,
            )[0],
        ).toMatchObject({ notice_type: "message_flags_updated", all: true, message_ids: [] });
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

    it("投影自定义表情创建和停用事件", () => {
        expect(
            projectZulipEvents(
                {
                    id: 19,
                    type: "realm_emoji",
                    op: "add",
                    emoji: {
                        id: "2",
                        name: "release_ready",
                        source_url: "/user_avatars/1/emoji/images/2.png",
                        still_url: null,
                        deactivated: false,
                        author_id: 12,
                    },
                },
                context,
            )[0],
        ).toMatchObject({
            notice_type: "emoji_created",
            sub_type: "added",
            resource: { type: "emoji", id: { string: "2" }, name: "release_ready" },
        });

        expect(
            projectZulipEvents(
                {
                    id: 20,
                    type: "realm_emoji",
                    op: "update_one",
                    emoji_id: "2",
                    data: { deactivated: true },
                },
                context,
            )[0],
        ).toMatchObject({
            notice_type: "emoji_updated",
            sub_type: "deactivated",
            resource: { type: "emoji", id: { string: "2" }, deactivated: true },
        });
    });

    it("投影 Channel Folder 创建、归档与排序事件", () => {
        expect(
            projectZulipEvents(
                {
                    id: 21,
                    type: "channel_folder",
                    op: "add",
                    channel_folder: {
                        id: 2,
                        name: "Backend",
                        order: 1,
                        date_created: 1_717_484_476,
                        creator_id: 9,
                        description: "Backend channels",
                        rendered_description: "<p>Backend channels</p>",
                        is_archived: false,
                    },
                },
                context,
            )[0],
        ).toMatchObject({
            timestamp: 1_717_484_476_000,
            notice_type: "channel_folder_created",
            resource: { type: "channel_folder", id: { string: "2" }, name: "Backend" },
        });
        expect(
            projectZulipEvents(
                {
                    id: 22,
                    type: "channel_folder",
                    op: "update",
                    channel_folder_id: 2,
                    data: { is_archived: true },
                },
                context,
            )[0],
        ).toMatchObject({
            notice_type: "channel_folder_updated",
            sub_type: "archived",
            resource: { type: "channel_folder", id: { string: "2" }, is_archived: true },
        });
        expect(
            projectZulipEvents(
                { id: 23, type: "channel_folder", op: "reorder", order: [3, 1, 2] },
                context,
            )[0],
        ).toMatchObject({
            notice_type: "channel_folders_reordered",
            resource: { type: "channel_folder", order: [3, 1, 2] },
        });
        expect(
            projectZulipEvents(
                { id: 24, type: "channel_folder", op: "reorder", order: [] },
                context,
            )[0],
        ).toMatchObject({ notice_type: "channel_folders_reordered" });
    });

    it("投影 Navigation View 创建、更新与删除事件", () => {
        expect(
            projectZulipEvents(
                {
                    id: 25,
                    type: "navigation_view",
                    op: "add",
                    navigation_view: {
                        fragment: "narrow/is/alerted",
                        is_pinned: true,
                        name: "Alert Words",
                    },
                },
                context,
            )[0],
        ).toMatchObject({
            notice_type: "navigation_view_created",
            resource: {
                type: "navigation_view",
                id: { string: "narrow/is/alerted" },
                name: "Alert Words",
                is_pinned: true,
            },
        });
        const updated = projectZulipEvents(
            {
                id: 26,
                type: "navigation_view",
                op: "update",
                fragment: "narrow/is/alerted",
                data: { name: null, is_pinned: false },
            },
            context,
        )[0];
        expect(updated).toMatchObject({
            notice_type: "navigation_view_updated",
            resource: { type: "navigation_view", is_pinned: false },
        });
        expect(updated?.type === "notice" ? updated.resource?.name : undefined).toBeUndefined();
        expect(
            projectZulipEvents(
                {
                    id: 27,
                    type: "navigation_view",
                    op: "remove",
                    fragment: "narrow/is/alerted",
                },
                context,
            )[0],
        ).toMatchObject({
            notice_type: "navigation_view_removed",
            resource: { id: { string: "narrow/is/alerted" } },
        });
    });

    it("投影附件增改删和官方上传路径", () => {
        expect(
            projectZulipEvents(
                {
                    id: 28,
                    type: "attachment",
                    op: "add",
                    attachment: {
                        id: 7,
                        name: "release notes.txt",
                        path_id: "2/ce/release notes.txt",
                        size: 32,
                        create_time: 100,
                        message_ids: [42],
                    },
                    upload_space_used: 64,
                },
                context,
            )[0],
        ).toMatchObject({
            timestamp: 100_000,
            notice_type: "attachment_created",
            resource: {
                type: "attachment",
                id: { string: "7" },
                name: "release notes.txt",
                url: "https://example.zulipchat.com/user_uploads/2/ce/release%20notes.txt",
                upload_space_used: 64,
            },
        });
        expect(
            projectZulipEvents(
                {
                    id: 29,
                    type: "attachment",
                    op: "update",
                    attachment: { id: 7, name: "a.txt", size: 1, path_id: "2/a.txt" },
                    upload_space_used: 1,
                },
                context,
            )[0],
        ).toMatchObject({ notice_type: "attachment_updated" });
        expect(
            projectZulipEvents(
                {
                    id: 30,
                    type: "attachment",
                    op: "remove",
                    attachment: { id: 7 },
                    upload_space_used: 0,
                },
                context,
            )[0],
        ).toMatchObject({
            notice_type: "attachment_removed",
            resource: { id: { string: "7" }, upload_space_used: 0 },
        });
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
