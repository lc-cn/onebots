import { createDecipheriv } from "node:crypto";
import { KookError } from "./errors.js";
import type {
    KookEvent,
    KookHello,
    KookInboundEvent,
    KookMessageType,
    KookSignal,
} from "./types.js";

/** 解密 KOOK Webhook 的 AES-256-CBC 载荷。 */
export function decryptWebhookMessage(encryptedData: string, encryptKey: string): string {
    if (!encryptKey) {
        throw KookError.configuration(
            "收到 KOOK 加密回调但未配置 encrypt_key",
            "KOOK_ENCRYPT_KEY_REQUIRED",
        );
    }
    const packet = Buffer.from(encryptedData, "base64");
    if (packet.length <= 16) {
        throw KookError.invalid("KOOK 加密回调长度无效", "KOOK_ENCRYPTED_PAYLOAD_INVALID");
    }
    const iv = packet.subarray(0, 16);
    const cipherText = Buffer.from(packet.subarray(16).toString("utf8"), "base64");
    const key = Buffer.alloc(32);
    Buffer.from(encryptKey, "utf8").copy(key, 0, 0, 32);
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString("utf8");
}

export function parseSignal(value: unknown): KookSignal {
    if (!isRecord(value)) {
        throw new KookError("KOOK Gateway 信令必须为对象", {
            code: "KOOK_SIGNAL_INVALID",
            details: value,
        });
    }
    const signal = value;
    if (!isSignalType(signal.s)) {
        throw new KookError("KOOK Gateway 信令类型无效", {
            code: "KOOK_SIGNAL_INVALID",
            details: { signal: signal.s },
        });
    }
    if (signal.sn !== undefined && !isSequence(signal.sn)) {
        throw KookError.invalid("KOOK Gateway 序列号无效", "KOOK_SIGNAL_SEQUENCE_INVALID", {
            sequence: signal.sn,
        });
    }
    if ((signal.s === 0 || signal.s === 1) && !isRecord(signal.d)) {
        throw KookError.invalid("KOOK Gateway 数据信令缺少对象 d", "KOOK_SIGNAL_DATA_INVALID", {
            signal: signal.s,
        });
    }
    return {
        ...signal,
        s: signal.s,
        ...(signal.d === undefined ? {} : { d: signal.d }),
        ...(signal.sn === undefined ? {} : { sn: signal.sn }),
    };
}

export function parseHello(value: unknown): KookHello {
    if (!isRecord(value)) {
        throw KookError.invalid("KOOK Gateway HELLO 数据无效", "KOOK_HELLO_INVALID", value);
    }
    const hello = value;
    const code = hello.code;
    if (!isSafeInteger(code)) {
        throw KookError.invalid("KOOK Gateway HELLO 数据无效", "KOOK_HELLO_INVALID", value);
    }
    if (hello.session_id !== undefined && typeof hello.session_id !== "string") {
        throw KookError.invalid(
            "KOOK Gateway HELLO session_id 无效",
            "KOOK_HELLO_SESSION_INVALID",
            { session_id: hello.session_id },
        );
    }
    return {
        ...hello,
        code,
        ...(typeof hello.session_id === "string" ? { session_id: hello.session_id } : {}),
    };
}

export function parseEvent(value: unknown): KookInboundEvent {
    if (!isRecord(value)) {
        throw new KookError("KOOK 事件数据必须为对象", {
            code: "KOOK_EVENT_INVALID",
            details: value,
        });
    }
    const event = value;
    if (event.channel_type === "WEBHOOK_CHALLENGE") {
        if (event.type !== 255 || typeof event.challenge !== "string" || !event.challenge) {
            throw KookError.invalid(
                "KOOK Webhook challenge 数据无效",
                "KOOK_WEBHOOK_CHALLENGE_INVALID",
                value,
            );
        }
        return {
            ...event,
            channel_type: "WEBHOOK_CHALLENGE",
            type: 255,
            challenge: event.challenge,
            ...(typeof event.verify_token === "string"
                ? { verify_token: event.verify_token }
                : {}),
        };
    }
    if (!isChannelType(event.channel_type) || !isEventType(event.type)) {
        throw KookError.invalid(
            "KOOK 事件 channel_type 或 type 无效",
            "KOOK_EVENT_KIND_INVALID",
            { channel_type: event.channel_type, type: event.type },
        );
    }
    const targetId = requiredString(event.target_id, "target_id");
    const authorId = requiredString(event.author_id, "author_id");
    const messageId = requiredString(event.msg_id, "msg_id");
    if (event.content === undefined) {
        throw KookError.invalid("KOOK 事件 content 缺失", "KOOK_EVENT_FIELD_INVALID", {
            field: "content",
        });
    }
    if (!isTimestamp(event.msg_timestamp)) {
        throw KookError.invalid(
            "KOOK 事件 msg_timestamp 无效",
            "KOOK_EVENT_TIMESTAMP_INVALID",
            { msg_timestamp: event.msg_timestamp },
        );
    }
    if (!isRecord(event.extra)) {
        throw KookError.invalid("KOOK 事件 extra 必须为对象", "KOOK_EVENT_EXTRA_INVALID", {
            extra: event.extra,
        });
    }
    return {
        ...event,
        channel_type: event.channel_type,
        type: event.type,
        target_id: targetId,
        author_id: authorId,
        content: event.content,
        msg_id: messageId,
        msg_timestamp: event.msg_timestamp,
        ...(typeof event.nonce === "string" ? { nonce: event.nonce } : {}),
        ...(typeof event.verify_token === "string" ? { verify_token: event.verify_token } : {}),
        ...(typeof event.challenge === "string" ? { challenge: event.challenge } : {}),
        extra: event.extra,
    };
}

function requiredString(value: unknown, field: string): string {
    if (typeof value === "string" && value) return value;
    throw KookError.invalid(`KOOK 事件 ${field} 无效`, "KOOK_EVENT_FIELD_INVALID", {
        field,
        value,
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSignalType(value: unknown): value is KookSignal["s"] {
    return value === 0 || value === 1 || value === 2 || value === 3 || value === 5 || value === 6;
}

function isEventType(value: unknown): value is KookMessageType {
    return (
        value === 1 ||
        value === 2 ||
        value === 3 ||
        value === 4 ||
        value === 8 ||
        value === 9 ||
        value === 10 ||
        value === 12 ||
        value === 255
    );
}

function isChannelType(value: unknown): value is KookEvent["channel_type"] {
    return value === "GROUP" || value === "PERSON" || value === "BROADCAST";
}

function isSequence(value: unknown): value is number {
    return isSafeInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is number {
    return isSafeInteger(value) && value > 0;
}

function isSafeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value);
}

export function parseKMarkdown(content: string): string {
    return content
        .replace(/\(met\)([^()]+)\(\/met\)/g, "@$1")
        .replace(/\(rol\)([^()]+)\(\/rol\)/g, "@角色$1")
        .replace(/\(chn\)([^()]+)\(\/chn\)/g, "#$1")
        .replace(/\(emj\)(.+?)\(\/emj\)\[[^\]]+\]/g, ":$1:")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/~~(.+?)~~/g, "$1")
        .replace(/\[(.+?)\]\(.+?\)/g, "$1")
        .trim();
}

export function escapeKMarkdown(text: string): string {
    return text.replace(/[\\*~`[(]/g, value => `\\${value}`);
}

export function stringValue(value: unknown, fallback = ""): string {
    return typeof value === "string" && value ? value : fallback;
}

export function objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}
