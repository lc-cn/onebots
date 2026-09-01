import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
    BoundedWebSocketMessageQueue,
    MANAGEMENT_WEBSOCKET_MAX_BUFFERED_BYTES,
    TERMINAL_WEBSOCKET_MAX_PAYLOAD_BYTES,
    sendBoundedWebSocketJson,
    sendManagementWebSocketJson,
    sendTerminalWebSocketJson,
} from "./management-websocket.js";

interface MockWebSocketState {
    socket: WebSocket;
    sent: string[];
    closes: Array<{ code: number; reason: string }>;
}

function createMockWebSocket(
    options: {
        readyState?: number;
        bufferedAmount?: number;
        sendError?: Error;
        sendThrows?: Error;
    } = {},
): MockWebSocketState {
    const sent: string[] = [];
    const closes: Array<{ code: number; reason: string }> = [];
    const socket = {
        readyState: options.readyState ?? WebSocket.OPEN,
        bufferedAmount: options.bufferedAmount ?? 0,
        send(data: string, callback: (error?: Error) => void) {
            if (options.sendThrows) throw options.sendThrows;
            sent.push(data);
            callback(options.sendError);
        },
        close(code: number, reason: string) {
            closes.push({ code, reason });
        },
    } as unknown as WebSocket;
    return { socket, sent, closes };
}

describe("bounded management WebSocket sender", () => {
    it("按 UTF-8 字节限制消息并在入队前以 1009 关闭", () => {
        const state = createMockWebSocket();

        const result = sendBoundedWebSocketJson(state.socket, "界", {
            maxMessageBytes: 4,
            maxBufferedBytes: 10,
        });

        expect(result).toEqual({ status: "message-too-large", bytes: 5 });
        expect(state.sent).toEqual([]);
        expect(state.closes).toEqual([{ code: 1009, reason: "Outbound message too large" }]);
    });

    it("计算当前缓冲与本次消息，并在越界前以 1013 淘汰慢客户端", () => {
        const accepted = createMockWebSocket({ bufferedAmount: 6 });
        const rejected = createMockWebSocket({ bufferedAmount: 7 });

        expect(
            sendBoundedWebSocketJson(accepted.socket, "ok", {
                maxMessageBytes: 10,
                maxBufferedBytes: 10,
            }),
        ).toEqual({ status: "sent", bytes: 4 });
        expect(accepted.sent).toEqual(['"ok"']);

        expect(
            sendBoundedWebSocketJson(rejected.socket, "ok", {
                maxMessageBytes: 10,
                maxBufferedBytes: 10,
            }),
        ).toEqual({ status: "backpressure", bytes: 4, bufferedBytes: 7 });
        expect(rejected.sent).toEqual([]);
        expect(rejected.closes).toEqual([{ code: 1013, reason: "Outbound buffer limit reached" }]);
    });

    it("不向非 OPEN 连接序列化或发送消息", () => {
        const state = createMockWebSocket({ readyState: WebSocket.CLOSING });

        expect(
            sendBoundedWebSocketJson(state.socket, 1n, {
                maxMessageBytes: 10,
                maxBufferedBytes: 10,
            }),
        ).toEqual({ status: "not-open" });
        expect(state.sent).toEqual([]);
        expect(state.closes).toEqual([]);
    });

    it("保留序列化失败与异步发送失败证据", () => {
        const serialization = createMockWebSocket();
        const sendError = new Error("write failed");
        const failedSend = createMockWebSocket({ sendError });
        const onSendError = vi.fn();

        const serializationResult = sendBoundedWebSocketJson(serialization.socket, 1n, {
            maxMessageBytes: 10,
            maxBufferedBytes: 10,
        });
        expect(serializationResult.status).toBe("serialization-failed");
        expect(serialization.sent).toEqual([]);

        expect(
            sendBoundedWebSocketJson(
                failedSend.socket,
                { ok: true },
                {
                    maxMessageBytes: 100,
                    maxBufferedBytes: 100,
                    onSendError,
                },
            ),
        ).toEqual({ status: "sent", bytes: 11 });
        expect(onSendError).toHaveBeenCalledWith(sendError);
    });

    it("保留检查状态后发生的同步发送失败", () => {
        const sendError = new Error("socket changed state");
        const state = createMockWebSocket({ sendThrows: sendError });

        expect(
            sendBoundedWebSocketJson(
                state.socket,
                { ok: true },
                {
                    maxMessageBytes: 100,
                    maxBufferedBytes: 100,
                },
            ),
        ).toEqual({ status: "send-failed", error: sendError });
        expect(state.sent).toEqual([]);
    });

    it("管理连接与终端包装器应用各自的生产边界", () => {
        const management = createMockWebSocket({
            bufferedAmount: MANAGEMENT_WEBSOCKET_MAX_BUFFERED_BYTES,
        });
        const terminal = createMockWebSocket();

        expect(sendManagementWebSocketJson(management.socket, null).status).toBe("backpressure");
        expect(management.closes[0]?.code).toBe(1013);

        const oversizedTerminalPayload = "x".repeat(TERMINAL_WEBSOCKET_MAX_PAYLOAD_BYTES);
        expect(sendTerminalWebSocketJson(terminal.socket, oversizedTerminalPayload).status).toBe(
            "message-too-large",
        );
        expect(terminal.closes[0]?.code).toBe(1009);
    });
});

describe("bounded management WebSocket message queue", () => {
    it("在显式 start 前保留消息，并始终按到达顺序串行处理", async () => {
        const firstRelease = Promise.withResolvers<void>();
        const secondRelease = Promise.withResolvers<void>();
        const order: string[] = [];
        const queue = new BoundedWebSocketMessageQueue(
            async content => {
                order.push(`start:${content}`);
                if (content === "first") await firstRelease.promise;
                if (content === "second") await secondRelease.promise;
                order.push(`end:${content}`);
            },
            {
                maxPendingMessages: 3,
                maxPendingBytes: 100,
                onOverflow: vi.fn(),
                onError: vi.fn(),
            },
        );

        expect(queue.enqueue(Buffer.from("first"))).toBe(true);
        expect(queue.enqueue(Buffer.from("second"))).toBe(true);
        await Promise.resolve();
        expect(order).toEqual([]);

        queue.start();
        await vi.waitFor(() => expect(order).toEqual(["start:first"]));
        firstRelease.resolve();
        await vi.waitFor(() => expect(order).toEqual(["start:first", "end:first", "start:second"]));
        secondRelease.resolve();
        await vi.waitFor(() => expect(queue.pendingMessages).toBe(0));
        expect(order).toEqual(["start:first", "end:first", "start:second", "end:second"]);
        expect(queue.pendingBytes).toBe(0);
    });

    it("消息数越界时清空尚未处理的队列并只报告一次完整证据", () => {
        const onOverflow = vi.fn();
        const processMessage = vi.fn(async () => undefined);
        const queue = new BoundedWebSocketMessageQueue(processMessage, {
            maxPendingMessages: 2,
            maxPendingBytes: 100,
            onOverflow,
            onError: vi.fn(),
        });

        expect(queue.enqueue(Buffer.from("a"))).toBe(true);
        expect(queue.enqueue(Buffer.from("bb"))).toBe(true);
        expect(queue.enqueue(Buffer.from("ccc"))).toBe(false);
        expect(onOverflow).toHaveBeenCalledOnce();
        expect(onOverflow).toHaveBeenCalledWith({
            pendingMessages: 2,
            pendingBytes: 3,
            incomingBytes: 3,
            maxPendingMessages: 2,
            maxPendingBytes: 100,
        });
        expect(queue.pendingMessages).toBe(0);
        expect(queue.pendingBytes).toBe(0);
        queue.start();
        expect(processMessage).not.toHaveBeenCalled();
        expect(queue.enqueue(Buffer.from("later"))).toBe(false);
    });

    it("按原始 UTF-8 字节累计 Buffer 分片并拒绝总字节越界", () => {
        const onOverflow = vi.fn();
        const queue = new BoundedWebSocketMessageQueue(async () => undefined, {
            maxPendingMessages: 10,
            maxPendingBytes: 5,
            onOverflow,
            onError: vi.fn(),
        });

        expect(queue.enqueue([Buffer.from("a"), Buffer.from("界")])).toBe(true);
        expect(queue.pendingBytes).toBe(4);
        expect(queue.enqueue(Buffer.from("界"))).toBe(false);
        expect(onOverflow.mock.calls[0]?.[0]).toMatchObject({
            pendingBytes: 4,
            incomingBytes: 3,
            maxPendingBytes: 5,
        });
    });

    it("处理失败时释放等待消息、停止队列并交付错误", async () => {
        const processingError = new Error("action failed");
        const errorDelivered = Promise.withResolvers<void>();
        const onError = vi.fn(() => errorDelivered.resolve());
        const processed: string[] = [];
        const queue = new BoundedWebSocketMessageQueue(
            async content => {
                processed.push(content);
                throw processingError;
            },
            {
                maxPendingMessages: 3,
                maxPendingBytes: 100,
                onOverflow: vi.fn(),
                onError,
            },
        );

        queue.enqueue(Buffer.from("first"));
        queue.enqueue(Buffer.from("second"));
        queue.start();
        await errorDelivered.promise;
        await vi.waitFor(() => expect(queue.pendingMessages).toBe(0));

        expect(processed).toEqual(["first"]);
        expect(onError).toHaveBeenCalledWith(processingError);
        expect(queue.enqueue(Buffer.from("later"))).toBe(false);
    });

    it("dispose 会释放暂停状态下的全部消息", () => {
        const processMessage = vi.fn(async () => undefined);
        const queue = new BoundedWebSocketMessageQueue(processMessage, {
            maxPendingMessages: 2,
            maxPendingBytes: 100,
            onOverflow: vi.fn(),
            onError: vi.fn(),
        });
        queue.enqueue(Buffer.from("queued"));

        queue.dispose();
        queue.start();

        expect(queue.pendingMessages).toBe(0);
        expect(queue.pendingBytes).toBe(0);
        expect(processMessage).not.toHaveBeenCalled();
    });
});
