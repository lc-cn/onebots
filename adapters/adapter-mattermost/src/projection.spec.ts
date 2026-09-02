import { describe, expect, it } from "vitest";
import { projectMattermostEvent } from "./events.js";
import { compileMattermostMessage, projectMattermostPost } from "./messages.js";
import type { MattermostChannel, MattermostDelivery, MattermostPost } from "./types.js";
import {
    parseMattermostDelivery,
    parseMattermostPost,
    parseMattermostWebSocketMessage,
} from "./validation.js";

describe("Mattermost strict projection", () => {
    it("解析字符串化 post、校验 metadata，并保留原始 envelope", () => {
        const raw = event("posted", {
            post: JSON.stringify(post({ metadata: { files: [file()] } })),
            sender_name: "alice",
            channel_type: "O",
        });
        const packet = parseMattermostWebSocketMessage(raw);
        if (!("event" in packet)) throw new Error("expected event");
        const delivery = parseMattermostDelivery(packet);
        expect(delivery.post?.metadata?.files?.[0]).toMatchObject({
            id: "file1",
            mime_type: "image/png",
        });

        const projected = projectMattermostEvent(delivery, context())[0];
        expect(projected).toMatchObject({
            type: "message",
            message_type: "channel",
            message_id: id("post1"),
            sender: { id: id("user1"), name: "alice" },
            group: { id: id("channel1"), guild_id: id("team1") },
            raw_event: raw,
        });
        expect(projected.message).toEqual([
            { type: "text", data: { text: "hello" } },
            {
                type: "image",
                data: expect.objectContaining({ file_id: "file1", name: "image.png" }),
            },
        ]);
    });

    it("拒绝伪造 post、成员和 WebSocket response 结构", () => {
        expect(() => parseMattermostPost({ ...post(), create_at: "now" })).toThrow(/create_at/u);
        expect(() =>
            parseMattermostPost({ ...post(), metadata: { files: { id: "file1" } } }),
        ).toThrow(/metadata.files/u);
        expect(() => parseMattermostWebSocketMessage({ status: "FAIL", seq_reply: 1 })).toThrow(
            /error/u,
        );
    });

    it("覆盖 edit/delete/reaction/typing/resource/lifecycle 与未知插件事件", () => {
        const cases: Array<[MattermostDelivery, string, string | undefined]> = [
            [
                delivery("post_edited", { post: JSON.stringify(post()) }),
                "message_updated",
                undefined,
            ],
            [
                delivery("post_deleted", { post: JSON.stringify(post()) }),
                "message_deleted",
                undefined,
            ],
            [
                delivery("reaction_added", {
                    reaction: JSON.stringify({
                        user_id: "user1",
                        post_id: "post1",
                        emoji_name: "thumbsup",
                        create_at: 10,
                    }),
                }),
                "reaction_added",
                undefined,
            ],
            [delivery("typing", { user_id: "user1" }), "typing_started", undefined],
            [delivery("channel_deleted", { channel_id: "channel1" }), "channel_deleted", undefined],
            [delivery("hello", { connection_id: "connection1" }), "lifecycle", "connect"],
            [delivery("plugin_example", { value: 1 }), "custom", "plugin_example"],
        ];
        for (const [input, eventType, subType] of cases) {
            expect(projectMattermostEvent(input, context())[0]).toMatchObject({
                ...(eventType === "lifecycle"
                    ? { meta_type: eventType }
                    : { notice_type: eventType }),
                ...(subType ? { sub_type: subType } : {}),
            });
        }
    });
});

describe("Mattermost message mapping", () => {
    it("编译 Markdown、mention、emoji、thread、已上传文件和位置", () => {
        expect(
            compileMattermostMessage("channel1", [
                { type: "text", data: { text: "hello " } },
                { type: "at", data: { username: "alice" } },
                { type: "emoji", data: { name: "wave" } },
                { type: "thread", data: { root_id: "root1" } },
                { type: "image", data: { file_id: "file1" } },
                { type: "location", data: { latitude: 1, longitude: 2, name: "HQ" } },
            ]),
        ).toEqual({
            channel_id: "channel1",
            message: "hello @alice:wave:[HQ](https://www.openstreetmap.org/?mlat=1&mlon=2)",
            root_id: "root1",
            file_ids: ["file1"],
        });
    });

    it("公开 URL 编译为 Markdown，危险协议和未知段被拒绝", () => {
        expect(
            compileMattermostMessage("channel1", [
                { type: "image", data: { url: "https://cdn.example.com/a.png", name: "a" } },
            ]).message,
        ).toBe("![a](https://cdn.example.com/a.png)");
        expect(() =>
            compileMattermostMessage("channel1", [
                { type: "file", data: { url: "file:///etc/passwd" } },
            ]),
        ).toThrow(/HTTP/u);
        expect(() => compileMattermostMessage("channel1", [{ type: "button", data: {} }])).toThrow(
            /不支持/u,
        );
    });

    it("空 post 仍投影稳定文本段，thread 保留 root", () => {
        expect(projectMattermostPost(post({ message: "", root_id: "root1" }))).toEqual([
            { type: "thread", data: { root_id: "root1", message_id: "root1" } },
        ]);
        expect(projectMattermostPost(post({ message: "" }))).toEqual([
            { type: "text", data: { text: "" } },
        ]);
    });
});

function context() {
    const channel: MattermostChannel = {
        id: "channel1",
        create_at: 1,
        update_at: 1,
        delete_at: 0,
        team_id: "team1",
        type: "O",
        display_name: "Town Square",
        name: "town-square",
    };
    return {
        botId: id("bot1"),
        createId: (value: string | number) => id(String(value)),
        resolveChannel: (channelId: string) => (channelId === channel.id ? channel : undefined),
    };
}

function delivery(eventType: string, data: Record<string, unknown>): MattermostDelivery {
    const packet = parseMattermostWebSocketMessage(event(eventType, data));
    if (!("event" in packet)) throw new Error("expected event");
    return parseMattermostDelivery(packet);
}

function event(eventType: string, data: Record<string, unknown>) {
    return {
        event: eventType,
        data,
        broadcast: { channel_id: "channel1", team_id: "team1" },
        seq: 1,
    };
}

function post(overrides: Partial<MattermostPost> = {}): MattermostPost {
    return {
        id: "post1",
        create_at: 10,
        update_at: 10,
        edit_at: 0,
        delete_at: 0,
        is_pinned: false,
        user_id: "user1",
        channel_id: "channel1",
        root_id: "",
        original_id: "",
        message: "hello",
        type: "",
        props: {},
        hashtags: "",
        file_ids: [],
        pending_post_id: "",
        ...overrides,
    };
}

function file() {
    return {
        id: "file1",
        user_id: "user1",
        post_id: "post1",
        channel_id: "channel1",
        create_at: 10,
        update_at: 10,
        delete_at: 0,
        name: "image.png",
        size: 12,
        mime_type: "image/png",
    };
}

function id(value: string) {
    return { platform: "mattermost", value, string: value };
}
