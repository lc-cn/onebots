import { ErrorCategory } from "onebots";
import { HeychatApiError } from "./errors.js";
import type { HeychatWsEnvelope } from "./types.js";

const MAX_EVENT_BYTES = 1024 * 1024;

export interface HeychatIngestResult {
    event: HeychatWsEnvelope;
    duplicate: boolean;
}

/**
 * 连接无关的 Heychat 事件入口。每次连接代次应调用 reset()，因为官方 sequence 不跨连接续传。
 */
export class HeychatEventIngress {
    private lastSequence: number | null = null;

    reset(): void {
        this.lastSequence = null;
    }

    ingest(rawEvent: unknown): HeychatIngestResult {
        const event = decodeHeychatEnvelope(rawEvent);
        const duplicate = this.lastSequence !== null && event.sequence <= this.lastSequence;
        if (!duplicate) this.lastSequence = event.sequence;
        return { event, duplicate };
    }
}

/** 解码结构化事件或 WebSocket 文本帧，并在进入投影层前闭合协议边界。 */
export function decodeHeychatEnvelope(rawEvent: unknown): HeychatWsEnvelope {
    let value = rawEvent;
    if (isBinaryPayload(rawEvent) || typeof rawEvent === "string") {
        const payload = toBuffer(rawEvent);
        if (payload.byteLength > MAX_EVENT_BYTES) {
            throw protocolError(
                "WebSocket 推送超过 1 MiB 上限",
                "HEYCHAT_EVENT_TOO_LARGE",
                payload.byteLength,
            );
        }
        const text = payload.toString("utf8");
        if (isHeychatControlPayload(text)) {
            throw protocolError("WebSocket pong 不是业务事件", "HEYCHAT_CONTROL_FRAME");
        }
        try {
            value = JSON.parse(text) as unknown;
        } catch (error) {
            throw new HeychatApiError("WebSocket 推送不是有效 JSON", {
                code: "HEYCHAT_INVALID_WS_EVENT",
                category: ErrorCategory.PROTOCOL,
                details: text.slice(0, 500),
                cause: error,
            });
        }
    }
    if (!isHeychatEnvelope(value)) {
        throw protocolError("WebSocket 推送结构无效", "HEYCHAT_INVALID_WS_EVENT", value);
    }
    return value;
}

/** Heychat 可能使用文本 pong；连接层应消费它，不进入业务事件管线。 */
export function isHeychatControlPayload(value: unknown): boolean {
    if (!(typeof value === "string" || isBinaryPayload(value))) return false;
    const text = toBuffer(value).toString("utf8");
    return /^pong$/iu.test(text.trim()) || text.startsWith("PONG");
}

export function isHeychatEnvelope(value: unknown): value is HeychatWsEnvelope {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (
        Number.isSafeInteger(record.sequence) &&
        (record.sequence as number) >= 0 &&
        typeof record.type === "string" &&
        record.type.length > 0 &&
        typeof record.timestamp === "number" &&
        Number.isFinite(record.timestamp) &&
        Boolean(record.data) &&
        typeof record.data === "object" &&
        !Array.isArray(record.data)
    );
}

function isBinaryPayload(
    value: unknown,
): value is Buffer | ArrayBuffer | ArrayBufferView | Buffer[] {
    return (
        Buffer.isBuffer(value) ||
        value instanceof ArrayBuffer ||
        ArrayBuffer.isView(value) ||
        (Array.isArray(value) && value.every(item => Buffer.isBuffer(item)))
    );
}

function toBuffer(value: string | Buffer | ArrayBuffer | ArrayBufferView | Buffer[]): Buffer {
    if (typeof value === "string") return Buffer.from(value);
    if (Buffer.isBuffer(value)) return value;
    if (Array.isArray(value)) return Buffer.concat(value);
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function protocolError(message: string, code: string, details?: unknown): HeychatApiError {
    return new HeychatApiError(message, {
        code,
        category: ErrorCategory.PROTOCOL,
        details,
    });
}
