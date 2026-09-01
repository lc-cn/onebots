import { afterEach, describe, expect, it, vi } from "vitest";
import {
    TerminalWebSocketConnection,
    shouldReconnectTerminalWebSocket,
    type TerminalWebSocketLike,
} from "./terminal-websocket-connection.js";

afterEach(() => {
    vi.useRealTimers();
});

describe("TerminalWebSocketConnection", () => {
    it("manual reconnect detaches the old socket without scheduling another connection", () => {
        vi.useFakeTimers();
        const sockets: FakeSocket[] = [];
        const connection = createConnection(sockets);

        connection.connect();
        const first = sockets[0];
        connection.connect();

        expect(first.close).toHaveBeenCalledOnce();
        expect(first.onclose).toBeNull();
        expect(sockets).toHaveLength(2);
        vi.advanceTimersByTime(6000);
        expect(sockets).toHaveLength(2);
    });

    it("server close schedules exactly one replacement connection", () => {
        vi.useFakeTimers();
        const sockets: FakeSocket[] = [];
        const onClose = vi.fn();
        const connection = createConnection(sockets, { onClose });

        connection.connect();
        sockets[0].serverClose();
        vi.advanceTimersByTime(2999);
        expect(sockets).toHaveLength(1);
        vi.advanceTimersByTime(1);

        expect(onClose).toHaveBeenCalledOnce();
        expect(sockets).toHaveLength(2);
    });

    it("does not retry a policy close caused by invalid management credentials", () => {
        vi.useFakeTimers();
        const sockets: FakeSocket[] = [];
        const connection = createConnection(sockets, {
            shouldReconnect: shouldReconnectTerminalWebSocket,
        });

        connection.connect();
        sockets[0].serverClose(1008);
        vi.advanceTimersByTime(6000);

        expect(sockets).toHaveLength(1);
    });

    it("keeps retrying transient and normal terminal-exit closures", () => {
        expect(shouldReconnectTerminalWebSocket({ code: 1000 })).toBe(true);
        expect(shouldReconnectTerminalWebSocket({ code: 1006 })).toBe(true);
        expect(shouldReconnectTerminalWebSocket({ code: 1013 })).toBe(true);
    });

    it("dispose cancels a reconnect already scheduled by server close", () => {
        vi.useFakeTimers();
        const sockets: FakeSocket[] = [];
        const connection = createConnection(sockets);

        connection.connect();
        const socket = sockets[0];
        socket.serverClose();
        connection.dispose();
        vi.advanceTimersByTime(6000);

        expect(sockets).toHaveLength(1);
    });

    it("dispose closes an active socket and ignores its late events", () => {
        const sockets: FakeSocket[] = [];
        const onMessage = vi.fn();
        const connection = createConnection(sockets, { onMessage });

        connection.connect();
        const socket = sockets[0];
        const lateMessage = socket.onmessage;
        connection.dispose();
        lateMessage?.({ data: "late" } as MessageEvent);

        expect(socket.close).toHaveBeenCalledOnce();
        expect(onMessage).not.toHaveBeenCalled();
    });

    it("disconnect closes the socket without scheduling retry and still permits manual reconnect", () => {
        vi.useFakeTimers();
        const sockets: FakeSocket[] = [];
        const connection = createConnection(sockets);
        connection.connect();

        connection.disconnect();
        vi.advanceTimersByTime(6000);

        expect(sockets[0].close).toHaveBeenCalledOnce();
        expect(sockets).toHaveLength(1);
        connection.connect();
        expect(sockets).toHaveLength(2);
    });

    it("sends only through the current open socket", () => {
        const sockets: FakeSocket[] = [];
        const connection = createConnection(sockets);
        connection.connect();

        expect(connection.sendJson({ type: "input", data: "a" })).toBe(false);
        sockets[0].readyState = 1;
        expect(connection.sendJson({ type: "input", data: "a" })).toBe(true);
        expect(sockets[0].send).toHaveBeenCalledWith('{"type":"input","data":"a"}');
    });
});

function createConnection(
    sockets: FakeSocket[],
    callbacks: ConstructorParameters<typeof TerminalWebSocketConnection>[1] = {},
): TerminalWebSocketConnection {
    return new TerminalWebSocketConnection(() => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
    }, callbacks);
}

class FakeSocket implements TerminalWebSocketLike {
    readyState = 0;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    send = vi.fn();
    close = vi.fn();

    serverClose(code = 1006): void {
        this.onclose?.({ code } as CloseEvent);
    }
}
