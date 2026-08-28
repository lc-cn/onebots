import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createOnebot12Client } from "./client.js";
import { ProtocolError } from "./index.js";
import type { OneBotV12Event } from "./types.js";

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

    test("preserves the legacy OneBots route when apiBaseUrl is omitted", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok" })));
        const client = createOnebot12Client({
            baseUrl: "https://gateway.example",
            platform: "kook",
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

    test("connects legacy OneBots WebSocket at the account protocol path", async () => {
        const socket = new EventEmitter() as EventEmitter & {
            close: ReturnType<typeof vi.fn>;
        };
        socket.close = vi.fn();
        const createWebSocket = vi.fn(() => socket as never);
        const client = createOnebot12Client({
            baseUrl: "https://gateway.example",
            platform: "kook",
            selfId: "bot",
            receiveMode: "ws",
            webSocket: { createWebSocket },
        });

        const started = client.start();
        socket.emit("open");
        await started;

        expect(createWebSocket).toHaveBeenCalledWith(
            "wss://gateway.example/kook/bot/onebot/v12",
        );
        await client.stop();
    });
});
