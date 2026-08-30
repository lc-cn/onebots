import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createOnebot11Client } from "./client.js";
import { ProtocolError } from "./index.js";
import { PrivateMessageEvent, User } from "imhelper";
import type { OneBotV11Event, OneBotV11Response } from "./types.js";

type IsAny<T> = 0 extends 1 & T ? true : false;
type ExpectFalse<T extends false> = T;

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("OneBot V11 client", () => {
    test("keeps protocol types and calls an injected API base URL", async () => {
        const fetchMock = vi.fn(
            async () =>
                new Response(JSON.stringify({ status: "ok", retcode: 0, data: { user_id: 1 } })),
        );
        vi.stubGlobal("fetch", fetchMock);
        const client = createOnebot11Client({
            baseUrl: "https://events.example/onebot/v11",
            apiBaseUrl: "https://api.example/onebot/v11",
            selfId: "1",
            receiveMode: "ws",
        });

        client.on("event", event => expectTypeOf(event).toEqualTypeOf<OneBotV11Event>());
        type SendResultIsNotAny = ExpectFalse<
            IsAny<Awaited<ReturnType<typeof client.sendPrivateMessage>>>
        >;
        const sendResultIsTyped: SendResultIsNotAny = false;
        expect(sendResultIsTyped).toBe(false);
        const response = await client.call<{ user_id: number }>("get_login_info");
        expectTypeOf(response).toEqualTypeOf<OneBotV11Response<{ user_id: number }>>();
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.example/onebot/v11/get_login_info",
            expect.objectContaining({ method: "POST", body: "{}" }),
        );
    });

    test("uses baseUrl verbatim as the protocol API root", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok" })));
        const client = createOnebot11Client({
            baseUrl: "https://gateway.example/kook/bot/onebot/v11",
            selfId: "1",
            receiveMode: "ws",
            fetch: fetchMock,
        });

        await client.call("get_login_info");

        expect(fetchMock).toHaveBeenCalledWith(
            "https://gateway.example/kook/bot/onebot/v11/get_login_info",
            expect.any(Object),
        );
    });

    test("calls the friend-to-group invitation extension", async () => {
        const call = vi.fn(async () => ({ status: "ok" as const, retcode: 0, data: {} }));
        const client = createOnebot11Client({
            baseUrl: "https://example.test",
            selfId: "1",
            receiveMode: "manual",
            call,
        });

        await client.inviteFriendToGroup(30003, 20002);

        expect(call).toHaveBeenCalledWith("invite_friend_to_group", {
            group_id: 30003,
            user_id: 20002,
        });
    });

    test("accepts a friend request with its opaque flag", async () => {
        const call = vi.fn(async () => ({ status: "ok" as const, retcode: 0, data: {} }));
        const client = createOnebot11Client({
            baseUrl: "https://example.test",
            selfId: "1",
            receiveMode: "manual",
            call,
        });

        await client.acceptFriendRequest("opaque-request-flag", "已验证");

        expect(call).toHaveBeenCalledWith("accept_friend_request", {
            flag: "opaque-request-flag",
            remark: "已验证",
        });
    });

    test("uses baseUrl as the WebSocket endpoint without guessing routes", async () => {
        const socket = new EventEmitter() as EventEmitter & {
            close: ReturnType<typeof vi.fn>;
        };
        socket.close = vi.fn();
        const createWebSocket = vi.fn(() => socket as never);
        const client = createOnebot11Client({
            baseUrl: "https://gateway.example/kook/bot/onebot/v11",
            selfId: "1",
            receiveMode: "ws",
            webSocket: { createWebSocket },
        });

        const started = client.start();
        socket.emit("open");
        await started;

        expect(createWebSocket).toHaveBeenCalledWith("wss://gateway.example/kook/bot/onebot/v11");
        await client.stop();
    });

    test("throws ProtocolError for a failed protocol response", async () => {
        const client = createOnebot11Client({
            baseUrl: "https://example.test",
            selfId: "1",
            receiveMode: "manual",
            call: async () => ({ status: "failed", retcode: 1404, message: "missing" }),
        });

        await expect(client.call("get_msg")).rejects.toMatchObject({
            name: "ProtocolError",
            kind: "protocol",
            protocol: "onebot-v11",
            operation: "get_msg",
            code: 1404,
        } satisfies Partial<ProtocolError>);
    });

    test("projects friend directory DTOs to bound user instances", async () => {
        const call = vi.fn(async (action: string) => ({
            status: "ok" as const,
            retcode: 0,
            data:
                action === "get_friend_list"
                    ? [{ user_id: 2, nickname: "好友", remark: "备注" }]
                    : {},
        }));
        const client = createOnebot11Client({
            baseUrl: "https://example.test",
            selfId: "1",
            receiveMode: "manual",
            call,
        });

        const [user] = await client.getUserList();
        await user.sendMessage("hello");

        expect(user).toBeInstanceOf(User);
        expect(user.user_name).toBe("好友");
        expect(call).toHaveBeenNthCalledWith(1, "get_friend_list", {});
        expect(call).toHaveBeenNthCalledWith(2, "send_private_msg", {
            user_id: 2,
            message: "hello",
        });
    });

    test("returns a bound message event from get_msg", async () => {
        const call = vi.fn(async (action: string) => ({
            status: "ok" as const,
            retcode: 0,
            data:
                action === "get_msg"
                    ? {
                          time: 10,
                          message_type: "private",
                          message_id: 7,
                          sender: { user_id: 2 },
                          message: "hello",
                      }
                    : {},
        }));
        const client = createOnebot11Client({
            baseUrl: "https://example.test",
            selfId: "1",
            receiveMode: "manual",
            call,
        });

        const message = await client.getMessage(7);
        await message.reply("world");

        expect(message).toBeInstanceOf(PrivateMessageEvent);
        expect(call).toHaveBeenNthCalledWith(1, "get_msg", { message_id: 7 });
        expect(call).toHaveBeenNthCalledWith(2, "send_private_msg", {
            user_id: 2,
            message: "world",
        });
    });

    test("rejects malformed directory responses instead of hiding them as empty lists", async () => {
        const client = createOnebot11Client({
            baseUrl: "https://example.test",
            selfId: "1",
            receiveMode: "manual",
            call: async () => ({ status: "ok", retcode: 0, data: {} }),
        });

        await expect(client.getUserList()).rejects.toMatchObject({
            name: "ProtocolError",
            operation: "get_friend_list",
        });
    });
});
