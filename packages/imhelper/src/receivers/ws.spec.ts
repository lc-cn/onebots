import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Adapter } from "../adapter.js";
import { WebSocketReceiver, type WebSocketLike } from "./ws.js";

class TestAdapter extends Adapter<string, { value: number }> {
    readonly selfId = "bot";
    readonly events: Array<{ value: number }> = [];

    transformEvent(event: { value: number }): void {
        this.events.push(event);
    }
}

class FakeSocket extends EventEmitter implements WebSocketLike {
    readonly close = vi.fn(() => this.emit("close", 1000, Buffer.alloc(0)));
    readonly send = vi.fn();
}

afterEach(() => {
    vi.useRealTimers();
});

describe("WebSocketReceiver recovery", () => {
    test("runs the protocol handshake callback for every opened connection", async () => {
        const socket = new FakeSocket();
        const onOpen = vi.fn(current => current.send("identify"));
        const receiver = new WebSocketReceiver(new TestAdapter(), "ws://example.test/events", {
            createWebSocket: () => socket,
            onOpen,
        });

        const connected = receiver.connect();
        socket.emit("open");
        await connected;

        expect(onOpen).toHaveBeenCalledWith(socket);
        expect(socket.send).toHaveBeenCalledWith("identify");
    });

    test("reconnects indefinitely with configurable backoff", async () => {
        vi.useFakeTimers();
        const adapter = new TestAdapter();
        const sockets: FakeSocket[] = [];
        const createWebSocket = vi.fn(() => {
            const socket = new FakeSocket();
            sockets.push(socket);
            return socket;
        });
        const receiver = new WebSocketReceiver(adapter, "ws://example.test/events", {
            createWebSocket,
            reconnect: { initialDelayMs: 1, maxDelayMs: 1, factor: 1 },
        });

        const connected = receiver.connect();
        sockets[0].emit("open");
        await connected;
        for (let attempt = 0; attempt < 12; attempt += 1) {
            sockets[attempt].emit("close", 1006, Buffer.alloc(0));
            await vi.advanceTimersByTimeAsync(1);
            sockets[attempt + 1].emit("open");
        }

        expect(createWebSocket).toHaveBeenCalledTimes(13);
    });

    test("AbortSignal cancels reconnect and closes the active generation", async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const sockets: FakeSocket[] = [];
        const receiver = new WebSocketReceiver(new TestAdapter(), "ws://example.test/events", {
            signal: controller.signal,
            createWebSocket: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket;
            },
            reconnect: { initialDelayMs: 1 },
        });
        const connected = receiver.connect();
        sockets[0].emit("open");
        await connected;
        sockets[0].emit("close", 1006, Buffer.alloc(0));

        controller.abort();
        await vi.advanceTimersByTimeAsync(10);

        expect(sockets).toHaveLength(1);
        expect(sockets[0].close).toHaveBeenCalled();
    });

    test("AbortSignal rejects a connection that has not opened yet", async () => {
        const controller = new AbortController();
        const socket = new FakeSocket();
        const receiver = new WebSocketReceiver(new TestAdapter(), "ws://example.test/events", {
            signal: controller.signal,
            createWebSocket: () => socket,
        });
        const connected = receiver.connect();

        controller.abort();

        await expect(connected).rejects.toMatchObject({ name: "AbortError" });
        expect(socket.close).toHaveBeenCalled();
    });

    test("rejects an initial socket that closes before opening and keeps reconnecting", async () => {
        vi.useFakeTimers();
        const sockets: FakeSocket[] = [];
        const receiver = new WebSocketReceiver(new TestAdapter(), "ws://example.test/events", {
            createWebSocket: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket;
            },
            reconnect: { initialDelayMs: 1, maxDelayMs: 1 },
        });
        const connected = receiver.connect();

        sockets[0].emit("close", 1006, Buffer.alloc(0));

        await expect(connected).rejects.toThrow("建立连接前关闭");
        await vi.advanceTimersByTimeAsync(1);
        expect(sockets).toHaveLength(2);
    });

    test("ignores close events from an obsolete connection generation", async () => {
        vi.useFakeTimers();
        const sockets: FakeSocket[] = [];
        const receiver = new WebSocketReceiver(new TestAdapter(), "ws://example.test/events", {
            createWebSocket: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket;
            },
            reconnect: { initialDelayMs: 1, maxDelayMs: 1 },
        });
        const connected = receiver.connect();
        sockets[0].emit("open");
        await connected;
        sockets[0].emit("close", 1006, Buffer.alloc(0));
        await vi.advanceTimersByTimeAsync(1);
        sockets[1].emit("open");

        sockets[0].emit("close", 1006, Buffer.alloc(0));
        await vi.advanceTimersByTimeAsync(10);

        expect(sockets).toHaveLength(2);
    });

    test("resets a finite retry budget for each explicit lifecycle", async () => {
        vi.useFakeTimers();
        const sockets: FakeSocket[] = [];
        const receiver = new WebSocketReceiver(new TestAdapter(), "ws://example.test/events", {
            createWebSocket: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket;
            },
            reconnect: { maxAttempts: 1, initialDelayMs: 1 },
        });

        const firstConnection = receiver.connect();
        sockets[0].emit("open");
        await firstConnection;
        sockets[0].emit("close", 1006, Buffer.alloc(0));
        await receiver.disconnect();

        const secondConnection = receiver.connect();
        sockets[1].emit("open");
        await secondConnection;
        sockets[1].emit("close", 1006, Buffer.alloc(0));
        await vi.advanceTimersByTimeAsync(1);

        expect(sockets).toHaveLength(3);
    });

    test("redacts the access token from logger context", async () => {
        const socket = new FakeSocket();
        const debug = vi.fn();
        const receiver = new WebSocketReceiver(new TestAdapter(), "ws://example.test/events", {
            accessToken: "top-secret",
            createWebSocket: () => socket,
            logger: { debug, error: vi.fn() },
        });
        const connected = receiver.connect();
        socket.emit("open");
        await connected;

        expect(debug).toHaveBeenCalledWith(
            "正在连接 WebSocket",
            expect.objectContaining({ url: "ws://example.test/events?access_token=***" }),
        );
        expect(JSON.stringify(debug.mock.calls)).not.toContain("top-secret");
    });
});
