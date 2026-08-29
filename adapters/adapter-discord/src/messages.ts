import type { CommonTypes } from "onebots";
import type { DiscordFileInput } from "./media.js";
import type { CreateMessageBody, DiscordEmbed } from "./types.js";
import { DiscordError } from "./errors.js";

export interface CompiledDiscordMessage {
    body: CreateMessageBody;
    files: DiscordFileInput[];
}

/** 将通用消息段编译为 Discord v10 消息，不支持的段会显式失败。 */
export function compileDiscordMessage(message: CommonTypes.Segment[]): CompiledDiscordMessage {
    const body: CreateMessageBody = { content: "", embeds: [] };
    const files: DiscordFileInput[] = [];

    for (const segment of message) appendSegment(body, files, segment);
    if (!body.content) delete body.content;
    if (!body.embeds?.length) delete body.embeds;
    if (!hasMessageContent(body) && !files.length) {
        throw invalidMessage("Discord 消息不包含可发送内容");
    }
    if (files.length > 10) throw invalidMessage("Discord 单条消息最多上传 10 个附件");
    return { body, files };
}

function appendSegment(
    body: CreateMessageBody,
    files: DiscordFileInput[],
    segment: CommonTypes.Segment,
): void {
    const data = record(segment.data);
    switch (segment.type) {
        case "text":
            body.content = `${body.content || ""}${stringValue(data.text)}`;
            return;
        case "at": {
            const roleId = data.role_id;
            if (roleId !== undefined) {
                body.content = `${body.content || ""}<@&${requiredString(roleId, "at.role_id")}>`;
                return;
            }
            const id = data.qq ?? data.user_id ?? data.id;
            body.content = `${body.content || ""}${id === "all" ? "@everyone" : `<@${requiredString(id, "at.id")}>`}`;
            return;
        }
        case "channel":
            body.content = `${body.content || ""}<#${requiredString(data.channel_id ?? data.id, "channel.id")}>`;
            return;
        case "reply":
            body.message_reference = {
                message_id: requiredString(data.message_id ?? data.id, "reply.message_id"),
                fail_if_not_exists: data.fail_if_not_exists !== false,
            };
            return;
        case "image":
        case "file":
        case "audio":
        case "record":
        case "video":
            files.push(mediaInput(data, segment.type));
            return;
        case "embed":
            body.embeds?.push(discordEmbed(data.embed ?? data));
            return;
        case "share":
            body.embeds?.push(shareEmbed(data));
            return;
        case "face":
            body.content = `${body.content || ""}${unicodeFace(data.id)}`;
            return;
        case "discord_message":
            applyNativeBody(body, data.body ?? data);
            return;
        default:
            throw invalidMessage(`Discord 不支持消息段 ${segment.type}`);
    }
}

function mediaInput(data: Record<string, unknown>, type: string): DiscordFileInput {
    const source = requiredString(data.url ?? data.file ?? data.src, `${type}.url/file`);
    return {
        source,
        filename: optionalString(data.filename ?? data.name),
        contentType: optionalString(data.content_type ?? data.mime),
        description: optionalString(data.description ?? data.alt ?? data.caption),
    };
}

function discordEmbed(value: unknown): DiscordEmbed {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalidMessage("Discord embed 段必须提供对象");
    }
    return structuredClone(value) as DiscordEmbed;
}

function shareEmbed(data: Record<string, unknown>): DiscordEmbed {
    const image = optionalString(data.image);
    return {
        title: optionalString(data.title) || "分享链接",
        url: requiredString(data.url, "share.url"),
        description: optionalString(data.content),
        ...(image ? { image: { url: image } } : {}),
    };
}

function unicodeFace(value: unknown): string {
    const codePoint = Number(value);
    if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        throw invalidMessage("Discord face.id 必须是有效 Unicode code point");
    }
    return String.fromCodePoint(codePoint);
}

function applyNativeBody(body: CreateMessageBody, value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalidMessage("Discord discord_message.body 必须为对象");
    }
    Object.assign(body, structuredClone(value));
}

function hasMessageContent(body: CreateMessageBody): boolean {
    return Boolean(
        body.content ||
        body.embeds?.length ||
        body.components?.length ||
        body.sticker_ids?.length ||
        body.poll ||
        body.message_reference,
    );
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function stringValue(value: unknown): string {
    return value == null ? "" : String(value);
}

function requiredString(value: unknown, name: string): string {
    const result = optionalString(value);
    if (!result) throw invalidMessage(`Discord ${name} 必须为非空字符串`);
    return result;
}

function optionalString(value: unknown): string | undefined {
    if (typeof value === "string" && value) return value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const string = (value as Record<string, unknown>).string;
        if (typeof string === "string" && string) return string;
    }
    return undefined;
}

function invalidMessage(message: string): DiscordError {
    return DiscordError.invalid(message, "DISCORD_MESSAGE_INVALID");
}
