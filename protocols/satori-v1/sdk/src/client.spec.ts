import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createSatoriClient } from "./client.js";
import { ProtocolError } from "./index.js";
import type { SatoriV1Event } from "./types.js";

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
});
