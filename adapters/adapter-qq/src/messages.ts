import {
    MediaFileType,
    MsgType,
    type MessageResponse,
    type ReplyTarget,
    type SendMessageOptions,
} from "@tencent-connect/qqbot-nodejs";
import type { Adapter, CommonTypes } from "onebots";
import type { QQClient } from "./client.js";
import { QQApiError } from "./errors.js";

interface CompiledMessage {
    content: string;
    replyId?: string;
    advanced: Omit<SendMessageOptions, "target" | "content">;
    media: Array<{ type: MediaFileType; source: string; name?: string }>;
}

type QQKeyboardButton = NonNullable<
    SendMessageOptions["keyboard"]
>["content"]["rows"][number]["buttons"][number];

export async function sendQQMessage(
    client: QQClient,
    params: Adapter.SendMessageParams,
): Promise<string> {
    const sceneId = params.scene_id.string;
    const compiled = compileMessage(params.message);
    if (params.scene_type === "private" || params.scene_type === "group") {
        return sendOpenIdMessage(client, params.scene_type, sceneId, compiled);
    }
    return sendGuildMessage(client, params.scene_type, sceneId, compiled);
}

export function compileMessage(segments: readonly CommonTypes.Segment[]): CompiledMessage {
    const textParts: string[] = [];
    const media: CompiledMessage["media"] = [];
    const advanced: CompiledMessage["advanced"] = {};
    let replyId: string | undefined;
    for (const segment of segments) {
        const data = segment.data as Record<string, unknown>;
        switch (segment.type) {
            case "text":
                textParts.push(stringValue(data.text));
                break;
            case "at": {
                const id = stringValue(data.qq ?? data.id ?? data.user_id);
                textParts.push(id === "all" ? "@全体成员" : `<@${id}>`);
                break;
            }
            case "face":
                textParts.push(`<emoji:${stringValue(data.id)}>`);
                break;
            case "reply":
                replyId = optionalString(data.message_id ?? data.id);
                break;
            case "image":
            case "video":
            case "audio":
            case "record":
            case "file": {
                const source = optionalString(data.url ?? data.file ?? data.path);
                if (!source)
                    throw new QQApiError(`${segment.type} 消息缺少 url/file/path`, {
                        code: "QQ_MEDIA_SOURCE_REQUIRED",
                    });
                media.push({
                    type: mediaType(segment.type),
                    source,
                    name: optionalString(data.name),
                });
                break;
            }
            case "markdown":
                advanced.msgType = MsgType.MARKDOWN;
                advanced.markdown = {
                    content: stringValue(data.content ?? data.text),
                    custom_template_id: optionalString(data.custom_template_id),
                    params: Array.isArray(data.params)
                        ? (data.params as Array<{ key: string; values: string[] }>)
                        : undefined,
                };
                break;
            case "ark":
                advanced.msgType = MsgType.ARK;
                advanced.ark = {
                    template_id: numberValue(data.template_id),
                    kv: Array.isArray(data.kv)
                        ? (data.kv as Array<{ key: string; value?: string; obj?: unknown[] }>)
                        : [],
                };
                break;
            case "embed":
                advanced.msgType = MsgType.EMBED;
                advanced.embed = data;
                break;
            case "keyboard":
                advanced.keyboard = data as unknown as SendMessageOptions["keyboard"];
                break;
            case "button":
                // 单按钮也归一化为 QQ inline keyboard，避免要求调用者拼完整 JSON。
                advanced.keyboard = {
                    content: {
                        rows: [{ buttons: [data as unknown as QQKeyboardButton] }],
                    },
                };
                break;
            default:
                throw new QQApiError(`QQ 不支持消息段 ${segment.type}`, {
                    code: "QQ_UNSUPPORTED_SEGMENT",
                });
        }
    }
    return { content: textParts.join(""), replyId, advanced, media };
}

async function sendOpenIdMessage(
    client: QQClient,
    scene: "private" | "group",
    sceneId: string,
    message: CompiledMessage,
): Promise<string> {
    const target: ReplyTarget = {
        scope: scene === "private" ? "c2c" : "group",
        targetId: sceneId,
        msgId: message.replyId,
    };
    let response: MessageResponse | undefined;
    if (message.content || Object.keys(message.advanced).length) {
        response = await client.send({
            target,
            content: message.content || undefined,
            ...message.advanced,
        });
    }
    for (const item of message.media) {
        const source = resolveMediaSource(item.source);
        const sent = await client.sendMedia({
            target,
            fileType: item.type,
            fileName: item.name,
            ...source,
        });
        response = sent.message ?? response;
    }
    if (!response) throw new QQApiError("QQ 消息不能为空", { code: "QQ_EMPTY_MESSAGE" });
    return response.id;
}

async function sendGuildMessage(
    client: QQClient,
    scene: "channel" | "direct",
    sceneId: string,
    message: CompiledMessage,
): Promise<string> {
    if (message.media.some(item => item.type !== MediaFileType.IMAGE)) {
        throw new QQApiError("QQ 频道与频道私信仅支持 URL 图片；音视频和文件请使用平台 OpenAPI", {
            code: "QQ_GUILD_MEDIA_UNSUPPORTED",
        });
    }
    const body: Record<string, unknown> = { content: message.content };
    if (message.replyId) body.msg_id = message.replyId;
    Object.assign(body, toPlatformPayload(message.advanced));
    if (message.media[0]) body.image = message.media[0].source;
    const path = scene === "channel" ? `/channels/${sceneId}/messages` : `/dms/${sceneId}/messages`;
    const response = await client.call<{ id: string }>({ method: "POST", path, body });
    return response.id;
}

function toPlatformPayload(message: CompiledMessage["advanced"]): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (message.markdown) payload.markdown = message.markdown;
    if (message.ark) payload.ark = message.ark;
    if (message.embed) payload.embed = message.embed;
    if (message.keyboard) payload.keyboard = message.keyboard;
    return payload;
}

function resolveMediaSource(source: string): {
    url?: string;
    localPath?: string;
    fileData?: string;
} {
    if (/^https?:\/\//u.test(source)) return { url: source };
    if (source.startsWith("base64://")) return { fileData: source };
    return { localPath: source };
}

function mediaType(type: string): MediaFileType {
    if (type === "image") return MediaFileType.IMAGE;
    if (type === "video") return MediaFileType.VIDEO;
    if (type === "audio" || type === "record") return MediaFileType.VOICE;
    return MediaFileType.FILE;
}

function stringValue(value: unknown): string {
    return value == null ? "" : String(value);
}

function optionalString(value: unknown): string | undefined {
    return value == null || value === "" ? undefined : String(value);
}

function numberValue(value: unknown): number {
    const result = Number(value);
    if (!Number.isFinite(result))
        throw new QQApiError("QQ 消息字段必须是数字", { code: "QQ_INVALID_NUMBER" });
    return result;
}
