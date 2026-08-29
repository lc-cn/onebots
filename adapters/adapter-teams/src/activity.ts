import { Activity, ActivityTypes, type Attachment, type Entity } from "@microsoft/agents-activity";
import type { CommonTypes } from "onebots";
import type {
    TeamsActivity,
    TeamsAttachment,
    TeamsEntity,
    TeamsOutboundActivity,
} from "./types.js";

export interface TeamsActivityCompilerContext {
    resolveUserId(value: string | number): string;
}

/** 将通用消息段编译为单个原生 Teams Activity，保留附件、卡片、回复与 mention entity。 */
export function compileTeamsActivity(
    segments: CommonTypes.Segment[],
    context: TeamsActivityCompilerContext,
): Activity {
    const output: TeamsOutboundActivity = { textFormat: "markdown" };
    const attachments: TeamsAttachment[] = [];
    const entities: TeamsEntity[] = [];
    let text = "";

    for (const segment of segments) {
        if (segment.type === "text") {
            text += stringValue(segment.data.text);
            continue;
        }
        if (segment.type === "at") {
            const rawId = segment.data.id ?? segment.data.user_id ?? segment.data.qq;
            if (rawId == null) throw new Error("Teams at 段缺少 id/user_id");
            if (rawId === "all") {
                // Teams Bot Connector 没有通用 @all mention entity，明确退化为可见文本。
                text += `@${stringValue(segment.data.name || "所有人")}`;
                continue;
            }
            const id = context.resolveUserId(rawId);
            const label = stringValue(segment.data.name || id);
            const mentionText = `<at>${escapeXml(label)}</at>`;
            text += mentionText;
            entities.push({
                type: "mention",
                text: mentionText,
                mentioned: { id, name: label },
            });
            continue;
        }
        if (segment.type === "reply") {
            output.replyToId = requiredString(
                segment.data.id ?? segment.data.message_id,
                "reply.message_id",
            );
            continue;
        }
        if (["adaptive_card", "card", "image", "video", "audio", "file"].includes(segment.type)) {
            attachments.push(compileAttachment(segment));
            continue;
        }
        if (segment.type === "teams_activity") {
            applyActivityOptions(output, segment.data);
            continue;
        }
        throw new Error(`Teams 不支持消息段 ${segment.type}`);
    }

    if (text) output.text = text;
    if (attachments.length > 0) output.attachments = attachments;
    if (entities.length > 0) output.entities = entities;
    if (!output.text && !output.attachments?.length) throw new Error("Teams 消息不包含可发送内容");

    const activity = new Activity(ActivityTypes.Message);
    activity.text = output.text;
    activity.textFormat = output.textFormat;
    activity.replyToId = output.replyToId;
    activity.summary = output.summary;
    activity.importance = output.importance;
    activity.attachments = output.attachments as Attachment[] | undefined;
    activity.entities = output.entities as Entity[] | undefined;
    activity.channelData = output.channelData;
    return activity;
}

/** 将 Teams 文本中的 mention entity 与富附件投影为可逆消息段。 */
export function projectTeamsSegments(activity: TeamsActivity): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    if (activity.replyToId) {
        segments.push({ type: "reply", data: { message_id: activity.replyToId } });
    }
    segments.push(...tokenizeMentions(activity.text || "", activity.entities || []));
    for (const attachment of activity.attachments || []) {
        const contentType = attachment.contentType || "application/octet-stream";
        if (contentType === "application/vnd.microsoft.card.adaptive") {
            segments.push({
                type: "adaptive_card",
                data: { content: attachment.content, name: attachment.name },
            });
            continue;
        }
        if (contentType.startsWith("application/vnd.microsoft.card.")) {
            segments.push({
                type: "card",
                data: {
                    card_type: contentType.slice("application/vnd.microsoft.card.".length),
                    content: attachment.content,
                    name: attachment.name,
                },
            });
            continue;
        }
        const type = mediaSegmentType(contentType);
        segments.push({
            type,
            data: {
                url: attachment.contentUrl,
                name: attachment.name,
                mime: contentType,
                thumbnail_url: attachment.thumbnailUrl,
                content: attachment.content,
            },
        });
    }
    if (segments.length === 0 && activity.value != null) {
        segments.push({ type: "teams_value", data: { value: activity.value } });
    }
    return segments.length > 0 ? segments : [{ type: "text", data: { text: "" } }];
}

function compileAttachment(segment: CommonTypes.Segment): TeamsAttachment {
    if (segment.type === "adaptive_card") {
        const content = segment.data.content ?? segment.data.card;
        requireObject(content, "adaptive_card.content");
        return {
            contentType: "application/vnd.microsoft.card.adaptive",
            content,
            name: optionalString(segment.data.name),
        };
    }
    if (segment.type === "card") {
        const cardType = requiredString(
            segment.data.card_type ?? segment.data.type ?? "hero",
            "card.card_type",
        );
        const content = segment.data.content ?? segment.data.card;
        requireObject(content, "card.content");
        return {
            contentType: `application/vnd.microsoft.card.${cardType}`,
            content,
            name: optionalString(segment.data.name),
        };
    }
    const contentUrl = requireHttpsUrl(
        segment.data.content_url ?? segment.data.url ?? segment.data.file,
        `${segment.type}.url`,
    );
    const uniqueId = optionalString(segment.data.unique_id);
    const fileType = optionalString(segment.data.file_type);
    if (segment.type === "file" && (uniqueId || fileType)) {
        if (!uniqueId || !fileType) {
            throw new Error("Teams file 段必须同时提供 unique_id 与 file_type");
        }
        return {
            contentType: "application/vnd.microsoft.teams.card.file.info",
            contentUrl,
            content: { uniqueId, fileType },
            name: requiredString(segment.data.name ?? segment.data.filename, "file.name"),
        };
    }
    return {
        contentType: optionalString(segment.data.mime) || defaultMime(segment.type),
        contentUrl,
        name: optionalString(segment.data.name || segment.data.filename),
        thumbnailUrl: optionalString(segment.data.thumbnail_url),
    };
}

function tokenizeMentions(text: string, entities: TeamsEntity[]): CommonTypes.Segment[] {
    const mentions = entities.filter(entity => entity.type === "mention" && entity.mentioned);
    if (mentions.length === 0) return text ? [{ type: "text", data: { text } }] : [];
    const segments: CommonTypes.Segment[] = [];
    const matcher = /<at>(.*?)<\/at>/giu;
    let cursor = 0;
    let index = 0;
    for (const match of text.matchAll(matcher)) {
        const position = match.index ?? cursor;
        if (position > cursor)
            segments.push({ type: "text", data: { text: text.slice(cursor, position) } });
        const mention = mentions[index++];
        segments.push({
            type: "at",
            data: {
                id: mention?.mentioned?.id || match[1] || "",
                name: mention?.mentioned?.name || match[1] || "",
                aad_object_id: mention?.mentioned?.aadObjectId,
            },
        });
        cursor = position + match[0].length;
    }
    if (cursor < text.length) segments.push({ type: "text", data: { text: text.slice(cursor) } });
    return segments;
}

function applyActivityOptions(output: TeamsOutboundActivity, data: Record<string, unknown>): void {
    output.summary = optionalString(data.summary);
    output.importance = optionalString(data.importance);
    output.textFormat = optionalString(data.text_format) || output.textFormat;
    if (
        data.channel_data &&
        typeof data.channel_data === "object" &&
        !Array.isArray(data.channel_data)
    ) {
        output.channelData = data.channel_data as Record<string, unknown>;
    }
}

function mediaSegmentType(contentType: string): string {
    if (contentType.startsWith("image/")) return "image";
    if (contentType.startsWith("video/")) return "video";
    if (contentType.startsWith("audio/")) return "audio";
    return "file";
}

function defaultMime(type: string): string {
    if (type === "image") return "image/*";
    if (type === "video") return "video/*";
    if (type === "audio") return "audio/*";
    return "application/octet-stream";
}

function stringValue(value: unknown): string {
    return value == null ? "" : String(value);
}

function optionalString(value: unknown): string | undefined {
    const result = stringValue(value).trim();
    return result || undefined;
}

function requiredString(value: unknown, name: string): string {
    const result = optionalString(value);
    if (!result) throw new Error(`Teams ${name} 必须为非空字符串`);
    return result;
}

function requireObject(value: unknown, name: string): asserts value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Teams ${name} 必须是对象`);
    }
}

function requireHttpsUrl(value: unknown, name: string): string {
    const result = requiredString(value, name);
    if (!URL.canParse(result) || new URL(result).protocol !== "https:") {
        throw new Error(`Teams ${name} 必须是可公开访问的 HTTPS URL`);
    }
    return result;
}

function escapeXml(value: string): string {
    return value.replace(/[&<>"']/g, character => XML_ESCAPES[character] || character);
}

const XML_ESCAPES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};
