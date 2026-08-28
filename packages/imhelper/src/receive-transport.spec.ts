import { describe, expect, test } from "vitest";
import { Adapter } from "./adapter.js";
import { ReceiveTransport } from "./receive-transport.js";
import type { WebSocketLike } from "./receivers/ws.js";
import type { SSEConnection } from "./receivers/sse.js";

interface RawEvent {
    value: string;
}

class TestAdapter extends Adapter<string, RawEvent> {
    readonly selfId = "bot";
    events: RawEvent[] = [];

    transformEvent(event: RawEvent): void {
        this.events.push(event);
    }
}

class FakeSocket implements WebSocketLike {
    readonly listeners = new Map<string, Array<(...args: never[]) => void>>();

    on(event: string, listener: (...args: never[]) => void): unknown {
        const listeners = this.listeners.get(event) ?? [];
        listeners.push(listener);
        this.listeners.set(event, listeners);
        return this;
    }

    emit(event: string, ...args: unknown[]): void {
        for (const listener of this.listeners.get(event) ?? []) {
            listener(...(args as never[]));
        }
    }

    removeAllListeners(): unknown {
        this.listeners.clear();
        return this;
    }

    send(): unknown {
        return undefined;
    }

    close(): void {}
}

class FakeEventSource implements SSEConnection {
    readonly readyState = 1;
    onopen: ((event: Event) => unknown) | null = null;
    onmessage: ((event: MessageEvent<string>) => unknown) | null = null;
    onerror: ((event: Event) => unknown) | null = null;
    closed = false;

    close(): void {
        this.closed = true;
    }
}

describe("ReceiveTransport", () => {
    test("owns WebSocket receiver creation, ingestion and lifecycle", async () => {
        const adapter = new TestAdapter();
        const socket = new FakeSocket();
        const transport = new ReceiveTransport(adapter, {
            mode: "ws",
            endpoints: { ws: "ws://events.example/v1" },
            webSocket: { createWebSocket: () => socket },
        });

        const connected = transport.connect();
        socket.emit("open");
        await connected;
        socket.emit("message", Buffer.from('{"value":"received"}'));

        expect(adapter.events).toEqual([{ value: "received" }]);
        await transport.disconnect();
        expect(socket.listeners.size).toBe(0);
    });

    test("manual mode has a no-op lifecycle and needs no endpoint", async () => {
        const transport = new ReceiveTransport(new TestAdapter(), { mode: "manual" });
        await expect(transport.connect()).resolves.toBeUndefined();
        await expect(transport.disconnect()).resolves.toBeUndefined();
    });

    test("owns SSE dependency injection, authentication and ingestion", async () => {
        const adapter = new TestAdapter();
        const eventSource = new FakeEventSource();
        let openedUrl: URL | undefined;
        const transport = new ReceiveTransport(adapter, {
            mode: "sse",
            endpoints: { sse: "https://events.example/v1" },
            accessToken: "secret",
            sse: {
                createEventSource: url => {
                    openedUrl = url;
                    return eventSource;
                },
            },
        });

        const connected = transport.connect();
        eventSource.onopen?.(new Event("open"));
        await connected;
        eventSource.onmessage?.(new MessageEvent("message", { data: '{"value":"sse"}' }));

        expect(openedUrl?.searchParams.get("access_token")).toBe("secret");
        expect(adapter.events).toEqual([{ value: "sse" }]);
        await transport.disconnect();
        expect(eventSource.closed).toBe(true);
    });
});
