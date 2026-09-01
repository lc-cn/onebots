import { WebSocket, type RawData } from "ws";
import type { Router } from "@onebots/core";

/** 管理端主连接允许配置同步等较大 JSON 消息，但仍限制单条入站载荷。 */
export const MANAGEMENT_WEBSOCKET_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

/** 限制初始快照、队列和广播的聚合资源占用。 */
export const MANAGEMENT_WEBSOCKET_MAX_CONNECTIONS = 32;

/** 主连接最多保留两条最大消息的待发送数据，慢客户端不会无限积压。 */
export const MANAGEMENT_WEBSOCKET_MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

/** 单个管理连接最多保留的待处理动作数。 */
export const MANAGEMENT_WEBSOCKET_MAX_PENDING_MESSAGES = 64;

/** 待处理动作按原始入站字节累计，避免多个合法小消息绕过单消息上限。 */
export const MANAGEMENT_WEBSOCKET_MAX_PENDING_BYTES = 8 * 1024 * 1024;

/** 终端输入只需要较小消息，避免单个连接占用过多内存。 */
export const TERMINAL_WEBSOCKET_MAX_PAYLOAD_BYTES = 1024 * 1024;

/** 单个 PTY 只允许少量管理页面同时订阅输出。 */
export const TERMINAL_WEBSOCKET_MAX_CONNECTIONS = 8;

/** 终端输出允许短时积压两条最大消息，超过后要求客户端重连。 */
export const TERMINAL_WEBSOCKET_MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

/** 仅把固定管理语义映射为公开指标标签，不暴露 Router 中的任意扩展路径。 */
export function getPublishedManagementWebSocketCapacity(router: Pick<Router, "getWsRouteStats">) {
    return (
        [
            ["management", "/"],
            ["terminal", "/api/terminal"],
        ] as const
    ).flatMap(([name, path]) => {
        const stats = router.getWsRouteStats(path);
        return stats ? [{ name, ...stats }] : [];
    });
}

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

export interface BoundedWebSocketMessageQueueOverflow {
    pendingMessages: number;
    pendingBytes: number;
    incomingBytes: number;
    maxPendingMessages: number;
    maxPendingBytes: number;
}

export interface BoundedWebSocketMessageQueueOptions {
    maxPendingMessages: number;
    maxPendingBytes: number;
    onOverflow: (overflow: BoundedWebSocketMessageQueueOverflow) => void;
    onError: (error: unknown) => void;
}

interface PendingWebSocketMessage {
    content: string;
    bytes: number;
}

/**
 * 将 EventEmitter 风格的 WebSocket 消息闭合成有界、有序的异步处理链。
 * 队列可先接收消息，再由 `start()` 开闸，保证初始快照先于动作回执发送。
 */
export class BoundedWebSocketMessageQueue {
    private readonly messages: PendingWebSocketMessage[] = [];
    private pendingMessageCount = 0;
    private pendingByteCount = 0;
    private started = false;
    private processing = false;
    private disposed = false;

    constructor(
        private readonly processMessage: (content: string) => Promise<void>,
        private readonly options: BoundedWebSocketMessageQueueOptions,
    ) {
        if (!Number.isSafeInteger(options.maxPendingMessages) || options.maxPendingMessages <= 0) {
            throw new RangeError("WebSocket maxPendingMessages 必须是正安全整数");
        }
        if (!Number.isSafeInteger(options.maxPendingBytes) || options.maxPendingBytes <= 0) {
            throw new RangeError("WebSocket maxPendingBytes 必须是正安全整数");
        }
    }

    get pendingMessages(): number {
        return this.pendingMessageCount;
    }

    get pendingBytes(): number {
        return this.pendingByteCount;
    }

    enqueue(raw: RawData): boolean {
        if (this.disposed) return false;
        const bytes = rawDataByteLength(raw);
        if (
            this.pendingMessageCount + 1 > this.options.maxPendingMessages ||
            this.pendingByteCount + bytes > this.options.maxPendingBytes
        ) {
            const overflow: BoundedWebSocketMessageQueueOverflow = {
                pendingMessages: this.pendingMessageCount,
                pendingBytes: this.pendingByteCount,
                incomingBytes: bytes,
                maxPendingMessages: this.options.maxPendingMessages,
                maxPendingBytes: this.options.maxPendingBytes,
            };
            this.dispose();
            this.options.onOverflow(overflow);
            return false;
        }

        this.messages.push({ content: rawDataToString(raw, bytes), bytes });
        this.pendingMessageCount++;
        this.pendingByteCount += bytes;
        if (this.started) void this.drain();
        return true;
    }

    start(): void {
        if (this.disposed || this.started) return;
        this.started = true;
        void this.drain();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const message of this.messages) {
            this.pendingMessageCount--;
            this.pendingByteCount -= message.bytes;
        }
        this.messages.length = 0;
    }

    private async drain(): Promise<void> {
        if (!this.started || this.processing || this.disposed) return;
        this.processing = true;
        try {
            while (!this.disposed) {
                const message = this.messages.shift();
                if (!message) break;
                try {
                    await this.processMessage(message.content);
                } catch (error) {
                    this.dispose();
                    this.options.onError(error);
                } finally {
                    this.pendingMessageCount--;
                    this.pendingByteCount -= message.bytes;
                }
            }
        } finally {
            this.processing = false;
            if (!this.disposed && this.messages.length > 0) void this.drain();
        }
    }
}

function rawDataByteLength(raw: RawData): number {
    if (Array.isArray(raw)) return raw.reduce((total, part) => total + part.byteLength, 0);
    return raw.byteLength;
}

function rawDataToString(raw: RawData, bytes: number): string {
    if (Array.isArray(raw)) return Buffer.concat(raw, bytes).toString("utf8");
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
    return raw.toString("utf8");
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
