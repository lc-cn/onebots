import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
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
