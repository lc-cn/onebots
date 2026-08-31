import type { CommonTypes } from "onebots";
import { WeComKfError } from "./errors.js";

export interface KfOutboundMessage extends Record<string, unknown> {
    msgtype: string;
}

/** 将通用消息段编译为微信客服 send_msg 原生消息序列。 */
export function compileKfMessages(
    input: ReadonlyArray<CommonTypes.Segment | string>,
): KfOutboundMessage[] {
    const messages: KfOutboundMessage[] = [];
    let text = "";
    const flushText = (): void => {
        if (!text) return;
        messages.push({ msgtype: "text", text: { content: text } });
        text = "";
    };
    for (const segment of input) {
        if (typeof segment === "string") {
            text += segment;
            continue;
        }
        if (segment.type === "text") {
            text += stringValue(segment.data.text) || "";
            continue;
        }
        flushText();
        if (segment.type === "wecom_kf_message") {
            messages.push(nativeMessage(segment.data));
            continue;
        }
        const mediaType = normalizeMediaType(segment.type);
        if (mediaType) {
            const mediaId = mediaIdFromData(segment.data);
            if (!mediaId) invalid(`${segment.type} 段必须提供 media_id 或 file_id`);
            messages.push({ msgtype: mediaType, [mediaType]: { media_id: mediaId } });
            continue;
        }
        if (segment.type === "link") {
            messages.push({ msgtype: "link", link: compileLink(segment.data) });
            continue;
        }
        if (segment.type === "location") {
            messages.push({ msgtype: "location", location: compileLocation(segment.data) });
            continue;
        }
        if (segment.type === "miniprogram" || segment.type === "mini_program") {
            messages.push({
                msgtype: "miniprogram",
                miniprogram: compileMiniProgram(segment.data),
            });
            continue;
        }
        if (segment.type === "msgmenu") {
            if (!Array.isArray(segment.data.list) || !segment.data.list.length)
                invalid("msgmenu 段必须提供非空 list");
            messages.push({ msgtype: "msgmenu", msgmenu: { ...segment.data } });
            continue;
        }
        invalid(`不支持消息段 ${segment.type}`);
    }
    flushText();
    if (!messages.length) invalid("消息内容不能为空");
    return messages;
}

function nativeMessage(data: Record<string, unknown>): KfOutboundMessage {
    const value = data.message || data;
    if (!isRecord(value) || typeof value.msgtype !== "string" || !value.msgtype)
        invalid("wecom_kf_message 段必须提供含 msgtype 的 message 对象");
    const message = { ...value } as KfOutboundMessage;
    delete message.touser;
    delete message.open_kfid;
    delete message.code;
    delete message.msgid;
    return message;
}

function compileLink(data: Record<string, unknown>): Record<string, unknown> {
    const title = stringValue(data.title);
    const url = stringValue(data.url);
    const thumbMediaId = stringValue(data.thumb_media_id) || stringValue(data.file_id);
    if (!title || !url || !thumbMediaId) invalid("link 段必须提供 title、url 与 thumb_media_id");
    if (!/^https?:\/\//u.test(url)) invalid("link.url 必须使用 HTTP(S)");
    return {
        title,
        desc: stringValue(data.desc) || stringValue(data.description),
        url,
        thumb_media_id: thumbMediaId,
    };
}

function compileLocation(data: Record<string, unknown>): Record<string, unknown> {
    const latitude = finiteNumber(data.latitude);
    const longitude = finiteNumber(data.longitude);
    if (latitude === undefined || latitude < -90 || latitude > 90)
        invalid("location.latitude 必须位于 -90 到 90");
    if (longitude === undefined || longitude < -180 || longitude > 180)
        invalid("location.longitude 必须位于 -180 到 180");
    return {
        name: stringValue(data.name) || stringValue(data.label),
        address: stringValue(data.address),
        latitude,
        longitude,
    };
}

function compileMiniProgram(data: Record<string, unknown>): Record<string, unknown> {
    const appid = stringValue(data.appid);
    const title = stringValue(data.title);
    const pagepath = stringValue(data.pagepath);
    const thumbMediaId = stringValue(data.thumb_media_id) || stringValue(data.file_id);
    if (!appid || !title || !pagepath || !thumbMediaId)
        invalid("miniprogram 段必须提供 appid、title、pagepath 与 thumb_media_id");
    return { appid, title, pagepath, thumb_media_id: thumbMediaId };
}

function normalizeMediaType(type: string): "image" | "voice" | "video" | "file" | undefined {
    if (type === "image" || type === "video" || type === "file") return type;
    return type === "voice" || type === "record" || type === "audio" ? "voice" : undefined;
}

function mediaIdFromData(data: Record<string, unknown>): string | undefined {
    const direct = stringValue(data.media_id) || stringValue(data.file_id);
    if (direct) return direct;
    const file = stringValue(data.file);
    if (!file) return undefined;
    if (file.startsWith("wecom-kf://media/"))
        return file.slice("wecom-kf://media/".length) || undefined;
    return /^[\w-]+$/u.test(file) ? file : undefined;
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new WeComKfError(`微信客服 ${message}`, { code: "WECOM_KF_INVALID_MESSAGE" });
}
