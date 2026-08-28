import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createMilkyAdapter } from "./adapter.js";
import { createMilkyClient } from "./client.js";
import { ProtocolError } from "./index.js";
import type { MilkyV1Event, MilkyV1Response } from "./types.js";

const event: MilkyV1Event = {
    time: 1_700_000_000,
    self_id: 10001,
    event_type: "message_receive",
    data: {
        message_scene: "friend",
        peer_id: 20002,
        message_seq: 30003,
        sender_id: 20002,
        time: 1_700_000_000,
        segments: [{ type: "text", data: { text: "你好" } }],
        friend: { user_id: 20002, nickname: "测试用户" },
    },
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("Milky V1 SDK", () => {
    test("exports a typed client with raw events and protocol call", async () => {
        const call = vi.fn(async () => ({ status: "ok" as const, retcode: 0, data: {} }));
        const client = createMilkyClient({
            baseUrl: "https://milky.example",
            selfId: "10001",
            receiveMode: "ws",
            call,
        });

        client.on("event", rawEvent => {
            expectTypeOf(rawEvent).toEqualTypeOf<MilkyV1Event>();
        });
        expectTypeOf(client.adapter).toMatchTypeOf<ReturnType<typeof createMilkyAdapter>>();
        await client.call("get_login_info");

        expect(call).toHaveBeenCalledWith("get_login_info", {});
    });

    test("projects a native message_receive event by data.message_scene", () => {
        const adapter = createMilkyAdapter({
            baseUrl: "https://milky.example",
            selfId: "10001",
            receiveMode: "ws",
        });
        const onMessage = vi.fn();
        const onEvent = vi.fn();
        adapter.on("message.private", onMessage);
        adapter.on("event", onEvent);

        adapter.transformEvent(event);

        expect(onMessage).toHaveBeenCalledWith({
            timestamp: 1_700_000_000,
            bot_id: "10001",
            message_id: "milky:friend:20002:30003",
            user_id: "20002",
            content: [{ type: "text", data: { text: "你好" } }],
            message_type: "private",
        });
        expect(onEvent).toHaveBeenCalledWith(event);
    });

    test("calls native Milky message APIs under /api", async () => {
        const responses: MilkyV1Response[] = [
            { status: "ok", retcode: 0, data: { message_seq: 40004, time: 1_700_000_001 } },
            { status: "ok", retcode: 0, data: {} },
        ];
        const fetchMock = vi.fn(
            async () =>
                new Response(JSON.stringify(responses.shift()), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
        );
        vi.stubGlobal("fetch", fetchMock);
        const adapter = createMilkyAdapter({
            baseUrl: "https://milky.example/",
            selfId: "10001",
            receiveMode: "ws",
        });

        await adapter.sendMessage({
            scene_type: "private",
            scene_id: "20002",
            message: "你好",
        });
        adapter.transformEvent(event);
        await adapter.recallMessage("milky:friend:20002:30003");

        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            "https://milky.example/api/send_private_message",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    user_id: 20002,
                    message: [{ type: "text", data: { text: "你好" } }],
                }),
            }),
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            "https://milky.example/api/recall_private_message",
            expect.objectContaining({
                body: JSON.stringify({ user_id: 20002, message_seq: 30003 }),
            }),
        );
    });

    test("uses conversation-scoped message IDs without cross-chat collisions", async () => {
        const call = vi.fn(async () => ({ status: "ok" as const, retcode: 0, data: {} }));
        const adapter = createMilkyAdapter({
            baseUrl: "https://milky.example",
            selfId: "10001",
            receiveMode: "ws",
            call,
        });

        await adapter.recallMessage("milky:friend:20002:7");
        await adapter.recallMessage("milky:group:30003:7");

        expect(call).toHaveBeenNthCalledWith(1, "recall_private_message", {
            user_id: 20002,
            message_seq: 7,
        });
        expect(call).toHaveBeenNthCalledWith(2, "recall_group_message", {
            group_id: 30003,
            message_seq: 7,
        });
    });

    test("calls the OneBots friend-to-group invitation extension", async () => {
        const call = vi.fn(async () => ({ status: "ok" as const, retcode: 0, data: {} }));
        const client = createMilkyClient({
            baseUrl: "https://milky.example",
            selfId: "10001",
            receiveMode: "manual",
            call,
        });

        await client.inviteFriendToGroup("30003", "20002");

        expect(call).toHaveBeenCalledWith("invite_friend_to_group", {
            group_id: 30003,
            user_id: 20002,
        });
    });

    test("appends the native API route to baseUrl without guessing gateway routes", async () => {
        const fetchMock = vi.fn(
            async () => new Response(JSON.stringify({ status: "ok", retcode: 0, data: {} })),
        );
        const adapter = createMilkyAdapter({
            baseUrl: "https://gateway.example/kook/10001/milky/v1",
            selfId: "10001",
            receiveMode: "ws",
            fetch: fetchMock,
        });

        await adapter.call("get_login_info");

        expect(fetchMock).toHaveBeenCalledWith(
            "https://gateway.example/kook/10001/milky/v1/api/get_login_info",
            expect.any(Object),
        );
    });

    test("appends the native event route to baseUrl", async () => {
        const socket = new EventEmitter() as EventEmitter & {
            close: ReturnType<typeof vi.fn>;
        };
        socket.close = vi.fn();
        const createWebSocket = vi.fn(() => socket as never);
        const client = createMilkyClient({
            baseUrl: "https://gateway.example/kook/10001/milky/v1",
            selfId: "10001",
            receiveMode: "ws",
            webSocket: { createWebSocket },
        });

        const started = client.start();
        socket.emit("open");
        await started;

        expect(createWebSocket).toHaveBeenCalledWith(
            "wss://gateway.example/kook/10001/milky/v1/event",
        );
        await client.stop();
    });

    test("throws ProtocolError for a failed Milky response", async () => {
        const client = createMilkyClient({
            baseUrl: "https://milky.example",
            selfId: "10001",
            receiveMode: "manual",
            call: async () => ({ status: "failed", retcode: 1200, message: "bad request" }),
        });

        await expect(client.call("send_private_message")).rejects.toMatchObject({
            name: "ProtocolError",
            kind: "protocol",
            protocol: "milky-v1",
            operation: "send_private_message",
            code: 1200,
        } satisfies Partial<ProtocolError>);
    });
});
