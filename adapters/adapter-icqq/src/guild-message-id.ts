import { invalidICQQParam } from "./errors.js";

const PREFIX = "icqq-guild";

export interface ICQQGuildMessageId {
    guild_id: string;
    channel_id: string;
    seq: number;
    rand: number;
    time: number;
}

/**
 * 频道撤回只接受 seq，但通用协议只回传一个 message_id。
 * 这里使用无歧义的版本化编码保存完整路由，避免把 guild/channel 再塞进 scene_id。
 */
export function encodeICQQGuildMessageId(value: ICQQGuildMessageId): string {
    return [
        PREFIX,
        encodePart(value.guild_id),
        encodePart(value.channel_id),
        value.seq,
        value.rand,
        value.time,
    ].join(".");
}

export function decodeICQQGuildMessageId(value: string): ICQQGuildMessageId | undefined {
    const [prefix, guild, channel, seq, rand, time, ...rest] = value.split(".");
    if (prefix !== PREFIX || !guild || !channel || rest.length > 0) return undefined;
    const parsedSeq = parseSafeInteger(seq);
    const parsedRand = parseSafeInteger(rand);
    const parsedTime = parseSafeInteger(time);
    if (parsedSeq === undefined || parsedRand === undefined || parsedTime === undefined) {
        return undefined;
    }
    const guildId = decodePart(guild);
    const channelId = decodePart(channel);
    if (!guildId || !channelId) return undefined;
    return {
        guild_id: guildId,
        channel_id: channelId,
        seq: parsedSeq,
        rand: parsedRand,
        time: parsedTime,
    };
}

export function requireICQQGuildMessageId(value: string): ICQQGuildMessageId {
    const decoded = decodeICQQGuildMessageId(value);
    if (!decoded) throw invalidICQQParam("无效的 ICQQ 频道 message_id", value);
    return decoded;
}

function encodePart(value: string): string {
    if (!value) throw invalidICQQParam("频道路由 ID 不能为空", value);
    return Buffer.from(value, "utf8").toString("base64url");
}

function decodePart(value: string): string {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return encodePart(decoded) === value ? decoded : "";
}

function parseSafeInteger(value: string | undefined): number | undefined {
    if (!value || !/^\d+$/u.test(value)) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}
