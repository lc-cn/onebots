import type { SatoriEmoji, SatoriV1Event } from "./types.js";
import { isRecord } from "./protocol-data.js";

/**
 * 官方文档使用 guild-emoji-deleted。
 * 本仓库协议服务端目前仍发出 guild-emoji-removed，客户端同时识别，避免漏掉事件。
 * https://satori.chat/zh-CN/resources/emoji.html
 */
export const SATORI_GUILD_EMOJI_EVENT_TYPES = [
    "guild-emoji-added",
    "guild-emoji-updated",
    "guild-emoji-deleted",
    "guild-emoji-removed",
] as const;

export type SatoriGuildEmojiEventType = (typeof SATORI_GUILD_EMOJI_EVENT_TYPES)[number];

export interface SatoriGuildEmojiNotice {
    type: SatoriGuildEmojiEventType;
    timestamp: number;
    emoji: SatoriEmoji;
    guild_id?: string;
    operator_id?: string;
    raw: SatoriV1Event;
}

const GUILD_EMOJI_TYPES = new Set<string>(SATORI_GUILD_EMOJI_EVENT_TYPES);

function readEmoji(value: unknown): SatoriEmoji | undefined {
    if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) return undefined;
    if (value.name !== undefined && typeof value.name !== "string") return undefined;
    return {
        id: value.id,
        ...(typeof value.name === "string" ? { name: value.name } : {}),
    };
}

/** 将 guild-emoji-* 事件投影为带 emoji 资源的通知；资源不完整时返回 undefined。 */
export function projectGuildEmojiEvent(event: SatoriV1Event): SatoriGuildEmojiNotice | undefined {
    if (!GUILD_EMOJI_TYPES.has(event.type)) return undefined;
    const emoji = readEmoji(event.emoji);
    if (!emoji) return undefined;
    const guildId =
        isRecord(event.guild) && typeof event.guild.id === "string" ? event.guild.id : undefined;
    const operatorId =
        isRecord(event.operator) && typeof event.operator.id === "string"
            ? event.operator.id
            : undefined;
    return {
        type: event.type as SatoriGuildEmojiEventType,
        timestamp: event.timestamp,
        emoji,
        ...(guildId ? { guild_id: guildId } : {}),
        ...(operatorId ? { operator_id: operatorId } : {}),
        raw: event,
    };
}
