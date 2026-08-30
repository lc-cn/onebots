import { describe, expect, it } from "vitest";
import type { Update } from "grammy/types";
import { projectTelegramEvents } from "./events.js";

const context = {
    botId: { string: "bot", number: 1, source: "bot" },
    createId: (value: string | number) => ({
        string: String(value),
        number: Number(value),
        source: String(value),
    }),
};

describe("projectTelegramEvents", () => {
    it("投影消息的回复与媒体段并保留原始 Update", () => {
        const update = {
            update_id: 10,
            message: {
                message_id: 20,
                date: 100,
                chat: { id: -30, type: "supergroup", title: "group" },
                from: { id: 40, is_bot: false, first_name: "Alice" },
                caption: "photo",
                photo: [{ file_id: "small", file_unique_id: "s", width: 1, height: 1 }],
                reply_to_message: {
                    message_id: 19,
                    date: 99,
                    chat: { id: -30, type: "supergroup", title: "group" },
                },
            },
        } as Update;

        const [event] = projectTelegramEvents(update, context);

        expect(event?.type).toBe("message");
        expect(event?.raw_event).toBe(update);
        if (event?.type !== "message") throw new Error("expected message");
        expect(event.message_type).toBe("group");
        expect(event.message.map(segment => segment.type)).toEqual(["reply", "text", "image"]);
    });

    it("将入群申请投影为可直接处理的 request flag", () => {
        const update = {
            update_id: 11,
            chat_join_request: {
                chat: { id: -30, type: "supergroup", title: "group" },
                from: { id: 40, is_bot: false, first_name: "Alice" },
                user_chat_id: 40,
                date: 100,
                bio: "hello",
            },
        } as Update;

        const [event] = projectTelegramEvents(update, context);

        expect(event).toMatchObject({
            type: "request",
            request_type: "group",
            flag: "-30:40",
            comment: "hello",
        });
    });

    it("未知原生更新以 custom notice 无损投影", () => {
        const update = {
            update_id: 12,
            poll: { id: "poll", question: "Q", options: [], total_voter_count: 0 },
        } as unknown as Update;

        const [event] = projectTelegramEvents(update, context);

        expect(event).toMatchObject({
            type: "notice",
            notice_type: "custom",
            extensions: { telegram: { kind: "poll" } },
        });
        expect(event?.raw_event).toBe(update);
    });

    it("将 Reaction 差异拆成可独立消费的标准事件", () => {
        const update = {
            update_id: 13,
            message_reaction: {
                chat: { id: -30, type: "supergroup", title: "group" },
                message_id: 20,
                date: 100,
                user: { id: 40, is_bot: false, first_name: "Alice" },
                old_reaction: [{ type: "emoji", emoji: "👎" }],
                new_reaction: [{ type: "emoji", emoji: "👍" }],
            },
        } as Update;

        const events = projectTelegramEvents(update, context);

        expect(events.map(event => event.type === "notice" && event.notice_type)).toEqual([
            "reaction_added",
            "reaction_removed",
        ]);
        expect(new Set(events.map(event => event.id.string)).size).toBe(2);
    });

    it("按 UTF-16 entity offset 投影原生 text_mention", () => {
        const update = {
            update_id: 14,
            message: {
                message_id: 21,
                date: 100,
                chat: { id: -30, type: "supergroup", title: "group" },
                from: { id: 40, is_bot: false, first_name: "Alice" },
                text: "hi Bob!",
                entities: [
                    {
                        type: "text_mention",
                        offset: 3,
                        length: 3,
                        user: { id: 41, is_bot: false, first_name: "Bob" },
                    },
                ],
            },
        } as Update;

        const [event] = projectTelegramEvents(update, context);
        if (event?.type !== "message") throw new Error("expected message");
        expect(event.message).toEqual([
            { type: "text", data: { text: "hi " } },
            {
                type: "at",
                data: { user_id: context.createId(41), name: "Bob" },
            },
            { type: "text", data: { text: "!" } },
        ]);
    });

    it("将机器人加入与退出群投影为群生命周期", () => {
        for (const current of ["member", "left"] as const) {
            const update = {
                update_id: current === "member" ? 15 : 16,
                my_chat_member: {
                    chat: { id: -30, type: "supergroup", title: "group" },
                    from: { id: 40, is_bot: false, first_name: "Alice" },
                    date: 101,
                    old_chat_member: {
                        status: current === "member" ? "left" : "member",
                        user: { id: 1, is_bot: true, first_name: "Bot" },
                    },
                    new_chat_member: {
                        status: current,
                        user: { id: 1, is_bot: true, first_name: "Bot" },
                    },
                },
            } as Update;

            expect(projectTelegramEvents(update, context)[0]).toMatchObject({
                notice_type: current === "member" ? "group_increase" : "group_decrease",
                timestamp: 101000,
                user: { id: { string: "1" } },
                group: { id: { string: "-30" } },
            });
        }
    });

    it("按 restricted.is_member 判断真实成员变化", () => {
        const update = {
            update_id: 19,
            chat_member: {
                chat: { id: -30, type: "supergroup", title: "group" },
                from: { id: 40, is_bot: false, first_name: "Admin" },
                date: 104,
                old_chat_member: {
                    status: "restricted",
                    is_member: false,
                    user: { id: 41, is_bot: false, first_name: "Alice" },
                },
                new_chat_member: {
                    status: "restricted",
                    is_member: true,
                    user: { id: 41, is_bot: false, first_name: "Alice" },
                },
            },
        } as Update;

        expect(projectTelegramEvents(update, context)[0]).toMatchObject({
            notice_type: "member_joined",
            sub_type: "restricted",
            user: { id: { string: "41" } },
        });
    });

    it("将服务消息里的批量成员变化逐人投影", () => {
        const update = {
            update_id: 17,
            message: {
                message_id: 22,
                date: 102,
                chat: { id: -30, type: "supergroup", title: "group" },
                from: { id: 40, is_bot: false, first_name: "Alice" },
                new_chat_members: [
                    { id: 41, is_bot: false, first_name: "Bob" },
                    { id: 42, is_bot: false, first_name: "Carol" },
                ],
            },
        } as Update;

        const events = projectTelegramEvents(update, context);

        expect(events).toHaveLength(2);
        expect(events.map(event => event.notice_type)).toEqual(["member_joined", "member_joined"]);
        expect(new Set(events.map(event => event.id.string)).size).toBe(2);
    });

    it("不把无法标准化的服务消息伪装为空消息", () => {
        const update = {
            update_id: 18,
            message: {
                message_id: 23,
                date: 103,
                chat: { id: -30, type: "supergroup", title: "group" },
                forum_topic_closed: {},
            },
        } as Update;

        expect(projectTelegramEvents(update, context)[0]).toMatchObject({
            type: "notice",
            notice_type: "custom",
            message_id: { string: "23" },
            extensions: { telegram: { kind: "forum_topic_closed" } },
        });
    });
});
