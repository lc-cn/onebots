import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { MattermostConfig } from "./types.js";
import { MattermostWebSocketTransport } from "./websocket.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
});

describe("MattermostWebSocketTransport", () => {
    it("使用 authentication_challenge，关联 action 响应，并让 AbortSignal 关闭连接", async () => {
        const actions: Array<Record<string, unknown>> = [];
        let serverSocket: WebSocket | undefined;
        const host = await websocketHost((socket, _url) => {
            serverSocket = socket;
            socket.on("message", data => {
                const action = JSON.parse(data.toString()) as Record<string, unknown>;
                actions.push(action);
                const seq = Number(action.seq);
                socket.send(
                    JSON.stringify({ status: "OK", seq_reply: seq, data: { accepted: true } }),
                );
                if (action.action === "authentication_challenge") {
                    socket.send(
                        JSON.stringify(event("hello", 0, { connection_id: "connection1" })),
                    );
                }
            });
        });
        const transport = new MattermostWebSocketTransport(config(host.origin));
        const controller = new AbortController();
        await transport.start(controller.signal);

        expect(actions[0]).toEqual({
            seq: 1,
            action: "authentication_challenge",
            data: { token: "token" },
        });
        await expect(transport.sendAction("get_statuses")).resolves.toMatchObject({
            status: "OK",
            data: { accepted: true },
        });
        expect(actions[1]).toMatchObject({ action: "get_statuses", seq: 2 });

        controller.abort(new Error("shutdown"));
        await vi.waitFor(() => expect(serverSocket?.readyState).toBe(WebSocket.CLOSED));
        expect(transport.connected).toBe(false);
    });

    it("断线后无限恢复，并携带官方 reliable WebSocket 续接参数", async () => {
        const urls: string[] = [];
        let connections = 0;
        const secondHello = Promise.withResolvers<void>();
        const host = await websocketHost((socket, url) => {
            urls.push(url);
            connections += 1;
            const current = connections;
            socket.on("message", data => {
                const action = JSON.parse(data.toString()) as { seq: number };
                socket.send(JSON.stringify({ status: "OK", seq_reply: action.seq, data: {} }));
                socket.send(
                    JSON.stringify(
                        event("hello", current === 1 ? 0 : 2, { connection_id: "connection1" }),
                    ),
                );
                if (current === 1) {
                    socket.send(JSON.stringify(event("status_change", 1, { user_id: "user1" })));
                    setTimeout(() => socket.close(1012, "restart"), 5);
                } else {
                    secondHello.resolve();
                }
            });
        });
        const transport = new MattermostWebSocketTransport(
            config(host.origin, { reconnect_initial_delay_ms: 10, reconnect_max_delay_ms: 20 }),
        );
        const missed = vi.fn();
        transport.on("missed", missed);
        await transport.start();
        await secondHello.promise;

        expect(connections).toBe(2);
        const reconnectUrl = new URL(urls[1], host.origin);
        expect(reconnectUrl.pathname).toBe("/api/v4/websocket");
        expect(reconnectUrl.searchParams.get("connection_id")).toBe("connection1");
        expect(reconnectUrl.searchParams.get("sequence_number")).toBe("1");
        expect(missed).not.toHaveBeenCalled();
        await transport.stop();
    });

    it("acceptSocket 复用外部连接，stop 只解绑不关闭非 owned socket", async () => {
        const host = await websocketHost(socket => {
            socket.send(JSON.stringify(event("hello", 0, { connection_id: "external1" })));
        });
        const socket = new WebSocket(`${host.origin.replace("http", "ws")}/api/v4/websocket`);
        const transport = new MattermostWebSocketTransport(config(host.origin));
        await transport.acceptSocket(socket, { authenticate: false, owned: false });
        await transport.stop();

        expect(socket.readyState).toBe(WebSocket.OPEN);
        socket.close(1000, "test complete");
    });
});

async function websocketHost(
    onConnection: (socket: WebSocket, url: string) => void,
): Promise<{ origin: string }> {
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
    return { origin: `http://127.0.0.1:${address.port}` };
}

function config(serverUrl: string, overrides: Partial<MattermostConfig> = {}): MattermostConfig {
    return {
        account_id: "account",
        server_url: serverUrl,
        access_token: "token",
        receive_mode: "websocket",
        connect_timeout_ms: 1_000,
        ...overrides,
    };
}

function event(eventType: string, seq: number, data: Record<string, unknown>) {
    return { event: eventType, data, broadcast: {}, seq };
}
