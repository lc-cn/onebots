import { Activity, ActivityTypes, type Attachment, type Entity } from "@microsoft/agents-activity";
import type { CommonTypes } from "onebots";
import {
    applyTeamsActivityOptions,
    projectTeamsActivityOptions,
} from "./activity-options.js";
import { TeamsApiError } from "./errors.js";
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
            if (rawId == null) {
                throw TeamsApiError.invalid(
                    "Teams at 段缺少 id/user_id",
                    "TEAMS_MENTION_ID_REQUIRED",
                );
            }
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
            applyTeamsActivityOptions(output, segment.data);
            continue;
        }
        throw TeamsApiError.invalid(
            `Teams 不支持消息段 ${segment.type}`,
            "TEAMS_SEGMENT_UNSUPPORTED",
            { segment_type: segment.type },
        );
    }

    if (text) output.text = text;
    if (attachments.length > 0) output.attachments = attachments;
    if (entities.length > 0) output.entities = [...entities, ...(output.entities || [])];
    if (!output.text && !output.attachments?.length) {
        throw TeamsApiError.invalid("Teams 消息不包含可发送内容", "TEAMS_MESSAGE_EMPTY");
    }

    const activity = new Activity(ActivityTypes.Message);
    activity.text = output.text;
    activity.textFormat = output.textFormat;
    activity.replyToId = output.replyToId;
    activity.summary = output.summary;
    activity.importance = output.importance;
    activity.locale = output.locale;
    activity.inputHint = output.inputHint;
    activity.deliveryMode = output.deliveryMode;
    activity.attachmentLayout = output.attachmentLayout;
    activity.suggestedActions = output.suggestedActions;
    activity.value = output.value;
    activity.attachments = output.attachments as Attachment[] | undefined;
    activity.entities = output.entities as Entity[] | undefined;
    activity.channelData = output.channelData;
    if (activity.attachments?.length && activity.suggestedActions) {
        throw TeamsApiError.invalid(
            "Teams suggested actions 不能与附件同时发送",
            "TEAMS_SUGGESTED_ACTIONS_WITH_ATTACHMENTS",
        );
    }
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
    const nativeActivity = projectTeamsActivityOptions(activity);
    if (nativeActivity) segments.push({ type: "teams_activity", data: nativeActivity });
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
            throw TeamsApiError.invalid(
                "Teams file 段必须同时提供 unique_id 与 file_type",
                "TEAMS_FILE_INFO_INVALID",
            );
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
    if (!result) {
        throw TeamsApiError.invalid(`Teams ${name} 必须为非空字符串`, "TEAMS_PARAM_REQUIRED", {
            name,
        });
    }
    return result;
}

function requireObject(value: unknown, name: string): asserts value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw TeamsApiError.invalid(`Teams ${name} 必须是对象`, "TEAMS_PARAM_INVALID", { name });
    }
}

function requireHttpsUrl(value: unknown, name: string): string {
    const result = requiredString(value, name);
    if (!URL.canParse(result)) {
        throw TeamsApiError.invalid(
            `Teams ${name} 必须是可公开访问的 HTTPS URL`,
            "TEAMS_HTTPS_URL_REQUIRED",
            { name },
        );
    }
    const url = new URL(result);
    if (url.protocol !== "https:" || url.username || url.password) {
        throw TeamsApiError.invalid(
            `Teams ${name} 必须是可公开访问的 HTTPS URL（且不得包含凭据）`,
            "TEAMS_HTTPS_URL_REQUIRED",
            { name },
        );
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
