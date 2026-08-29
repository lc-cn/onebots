import { describe, expect, it } from "vitest";
import { projectDiscordEvents } from "./events.js";

const context = {
    botId: { string: "bot", number: 1, source: "bot" },
    createId: (value: string | number) => ({
        string: String(value),
        number: Number(value) || 1,
        source: value,
    }),
};

describe("projectDiscordEvents", () => {
    it("投影消息的回复、附件与 sticker", () => {
        const rawEvent = {
            name: "MESSAGE_CREATE",
            data: {
                id: "10",
                channel_id: "20",
                guild_id: "30",
                author: { id: "40", username: "alice", discriminator: "0", avatar: null },
                content: "hello",
                timestamp: "2026-01-01T00:00:00.000Z",
                edited_timestamp: null,
                tts: false,
                mention_everyone: false,
                mentions: [],
                mention_roles: [],
                attachments: [
                    {
                        id: "50",
                        filename: "a.png",
                        content_type: "image/png",
                        size: 1,
                        url: "https://cdn/a.png",
                        proxy_url: "https://proxy/a.png",
                    },
                ],
                embeds: [],
                pinned: false,
                type: 0,
                message_reference: { message_id: "9" },
                sticker_items: [{ id: "60", name: "wave", format_type: 1 }],
            },
        };

        const [event] = projectDiscordEvents(rawEvent, context);

        expect(event?.type).toBe("message");
        if (event?.type !== "message") throw new Error("expected message");
        expect(event.group).toMatchObject({
            guild_id: { string: "30" },
            channel_id: { string: "20" },
        });
        expect(event.message.map(segment => segment.type)).toEqual([
            "reply",
            "text",
            "image",
            "sticker",
        ]);
        expect(event.raw_event).toBe(rawEvent);
    });

    it("未知 Dispatch 仍无损投影", () => {
        const rawEvent = { name: "AUTO_MODERATION_ACTION_EXECUTION", data: { rule_id: "1" } };
        expect(projectDiscordEvents(rawEvent, context)[0]).toMatchObject({
            type: "notice",
            notice_type: "custom",
            raw_event: rawEvent,
            extensions: { discord: { event_name: "AUTO_MODERATION_ACTION_EXECUTION" } },
        });
    });

    it("安全投影只包含变更字段的 MESSAGE_UPDATE", () => {
        const [event] = projectDiscordEvents(
            {
                name: "MESSAGE_UPDATE",
                data: { id: "10", channel_id: "20", guild_id: "30", pinned: true },
            },
            context,
        );

        expect(event).toMatchObject({
            type: "notice",
            notice_type: "message_updated",
            message_id: { string: "10" },
            group: {
                id: { string: "20" },
                guild_id: { string: "30" },
                channel_id: { string: "20" },
            },
        });
        expect(event).not.toHaveProperty("message");
    });

    it("保留提及、频道引用与 Embed 的语义顺序", () => {
        const [event] = projectDiscordEvents(
            {
                name: "MESSAGE_CREATE",
                sequence: 7,
                session_id: "session-1",
                data: {
                    id: "10",
                    channel_id: "20",
                    guild_id: "30",
                    author: { id: "40", username: "alice", discriminator: "0", avatar: null },
                    content: "hi <@41> in <#21> <@&51> @everyone",
                    timestamp: "2026-01-01T00:00:00.000Z",
                    edited_timestamp: null,
                    tts: false,
                    mention_everyone: true,
                    mentions: [{ id: "41", username: "bob", discriminator: "0", avatar: null }],
                    mention_roles: ["51"],
                    mention_channels: [{ id: "21", guild_id: "30", type: 0, name: "news" }],
                    attachments: [],
                    embeds: [{ title: "状态" }],
                    pinned: false,
                    type: 0,
                },
            },
            context,
        );

        expect(event?.id.string).toBe("MESSAGE_CREATE:session-1:7");
        expect(event?.type).toBe("message");
        if (event?.type !== "message") throw new Error("expected message");
        expect(event.message).toMatchObject([
            { type: "text", data: { text: "hi " } },
            { type: "at", data: { user_id: { string: "41" }, name: "bob" } },
            { type: "text", data: { text: " in " } },
            { type: "channel", data: { channel_id: { string: "21" }, name: "news" } },
            { type: "text", data: { text: " " } },
            { type: "at", data: { role_id: { string: "51" } } },
            { type: "text", data: { text: " " } },
            { type: "at", data: { user_id: "all", scope: "everyone" } },
            { type: "embed", data: { embed: { title: "状态" } } },
        ]);
    });

    it("将批量删除拆成具有唯一稳定 ID 的独立事件", () => {
        const events = projectDiscordEvents(
            {
                name: "MESSAGE_DELETE_BULK",
                sequence: 9,
                session_id: "session-1",
                data: { ids: ["10", "11"], channel_id: "20", guild_id: "30" },
            },
            context,
        );

        expect(events.map(event => event.id.string)).toEqual([
            "MESSAGE_DELETE_BULK:session-1:9:deleted:0",
            "MESSAGE_DELETE_BULK:session-1:9:deleted:1",
        ]);
        expect(events.map(event => event.notice_type)).toEqual([
            "message_deleted",
            "message_deleted",
        ]);
    });

    it("不把仅长得像 mention 的普通文本误投影为提及", () => {
        const [event] = projectDiscordEvents(
            {
                name: "MESSAGE_CREATE",
                data: {
                    id: "10",
                    channel_id: "20",
                    author: { id: "40", username: "alice", discriminator: "0", avatar: null },
                    content: "literal <@41> @everyone",
                    timestamp: "2026-01-01T00:00:00.000Z",
                    edited_timestamp: null,
                    tts: false,
                    mention_everyone: false,
                    mentions: [],
                    mention_roles: [],
                    attachments: [],
                    embeds: [],
                    pinned: false,
                    type: 0,
                },
            },
            context,
        );

        expect(event?.type).toBe("message");
        if (event?.type !== "message") throw new Error("expected message");
        expect(event.message).toEqual([
            { type: "text", data: { text: "literal <@41> @everyone" } },
        ]);
    });

    it("Interaction 投影不泄露短期调用 token", () => {
        const [event] = projectDiscordEvents(
            {
                name: "INTERACTION_CREATE",
                data: {
                    id: "10",
                    application_id: "20",
                    type: 2,
                    token: "secret",
                    version: 1,
                    data: { name: "hello" },
                },
            },
            context,
        );

        expect(event?.extensions).toEqual({
            discord: { interaction_id: "10", data: { name: "hello" } },
        });
    });
});
