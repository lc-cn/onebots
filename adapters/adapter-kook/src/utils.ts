import { createDecipheriv } from "node:crypto";
import type { KookEvent, KookSignal } from "./types.js";

/** 解密 KOOK Webhook 的 AES-256-CBC 载荷。 */
export function decryptWebhookMessage(encryptedData: string, encryptKey: string): string {
    if (!encryptKey) throw new Error("收到 KOOK 加密回调但未配置 encrypt_key");
    const packet = Buffer.from(encryptedData, "base64");
    if (packet.length <= 16) throw new Error("KOOK 加密回调长度无效");
    const iv = packet.subarray(0, 16);
    const cipherText = Buffer.from(packet.subarray(16).toString("utf8"), "base64");
    const key = Buffer.alloc(32);
    Buffer.from(encryptKey, "utf8").copy(key, 0, 0, 32);
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString("utf8");
}

export function parseSignal(value: unknown): KookSignal {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("KOOK Gateway 信令必须为对象");
    }
    const signal = value as Partial<KookSignal>;
    if (![0, 1, 2, 3, 5, 6].includes(Number(signal.s))) {
        throw new Error("KOOK Gateway 信令类型无效");
    }
    return {
        ...signal,
        s: Number(signal.s) as KookSignal["s"],
        sn: typeof signal.sn === "number" ? signal.sn : undefined,
    } as KookSignal;
}

export function parseEvent(value: unknown): KookEvent {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("KOOK 事件数据必须为对象");
    }
    const event = value as Partial<KookEvent>;
    if (typeof event.channel_type !== "string" || typeof event.type !== "number") {
        throw new Error("KOOK 事件缺少 channel_type 或 type");
    }
    return {
        ...event,
        channel_type: event.channel_type,
        type: event.type,
        target_id: stringValue(event.target_id),
        author_id: stringValue(event.author_id),
        content: stringValue(event.content),
        msg_id: stringValue(event.msg_id),
        msg_timestamp: typeof event.msg_timestamp === "number" ? event.msg_timestamp : Date.now(),
        extra: objectValue(event.extra),
    } as KookEvent;
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
