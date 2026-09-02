import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { TwitchEventSubTransport } from "./eventsub.js";
import type { TwitchConfig, TwitchEventSubMessage } from "./types.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
});

describe("TwitchEventSubTransport", () => {
    it("完成 welcome 握手并由 AbortSignal 关闭 owned socket", async () => {
        let serverSocket: WebSocket | undefined;
        const host = await websocketHost(socket => {
            serverSocket = socket;
            socket.send(JSON.stringify(welcome("session1")));
        });
        const transport = new TwitchEventSubTransport(config(host.url));
        const controller = new AbortController();

        await expect(transport.start(controller.signal)).resolves.toMatchObject({
            id: "session1",
        });
        expect(transport.connected).toBe(true);
        const before = watchdog(transport);
        const observed = Promise.withResolvers<void>();
        transport.on("message", message => {
            if (message.metadata.message_type === "notification") observed.resolve();
        });
        serverSocket?.send(JSON.stringify(notification("notification1")));
        await observed.promise;
        expect(watchdog(transport)).toBeDefined();
        expect(watchdog(transport)).not.toBe(before);
        controller.abort(new Error("shutdown"));
        await vi.waitFor(() => expect(serverSocket?.readyState).toBe(WebSocket.CLOSED));
        await transport.stop();
        expect(transport.connected).toBe(false);
    });

    it("异常断线后持续重连，并将新 session 标记为非 resumed", async () => {
        let connections = 0;
        const second = Promise.withResolvers<void>();
        const host = await websocketHost(socket => {
            connections += 1;
            const current = connections;
            socket.send(JSON.stringify(welcome(`session${current}`)));
            if (current === 1) setTimeout(() => socket.close(1012, "restart"), 5);
            else second.resolve();
        });
        const transport = new TwitchEventSubTransport(config(host.url), {
            sleep: async (_delay, signal) => signal.throwIfAborted(),
        });
        const connected = vi.fn();
        transport.on("connected", connected);

        await transport.start();
        await second.promise;
        await vi.waitFor(() => expect(connected).toHaveBeenCalledTimes(2));
        expect(connected.mock.calls.map(([, resumed]) => resumed)).toEqual([false, false]);
        expect(connections).toBe(2);
        await transport.stop();
    });

    it("遵循官方 reconnect_url 无损迁移并标记 resumed", async () => {
        let connections = 0;
        let reconnectUrl = "";
        const resumed = Promise.withResolvers<void>();
        const host = await websocketHost((socket, url) => {
            connections += 1;
            if (connections === 1) {
                socket.send(JSON.stringify(welcome("session1")));
                setTimeout(
                    () =>
                        socket.send(
                            JSON.stringify(reconnect("session1", `${reconnectUrl}/reconnect`)),
                        ),
                    5,
                );
            } else {
                expect(url).toBe("/reconnect");
                socket.send(JSON.stringify(welcome("session2")));
                resumed.resolve();
            }
        });
        reconnectUrl = host.url.replace("/ws", "");
        const transport = new TwitchEventSubTransport(config(host.url));
        const connected = vi.fn();
        transport.on("connected", connected);

        await transport.start();
        await resumed.promise;
        await vi.waitFor(() => expect(connected).toHaveBeenCalledTimes(2));
        expect(connected.mock.calls[1]).toEqual([
            expect.objectContaining({ id: "session2" }),
            true,
        ]);
        expect(connections).toBe(2);
        await transport.stop();
    });

    it("acceptSocket 复用外部连接，stop 只解绑非 owned socket", async () => {
        const host = await websocketHost(() => undefined);
        const socket = new WebSocket(host.url);
        await new Promise<void>((resolve, reject) => {
            socket.once("open", resolve);
            socket.once("error", reject);
        });
        const transport = new TwitchEventSubTransport(config(host.url));
        await transport.acceptSocket(socket, { owned: false, welcome: welcome("external1") });
        await transport.stop();

        expect(socket.readyState).toBe(WebSocket.OPEN);
        socket.close(1000, "test complete");
    });
});

async function websocketHost(
    onConnection: (socket: WebSocket, url: string) => void,
): Promise<{ url: string }> {
    const server = createServer();
    const websocket = new WebSocketServer({ server });
    websocket.on("connection", (socket, request) => onConnection(socket, request.url || ""));
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test address");
    cleanups.push(
        () =>
            new Promise<void>(resolve => {
                for (const client of websocket.clients) client.terminate();
                websocket.close(() => server.close(() => resolve()));
            }),
    );
    return { url: `ws://127.0.0.1:${address.port}/ws` };
}

function config(url: string): TwitchConfig {
    return {
        account_id: "account",
        client_id: "client",
        access_token: "token",
        broadcaster_user_id: "100",
        receive_mode: "websocket",
        eventsub_websocket_url: url,
        connect_timeout_ms: 1_000,
        reconnect_initial_delay_ms: 10,
        reconnect_max_delay_ms: 20,
    };
}

function welcome(id: string): TwitchEventSubMessage {
    return sessionMessage("session_welcome", id, null);
}

function reconnect(id: string, url: string): TwitchEventSubMessage {
    return sessionMessage("session_reconnect", id, url);
}

function notification(id: string): TwitchEventSubMessage {
    return {
        metadata: {
            message_id: id,
            message_type: "notification",
            message_timestamp: "2026-09-02T10:00:00Z",
        },
        payload: {
            subscription: {
                id: "subscription1",
                status: "enabled",
                type: "channel.chat.message",
                version: "1",
                cost: 0,
                condition: { broadcaster_user_id: "100", user_id: "200" },
                transport: { method: "websocket" },
                created_at: "2026-09-02T10:00:00Z",
            },
            event: { message_id: "message1" },
        },
    };
}

function watchdog(transport: TwitchEventSubTransport): NodeJS.Timeout | undefined {
    return (transport as unknown as { watchdog?: NodeJS.Timeout }).watchdog;
}

function sessionMessage(
    type: "session_welcome" | "session_reconnect",
    id: string,
    reconnectUrl: string | null,
): TwitchEventSubMessage {
    return {
        metadata: {
            message_id: `${type}:${id}`,
            message_type: type,
            message_timestamp: "2026-09-02T10:00:00Z",
        },
        payload: {
            session: {
                id,
                status: "connected",
                connected_at: "2026-09-02T10:00:00Z",
                keepalive_timeout_seconds: 30,
                reconnect_url: reconnectUrl,
            },
        },
    };
}
