import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { ReverseWebSocketSession } from "./reverse-websocket.js";

class FakeSocket extends EventEmitter {
    readyState: number = WebSocket.CONNECTING;
    readonly send = vi.fn();
    readonly close = vi.fn(() => {
        this.readyState = WebSocket.CLOSED;
    });
}

afterEach(() => vi.useRealTimers());

describe("ReverseWebSocketSession", () => {
    it("close 后无限重连，stop 后释放连接且不再恢复", () => {
        vi.useFakeTimers();
        const sockets: FakeSocket[] = [];
        const session = new ReverseWebSocketSession({
            url: "wss://example.com/events",
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
            reconnectDelayMs: 100,
            onMessage: vi.fn(),
            createSocket: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket as never;
            },
        });

        session.start();
        expect(sockets).toHaveLength(1);
        sockets[0].emit("close");
        vi.advanceTimersByTime(100);
        expect(sockets).toHaveLength(2);

        session.stop();
        expect(sockets[1].close).toHaveBeenCalledWith(1000, "OneBots stopped");
        vi.advanceTimersByTime(1_000);
        expect(sockets).toHaveLength(2);
    });

    it("忽略被替换连接上的迟到消息", async () => {
        vi.useFakeTimers();
        const sockets: FakeSocket[] = [];
        const onMessage = vi.fn();
        const session = new ReverseWebSocketSession({
            url: "wss://example.com/events",
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
            reconnectDelayMs: 100,
            onMessage,
            createSocket: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket as never;
            },
        });

        session.start();
        sockets[0].emit("close");
        vi.advanceTimersByTime(100);
        sockets[0].emit("message", Buffer.from("stale"));
        sockets[1].emit("message", Buffer.from("current"));
        await Promise.resolve();

        expect(onMessage).toHaveBeenCalledOnce();
        expect(onMessage).toHaveBeenCalledWith(Buffer.from("current"));
    });

    it("只在已连接时发送事件", () => {
        const socket = new FakeSocket();
        const session = new ReverseWebSocketSession({
            url: "wss://example.com/events",
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
            onMessage: vi.fn(),
            createSocket: () => socket as never,
        });
        session.start();
        session.send("before-open");
        socket.readyState = WebSocket.OPEN;
        session.send("after-open");
        expect(socket.send).toHaveBeenCalledOnce();
        expect(socket.send).toHaveBeenCalledWith("after-open");
    });
});
