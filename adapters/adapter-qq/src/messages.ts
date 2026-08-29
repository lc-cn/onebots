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

type ResolveUserId = (value: string | number) => string;

type QQKeyboardButton = NonNullable<
    SendMessageOptions["keyboard"]
>["content"]["rows"][number]["buttons"][number];

export async function sendQQMessage(
    client: QQClient,
    params: Adapter.SendMessageParams,
    resolveUserId: ResolveUserId = value => String(value),
): Promise<string> {
    const sceneId = params.scene_id.string;
    const compiled = compileMessage(params.message, resolveUserId);
    if (params.scene_type === "private" || params.scene_type === "group") {
        return sendOpenIdMessage(client, params.scene_type, sceneId, compiled);
    }
    return sendGuildMessage(client, params.scene_type, sceneId, compiled);
}

export function compileMessage(
    segments: readonly CommonTypes.Segment[],
    resolveUserId: ResolveUserId = value => String(value),
): CompiledMessage {
    const textParts: string[] = [];
    const media: CompiledMessage["media"] = [];
    const advanced: CompiledMessage["advanced"] = {};
    let replyId: string | undefined;
    for (const segment of segments) {
        const data = segment.data as Record<string, unknown>;
        switch (segment.type) {
            case "text":
                textParts.push(requiredString(data.text, "text 消息缺少 text"));
                break;
            case "at": {
                const id = requiredIdentifier(
                    data.qq ?? data.id ?? data.user_id,
                    "at 消息缺少 qq/id/user_id",
                );
                textParts.push(id === "all" ? "@全体成员" : `<@${resolveUserId(id)}>`);
                break;
            }
            case "face":
                textParts.push(`<emoji:${requiredString(data.id, "face 消息缺少 id")}>`);
                break;
            case "reply": {
                if (replyId)
                    throw QQApiError.invalid(
                        "一条 QQ 消息只能包含一个 reply 消息段",
                        "QQ_DUPLICATE_REPLY",
                    );
                replyId = requiredString(
                    data.message_id ?? data.id,
                    "reply 消息缺少 message_id/id",
                );
                break;
            }
            case "image":
            case "video":
            case "audio":
            case "record":
            case "file": {
                const source = optionalString(data.url ?? data.file ?? data.path);
                if (!source)
                    throw QQApiError.invalid(
                        `${segment.type} 消息缺少 url/file/path`,
                        "QQ_MEDIA_SOURCE_REQUIRED",
                    );
                media.push({
                    type: mediaType(segment.type),
                    source,
                    name: optionalString(data.name),
                });
                break;
            }
            case "markdown": {
                selectRichMessage(advanced, MsgType.MARKDOWN, "markdown");
                advanced.markdown = {
                    content: requiredString(
                        data.content ?? data.text,
                        "markdown 消息缺少 content/text",
                    ),
                    custom_template_id: optionalString(data.custom_template_id),
                    params: readMarkdownParams(data.params),
                };
                break;
            }
            case "ark": {
                selectRichMessage(advanced, MsgType.ARK, "ark");
                advanced.ark = {
                    template_id: numberValue(data.template_id),
                    kv: readArkKv(data.kv),
                };
                break;
            }
            case "embed": {
                selectRichMessage(advanced, MsgType.EMBED, "embed");
                advanced.embed = requiredRecord(data, "embed 消息必须是对象");
                break;
            }
            case "keyboard":
                setKeyboard(advanced, readKeyboard(data));
                break;
            case "button":
                // 单按钮也归一化为 QQ inline keyboard，避免要求调用者拼完整 JSON。
                setKeyboard(advanced, { content: { rows: [{ buttons: [readButton(data)] }] } });
                break;
            default:
                throw QQApiError.invalid(
                    `QQ 不支持消息段 ${segment.type}`,
                    "QQ_UNSUPPORTED_SEGMENT",
                );
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
    const [firstMedia, ...remainingMedia] = message.media;
    const canUseCaption = firstMedia && Object.keys(message.advanced).length === 0;
    if (!canUseCaption && (message.content || Object.keys(message.advanced).length)) {
        response = await client.send({
            target,
            content: message.content || undefined,
            ...message.advanced,
        });
    }
    const media = firstMedia ? [firstMedia, ...remainingMedia] : [];
    for (const [index, item] of media.entries()) {
        const source = resolveMediaSource(item.source);
        const sent = await client.sendMedia({
            target,
            fileType: item.type,
            fileName: item.name,
            content: canUseCaption && index === 0 ? message.content : undefined,
            ...source,
        });
        response = sent.message ?? response;
    }
    if (!response) throw QQApiError.invalid("QQ 消息不能为空", "QQ_EMPTY_MESSAGE");
    return response.id;
}

async function sendGuildMessage(
    client: QQClient,
    scene: "channel" | "direct",
    sceneId: string,
    message: CompiledMessage,
): Promise<string> {
    if (message.media.some(item => item.type !== MediaFileType.IMAGE)) {
        throw QQApiError.invalid(
            "QQ 频道与频道私信仅支持 URL 图片；音视频和文件请使用平台 OpenAPI",
            "QQ_GUILD_MEDIA_UNSUPPORTED",
        );
    }
    if (message.media.length > 1) {
        throw QQApiError.invalid("QQ 频道单条消息只能包含一张图片", "QQ_GUILD_MEDIA_LIMIT");
    }
    if (message.media[0] && !/^https:\/\//u.test(message.media[0].source)) {
        throw QQApiError.invalid("QQ 频道图片必须使用 HTTPS URL", "QQ_GUILD_IMAGE_URL_REQUIRED");
    }
    if (!message.content && Object.keys(message.advanced).length === 0 && !message.media[0]) {
        throw QQApiError.invalid("QQ 消息不能为空", "QQ_EMPTY_MESSAGE");
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
    if (source.startsWith("base64://")) return { fileData: source.slice("base64://".length) };
    return { localPath: source };
}

function mediaType(type: string): MediaFileType {
    if (type === "image") return MediaFileType.IMAGE;
    if (type === "video") return MediaFileType.VIDEO;
    if (type === "audio" || type === "record") return MediaFileType.VOICE;
    return MediaFileType.FILE;
}

function requiredString(value: unknown, message: string): string {
    const result = optionalString(value);
    if (!result) throw QQApiError.invalid(message, "QQ_INVALID_SEGMENT");
    return result;
}

function requiredIdentifier(value: unknown, message: string): string | number {
    if ((typeof value !== "string" && typeof value !== "number") || String(value) === "") {
        throw QQApiError.invalid(message, "QQ_INVALID_SEGMENT");
    }
    return value;
}

function optionalString(value: unknown): string | undefined {
    return value == null || value === "" ? undefined : String(value);
}

function numberValue(value: unknown): number {
    const result = Number(value);
    if (!Number.isFinite(result))
        throw QQApiError.invalid("QQ 消息字段必须是数字", "QQ_INVALID_NUMBER");
    return result;
}

function selectRichMessage(
    advanced: CompiledMessage["advanced"],
    msgType: typeof MsgType.MARKDOWN | typeof MsgType.ARK | typeof MsgType.EMBED,
    segmentType: string,
): void {
    if (advanced.msgType !== undefined) {
        throw QQApiError.invalid(
            `QQ 富消息段不能与 ${segmentType} 组合`,
            "QQ_CONFLICTING_RICH_SEGMENTS",
        );
    }
    advanced.msgType = msgType;
}

function setKeyboard(
    advanced: CompiledMessage["advanced"],
    keyboard: NonNullable<SendMessageOptions["keyboard"]>,
): void {
    if (advanced.keyboard) {
        throw QQApiError.invalid(
            "一条 QQ 消息只能包含一个 keyboard/button 消息段",
            "QQ_DUPLICATE_KEYBOARD",
        );
    }
    advanced.keyboard = keyboard;
}

function readKeyboard(value: Record<string, unknown>): NonNullable<SendMessageOptions["keyboard"]> {
    const content = requiredRecord(value.content, "keyboard.content 必须是对象");
    if (!Array.isArray(content.rows)) {
        throw QQApiError.invalid("keyboard.content.rows 必须是数组", "QQ_INVALID_SEGMENT");
    }
    return {
        content: {
            rows: content.rows.map((row, index) => {
                const record = requiredRecord(row, `keyboard 第 ${index + 1} 行必须是对象`);
                if (!Array.isArray(record.buttons)) {
                    throw QQApiError.invalid(
                        `keyboard 第 ${index + 1} 行缺少 buttons 数组`,
                        "QQ_INVALID_SEGMENT",
                    );
                }
                return { buttons: record.buttons.map(readButton) };
            }),
        },
    };
}

function readButton(value: unknown): QQKeyboardButton {
    const button = requiredRecord(value, "button 消息必须是对象");
    const render = requiredRecord(button.render_data, "button.render_data 必须是对象");
    const action = requiredRecord(button.action, "button.action 必须是对象");
    const permission = requiredRecord(action.permission, "button.action.permission 必须是对象");
    return {
        id: requiredString(button.id, "button.id 不能为空"),
        render_data: {
            label: requiredString(render.label, "button.render_data.label 不能为空"),
            visited_label: requiredString(
                render.visited_label,
                "button.render_data.visited_label 不能为空",
            ),
            style: numberValue(render.style),
        },
        action: {
            type: numberValue(action.type),
            permission: { type: numberValue(permission.type) },
            data: requiredString(action.data, "button.action.data 不能为空"),
            click_limit:
                action.click_limit === undefined ? undefined : numberValue(action.click_limit),
        },
        group_id: optionalString(button.group_id),
    };
}

function readMarkdownParams(value: unknown): Array<{ key: string; values: string[] }> | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        throw QQApiError.invalid("markdown.params 必须是数组", "QQ_INVALID_SEGMENT");
    }
    return value.map(item => {
        const record = requiredRecord(item, "markdown.params 项必须是对象");
        if (
            !Array.isArray(record.values) ||
            !record.values.every(entry => typeof entry === "string")
        ) {
            throw QQApiError.invalid(
                "markdown.params.values 必须是字符串数组",
                "QQ_INVALID_SEGMENT",
            );
        }
        return {
            key: requiredString(record.key, "markdown.params.key 不能为空"),
            values: record.values,
        };
    });
}

function readArkKv(value: unknown): Array<{ key: string; value?: string; obj?: unknown[] }> {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw QQApiError.invalid("ark.kv 必须是数组", "QQ_INVALID_SEGMENT");
    }
    return value.map(item => {
        const record = requiredRecord(item, "ark.kv 项必须是对象");
        if (record.obj !== undefined && !Array.isArray(record.obj)) {
            throw QQApiError.invalid("ark.kv.obj 必须是数组", "QQ_INVALID_SEGMENT");
        }
        return {
            key: requiredString(record.key, "ark.kv.key 不能为空"),
            value: optionalString(record.value),
            obj: record.obj,
        };
    });
}

function requiredRecord(value: unknown, message: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw QQApiError.invalid(message, "QQ_INVALID_SEGMENT");
    }
    return value as Record<string, unknown>;
}
