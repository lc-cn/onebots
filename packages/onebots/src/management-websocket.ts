import { WebSocket } from "ws";

/** 管理端主连接允许配置同步等较大 JSON 消息，但仍限制单条入站载荷。 */
export const MANAGEMENT_WEBSOCKET_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

/** 主连接最多保留两条最大消息的待发送数据，慢客户端不会无限积压。 */
export const MANAGEMENT_WEBSOCKET_MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

/** 终端输入只需要较小消息，避免单个连接占用过多内存。 */
export const TERMINAL_WEBSOCKET_MAX_PAYLOAD_BYTES = 1024 * 1024;

/** 终端输出允许短时积压两条最大消息，超过后要求客户端重连。 */
export const TERMINAL_WEBSOCKET_MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

export type BoundedWebSocketSendResult =
    | { status: "sent"; bytes: number }
    | { status: "not-open" }
    | { status: "message-too-large"; bytes: number }
    | { status: "backpressure"; bytes: number; bufferedBytes: number }
    | { status: "serialization-failed"; error: unknown }
    | { status: "send-failed"; error: unknown };

interface BoundedWebSocketSendOptions {
    maxMessageBytes: number;
    maxBufferedBytes: number;
    onSendError?: (error: Error) => void;
}

/**
 * 在进入 ws 的内部发送队列前闭合 JSON 序列化、单消息大小与慢客户端背压。
 * `bufferedAmount` 不含本次消息，因此判定时必须同时计算待发送字节数。
 */
export function sendBoundedWebSocketJson(
    socket: WebSocket,
    payload: unknown,
    options: BoundedWebSocketSendOptions,
): BoundedWebSocketSendResult {
    if (socket.readyState !== WebSocket.OPEN) return { status: "not-open" };

    let data: string | undefined;
    try {
        data = JSON.stringify(payload);
    } catch (error) {
        return { status: "serialization-failed", error };
    }
    if (data === undefined) {
        return {
            status: "serialization-failed",
            error: new TypeError("WebSocket JSON 消息不可序列化"),
        };
    }

    const bytes = Buffer.byteLength(data, "utf8");
    if (socket.readyState !== WebSocket.OPEN) return { status: "not-open" };
    if (bytes > options.maxMessageBytes) {
        socket.close(1009, "Outbound message too large");
        return { status: "message-too-large", bytes };
    }

    const bufferedBytes = socket.bufferedAmount;
    if (bufferedBytes + bytes > options.maxBufferedBytes) {
        socket.close(1013, "Outbound buffer limit reached");
        return { status: "backpressure", bytes, bufferedBytes };
    }

    try {
        socket.send(data, error => {
            if (error) options.onSendError?.(error);
        });
    } catch (error) {
        return { status: "send-failed", error };
    }
    return { status: "sent", bytes };
}

export function sendManagementWebSocketJson(
    socket: WebSocket,
    payload: unknown,
    onSendError?: (error: Error) => void,
): BoundedWebSocketSendResult {
    return sendBoundedWebSocketJson(socket, payload, {
        maxMessageBytes: MANAGEMENT_WEBSOCKET_MAX_PAYLOAD_BYTES,
        maxBufferedBytes: MANAGEMENT_WEBSOCKET_MAX_BUFFERED_BYTES,
        onSendError,
    });
}

export function sendTerminalWebSocketJson(
    socket: WebSocket,
    payload: unknown,
    onSendError?: (error: Error) => void,
): BoundedWebSocketSendResult {
    return sendBoundedWebSocketJson(socket, payload, {
        maxMessageBytes: TERMINAL_WEBSOCKET_MAX_PAYLOAD_BYTES,
        maxBufferedBytes: TERMINAL_WEBSOCKET_MAX_BUFFERED_BYTES,
        onSendError,
    });
}
