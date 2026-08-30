import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createSatoriClient } from "./client.js";
import { ProtocolError } from "./index.js";
import type { SatoriV1Event } from "./types.js";
import type { ChannelMessageEvent, PrivateMessageEvent } from "imhelper";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("Satori V1 client", () => {
    test("uses login.user.id for bot projection and exposes resource call", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify([])));
        vi.stubGlobal("fetch", fetchMock);
        const client = createSatoriClient({
            baseUrl: "https://events.example/v1",
            apiBaseUrl: "https://api.example/v1",
            platform: "test",
            selfId: "configured-fallback",
            receiveMode: "ws",
        });
        const projected = vi.fn();
        client.adapter.on("message.private", projected);
        client.on("event", event => expectTypeOf(event).toEqualTypeOf<SatoriV1Event>());

        client.ingest({
            id: "evt-1",
            type: "message-created",
            platform: "test",
            timestamp: 1_700_000_000_000,
            login: { user: { id: "zhin-bot" }, status: 1 },
            user: { id: "user-1" },
            message: { id: "msg-1", content: "你好", created_at: 1_700_000_000_000 },
        });
        const response = await client.call<unknown[]>("message", "create", {
            channel_id: "channel-1",
            content: "你好",
        });

        expect(projected).toHaveBeenCalledWith(expect.objectContaining({ bot_id: "zhin-bot" }));
        expect(response).toEqual([]);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.example/v1/message.create",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({ channel_id: "channel-1", content: "你好" }),
                headers: expect.objectContaining({
                    "Satori-Platform": "test",
                    "Satori-User-ID": "configured-fallback",
                }),
            }),
        );
    });

    test("unwraps Satori EVENT envelopes before projecting typed events", () => {
        const client = createSatoriClient({
            baseUrl: "https://events.example/v1/events",
            apiBaseUrl: "https://api.example/v1",
            platform: "test",
            selfId: "bot",
            receiveMode: "manual",
        });
        const projected = vi.fn();
        client.on("message.private", projected);

        client.ingest({
            op: 0,
            body: {
                id: "evt-1",
                type: "message-created",
                platform: "test",
                timestamp: 1_700_000_000_000,
                login: { user: { id: "bot" }, status: 1 },
                user: { id: "user-1" },
                message: { id: "msg-1", content: "你好", created_at: 1_700_000_000_000 },
            },
        } as unknown as SatoriV1Event);

        expect(projected).toHaveBeenCalledWith(expect.objectContaining({ message_id: "msg-1" }));
    });

    test("returns the native response without legacy envelope guessing", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { id: "bot" } })));
        const client = createSatoriClient({
            baseUrl: "https://satori.example/v1",
            platform: "kook",
            selfId: "bot",
            receiveMode: "ws",
            fetch: fetchMock,
        });

        await expect(client.call("login", "get")).resolves.toEqual({ data: { id: "bot" } });
        expect(fetchMock).toHaveBeenCalledWith(
            "https://satori.example/v1/login.get",
            expect.any(Object),
        );
    });

    test("uses baseUrl as the native Satori API root", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "bot" })));
        const client = createSatoriClient({
            baseUrl: "https://satori.example/v1",
            platform: "kook",
            selfId: "bot",
            receiveMode: "manual",
            fetch: fetchMock,
        });

        await client.call("login", "get");

        expect(fetchMock).toHaveBeenCalledWith(
            "https://satori.example/v1/login.get",
            expect.any(Object),
        );
    });

    test("appends the Satori events path to baseUrl", async () => {
        const socket = new EventEmitter() as EventEmitter & {
            close: ReturnType<typeof vi.fn>;
            send: ReturnType<typeof vi.fn>;
        };
        socket.close = vi.fn();
        socket.send = vi.fn();
        const createWebSocket = vi.fn(() => socket as never);
        const client = createSatoriClient({
            baseUrl: "https://gateway.example/kook/bot/satori/v1",
            platform: "kook",
            selfId: "bot",
            receiveMode: "ws",
            webSocket: { createWebSocket },
        });

        const started = client.start();
        socket.emit("open");
        await started;

        expect(createWebSocket).toHaveBeenCalledWith(
            "wss://gateway.example/kook/bot/satori/v1/events",
        );
        expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ op: 3, body: {} }));
        await client.stop();
    });

    test("wraps invalid JSON as a structured protocol error", async () => {
        const client = createSatoriClient({
            baseUrl: "https://api.example/v1",
            platform: "test",
            selfId: "bot",
            receiveMode: "manual",
            fetch: async () => new Response("not-json"),
        });

        await expect(client.call("login", "get")).rejects.toMatchObject({
            name: "ProtocolError",
            protocol: "satori-v1",
            operation: "login.get",
            kind: "protocol",
        } satisfies Partial<ProtocolError>);
    });

    test("collects paginated Satori lists and projects bound entities", async () => {
        const call = vi.fn(async (_resource: string, _method: string, params = {}) =>
            "next" in params
                ? { data: [{ id: "guild-2", name: "第二页" }] }
                : { data: [{ id: "guild-1", name: "第一页" }], next: "page-2" },
        );
        const client = createSatoriClient({
            baseUrl: "https://api.example/v1",
            platform: "test",
            selfId: "bot",
            receiveMode: "manual",
            call,
        });

        const groups = await client.getGroupList();

        expect(groups.map(group => group.groupName)).toEqual(["第一页", "第二页"]);
        expect(call).toHaveBeenNthCalledWith(1, "guild", "list", {});
        expect(call).toHaveBeenNthCalledWith(2, "guild", "list", { next: "page-2" });
    });

    test("emits complete canonical guild member notices", () => {
        const client = createSatoriClient({
            baseUrl: "https://api.example/v1",
            platform: "test",
            selfId: "bot",
            receiveMode: "manual",
        });
        const listener = vi.fn();
        client.adapter.on("notice.group_member_increase", listener);

        client.ingest({
            id: "event-1",
            type: "guild-member-added",
            platform: "test",
            timestamp: 1_700_000_000_000,
            guild: { id: "guild-1" },
            user: { id: "user-1" },
            operator: { id: "admin-1" },
        });

        expect(listener).toHaveBeenCalledWith({
            timestamp: 1_700_000_000,
            bot_id: "bot",
            notice_type: "group_member_increase",
            sub_type: "approve",
            group_id: "guild-1",
            user_id: "user-1",
            operator_id: "admin-1",
        });
    });

    test("creates a direct channel before sending a private message", async () => {
        const call = vi.fn(async (resource: string, method: string) =>
            resource === "user" && method === "channel.create"
                ? { id: "direct-1", type: 1 }
                : [{ id: "message-1" }],
        );
        const client = createSatoriClient({
            baseUrl: "https://api.example/v1",
            platform: "test",
            selfId: "bot",
            receiveMode: "manual",
            call,
        });

        await client.sendPrivateMessage("user-1", "hello");

        expect(call).toHaveBeenNthCalledWith(1, "user", "channel.create", {
            user_id: "user-1",
        });
        expect(call).toHaveBeenNthCalledWith(2, "message", "create", {
            channel_id: "direct-1",
            content: "hello",
        });
    });

    test("preserves private channel context for reply, edit and recall", async () => {
        const call = vi.fn(async () => undefined);
        const client = createSatoriClient({
            baseUrl: "https://api.example/v1",
            platform: "test",
            selfId: "bot",
            receiveMode: "manual",
            call,
        });
        let message: PrivateMessageEvent<string> | undefined;
        client.on("message.private", event => {
            message = event;
        });
        client.ingest({
            id: "event-1",
            type: "message-created",
            platform: "test",
            timestamp: 1_700_000_000_000,
            channel: { id: "direct-1" },
            user: { id: "user-1" },
            message: { id: "message-1", content: "hello", created_at: 1_700_000_000_000 },
        });

        await message?.reply("reply");
        await message?.edit("edited");
        await message?.recall();

        expect(message?.channel_id).toBe("direct-1");
        expect(call).toHaveBeenNthCalledWith(1, "message", "create", {
            channel_id: "direct-1",
            content: "reply",
        });
        expect(call).toHaveBeenNthCalledWith(2, "message", "update", {
            channel_id: "direct-1",
            message_id: "message-1",
            content: "edited",
        });
        expect(call).toHaveBeenNthCalledWith(3, "message", "delete", {
            channel_id: "direct-1",
            message_id: "message-1",
        });
    });

    test("uses channel context for native reactions", async () => {
        const call = vi.fn(async () => undefined);
        const client = createSatoriClient({
            baseUrl: "https://api.example/v1",
            platform: "test",
            selfId: "bot",
            receiveMode: "manual",
            call,
        });
        let message: ChannelMessageEvent<string> | undefined;
        client.on("message.channel", event => {
            message = event;
        });
        client.ingest({
            id: "event-1",
            type: "message-created",
            platform: "test",
            timestamp: 1_700_000_000_000,
            channel: { id: "channel-1" },
            guild: { id: "guild-1" },
            user: { id: "user-1" },
            message: { id: "message-1", content: "hello", created_at: 1_700_000_000_000 },
        });

        await message?.addReaction("👍");
        await message?.removeReaction("👍");

        expect(call).toHaveBeenNthCalledWith(1, "reaction", "create", {
            channel_id: "channel-1",
            message_id: "message-1",
            emoji: "👍",
        });
        expect(call).toHaveBeenNthCalledWith(2, "reaction", "delete", {
            channel_id: "channel-1",
            message_id: "message-1",
            emoji: "👍",
        });
    });

    test("projects guild message deletion without pretending it is a group recall", () => {
        const client = createSatoriClient({
            baseUrl: "https://api.example/v1",
            platform: "test",
            selfId: "bot",
            receiveMode: "manual",
        });
        const listener = vi.fn();
        client.on("notice.channel_message_delete", listener);

        client.ingest({
            id: "event-1",
            type: "message-deleted",
            platform: "test",
            timestamp: 1_700_000_000_000,
            channel: { id: "channel-1" },
            guild: { id: "guild-1" },
            user: { id: "user-1" },
            operator: { id: "admin-1" },
            message: { id: "message-1" },
        });

        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({
                channel_id: "channel-1",
                guild_id: "guild-1",
                message_id: "message-1",
                operator_id: "admin-1",
            }),
        );
    });

    test("requires an explicit guild scope for channel directories", async () => {
        const call = vi.fn(async () => ({
            data: [{ id: "channel-1", name: "general" }],
        }));
        const client = createSatoriClient({
            baseUrl: "https://api.example/v1",
            platform: "test",
            selfId: "bot",
            receiveMode: "manual",
            call,
        });

        await expect(client.getChannelList()).rejects.toMatchObject({
            name: "ProtocolError",
            operation: "channel.list",
            kind: "validation",
        });
        const [channel] = await client.getChannelList({
            scope: { type: "guild", id: "guild-1" },
        });
        await channel.setName("renamed");

        expect(channel.channel_name).toBe("general");
        expect(call).toHaveBeenNthCalledWith(1, "channel", "list", {
            guild_id: "guild-1",
        });
        expect(call).toHaveBeenNthCalledWith(2, "channel", "update", {
            channel_id: "channel-1",
            data: { name: "renamed" },
        });
    });

    test("exposes native friend and guild request management", async () => {
        const call = vi.fn(async () => undefined);
        const client = createSatoriClient({
            baseUrl: "https://api.example/v1",
            platform: "test",
            selfId: "bot",
            receiveMode: "manual",
            call,
        });

        await client.adapter.deleteFriend("user-1");
        await client.approveFriendRequest("friend-request-1", false, "拒绝原因");
        await client.approveGroupRequest("guild-request-1", true, "同意");

        expect(call).toHaveBeenNthCalledWith(1, "friend", "delete", { user_id: "user-1" });
        expect(call).toHaveBeenNthCalledWith(2, "friend", "approve", {
            message_id: "friend-request-1",
            approve: false,
            comment: "拒绝原因",
        });
        expect(call).toHaveBeenNthCalledWith(3, "guild", "approve", {
            message_id: "guild-request-1",
            approve: true,
            comment: "同意",
        });
    });

    test("rejects sending directly to a guild instead of treating it as a channel", async () => {
        const client = createSatoriClient({
            baseUrl: "https://api.example/v1",
            platform: "test",
            selfId: "bot",
            receiveMode: "manual",
            call: async () => undefined,
        });

        await expect(client.sendGroupMessage("guild-1", "hello")).rejects.toMatchObject({
            name: "UnsupportedAdapterOperationError",
            operation: "sendMessage:group",
        });
    });
});
