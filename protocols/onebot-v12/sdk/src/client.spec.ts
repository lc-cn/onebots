import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createOnebot12Client } from "./client.js";
import { ProtocolError } from "./index.js";
import type { OneBotV12Event } from "./types.js";
import { User } from "imhelper";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("OneBot V12 client", () => {
    test("supports manual ingress and exposes response echo", async () => {
        const createWebSocket = vi.fn(() => {
            throw new Error("manual mode must not create a socket");
        });
        const fetchMock = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({ status: "ok", retcode: 0, data: {}, echo: "request-1" }),
                ),
        );
        const client = createOnebot12Client({
            baseUrl: "https://gateway.example",
            apiBaseUrl: "https://api.example",
            selfId: "bot",
            receiveMode: "manual",
            fetch: fetchMock,
            webSocket: { createWebSocket },
        });

        await client.start();
        expect(createWebSocket).not.toHaveBeenCalled();
        const response = await client.call("get_self_info");

        expect(response.echo).toBe("request-1");
    });

    test("throws a structured protocol error for HTTP failures", async () => {
        const client = createOnebot12Client({
            baseUrl: "https://gateway.example",
            apiBaseUrl: "https://api.example",
            selfId: "bot",
            receiveMode: "manual",
            fetch: async () => new Response("upstream unavailable", { status: 503 }),
        });

        const request = client.call("get_self_info");
        await expect(request).rejects.toBeInstanceOf(ProtocolError);
        await expect(request).rejects.toMatchObject({
            name: "ProtocolError",
            protocol: "onebot-v12",
            operation: "get_self_info",
            kind: "transport",
            httpStatus: 503,
        });
    });

    test("calls the friend-to-group invitation extension", async () => {
        const call = vi.fn(async () => ({ status: "ok" as const, retcode: 0, data: {} }));
        const client = createOnebot12Client({
            baseUrl: "https://example.test",
            selfId: "bot",
            receiveMode: "manual",
            call,
        });

        await client.inviteFriendToGroup("30003", "20002");

        expect(call).toHaveBeenCalledWith("invite_friend_to_group", {
            group_id: "30003",
            user_id: "20002",
        });
    });

    test("accepts a friend request with its opaque flag", async () => {
        const call = vi.fn(async () => ({ status: "ok" as const, retcode: 0, data: {} }));
        const client = createOnebot12Client({
            baseUrl: "https://example.test",
            selfId: "bot",
            receiveMode: "manual",
            call,
        });

        await client.acceptFriendRequest("opaque-request-flag", "已验证");

        expect(call).toHaveBeenCalledWith("accept_friend_request", {
            flag: "opaque-request-flag",
            remark: "已验证",
        });
    });

    test("wraps invalid JSON as a structured protocol error", async () => {
        const client = createOnebot12Client({
            baseUrl: "https://gateway.example",
            selfId: "bot",
            receiveMode: "manual",
            fetch: async () => new Response("not-json"),
        });

        await expect(client.call("get_self_info")).rejects.toMatchObject({
            name: "ProtocolError",
            protocol: "onebot-v12",
            operation: "get_self_info",
            kind: "protocol",
        });
    });

    test("keeps raw event type and supports a custom action URL resolver", async () => {
        const fetchMock = vi.fn(
            async () => new Response(JSON.stringify({ status: "ok", retcode: 0, data: {} })),
        );
        vi.stubGlobal("fetch", fetchMock);
        const client = createOnebot12Client({
            baseUrl: "https://events.example/onebot/v12",
            apiBaseUrl: "https://api.example",
            resolveActionUrl: action => `https://actions.example/${action}`,
            selfId: "bot",
            receiveMode: "ws",
        });

        client.on("event", event => expectTypeOf(event).toEqualTypeOf<OneBotV12Event>());
        await client.call("get_self_info");

        expect(fetchMock).toHaveBeenCalledWith(
            "https://actions.example/get_self_info",
            expect.objectContaining({ method: "POST" }),
        );
    });

    test("uses baseUrl verbatim as the protocol API root", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok" })));
        const client = createOnebot12Client({
            baseUrl: "https://gateway.example/kook/bot/onebot/v12",
            selfId: "bot",
            receiveMode: "ws",
            fetch: fetchMock,
        });

        await client.call("get_self_info");

        expect(fetchMock).toHaveBeenCalledWith(
            "https://gateway.example/kook/bot/onebot/v12/get_self_info",
            expect.any(Object),
        );
    });

    test("uses baseUrl as the WebSocket endpoint without guessing routes", async () => {
        const socket = new EventEmitter() as EventEmitter & {
            close: ReturnType<typeof vi.fn>;
        };
        socket.close = vi.fn();
        const createWebSocket = vi.fn(() => socket as never);
        const client = createOnebot12Client({
            baseUrl: "https://gateway.example/kook/bot/onebot/v12",
            selfId: "bot",
            receiveMode: "ws",
            webSocket: { createWebSocket },
        });

        const started = client.start();
        socket.emit("open");
        await started;

        expect(createWebSocket).toHaveBeenCalledWith("wss://gateway.example/kook/bot/onebot/v12");
        await client.stop();
    });

    test("uses the standard friend list action for user directories", async () => {
        const call = vi.fn(async () => ({
            status: "ok" as const,
            retcode: 0,
            data: [{ user_id: "user-1", user_name: "Alice", user_remark: "备注" }],
        }));
        const client = createOnebot12Client({
            baseUrl: "https://example.test",
            selfId: "bot",
            receiveMode: "manual",
            call,
        });

        const [user] = await client.getUserList();

        expect(user).toBeInstanceOf(User);
        expect(user.user_name).toBe("Alice");
        expect(call).toHaveBeenCalledWith("get_friend_list", {});
    });

    test("keeps guild and channel addresses closed across events and directories", async () => {
        const call = vi.fn(async (action: string) => {
            if (action === "get_channel_list") {
                return {
                    status: "ok" as const,
                    retcode: 0,
                    data: [{ channel_id: "channel-1", channel_name: "General" }],
                };
            }
            if (action === "get_channel_member_list") {
                return {
                    status: "ok" as const,
                    retcode: 0,
                    data: [{ user_id: "user-1", user_name: "Alice" }],
                };
            }
            return { status: "ok" as const, retcode: 0, data: {} };
        });
        const client = createOnebot12Client({
            baseUrl: "https://example.test",
            selfId: "bot",
            receiveMode: "manual",
            call,
        });
        let reply: Promise<unknown> | undefined;
        client.on("message.channel", event => {
            expect(event.guild_id).toBe("guild-1");
            expect(event.channel.guild_id).toBe("guild-1");
            reply = event.reply("pong");
        });

        client.ingest({
            id: "event-1",
            time: 1,
            type: "message",
            detail_type: "channel",
            sub_type: "",
            self: { platform: "test", user_id: "bot" },
            guild_id: "guild-1",
            channel_id: "channel-1",
            user_id: "user-1",
            message_id: "message-1",
            message: [{ type: "text", data: { text: "ping" } }],
        });
        await reply;

        const [channel] = await client.getChannelList({
            scope: { type: "guild", id: "guild-1" },
        });
        const [member] = await client.getChannelMemberList(channel.channel_id);

        expect(member.user_id).toBe("user-1");
        expect(call).toHaveBeenCalledWith("send_message", {
            detail_type: "channel",
            guild_id: "guild-1",
            channel_id: "channel-1",
            message: [{ type: "text", data: { text: "pong" } }],
        });
        expect(call).toHaveBeenCalledWith("get_channel_list", { guild_id: "guild-1" });
        expect(call).toHaveBeenCalledWith("get_channel_member_list", {
            guild_id: "guild-1",
            channel_id: "channel-1",
        });
    });
});
