import type { CommonTypes } from "onebots";
import { MattermostError } from "./errors.js";
import type { MattermostCreatePost, MattermostFileInfo, MattermostPost } from "./types.js";
import { isRecord } from "./validation.js";

export interface CompiledMattermostMessage extends MattermostCreatePost {
    channel_id: string;
}

/** 将 canonical 消息编译为 Mattermost Markdown、thread root 与已上传 file_ids。 */
export function compileMattermostMessage(
    channelId: string,
    segments: readonly CommonTypes.Segment[],
): CompiledMattermostMessage {
    if (!segments.length) throw MattermostError.invalid("Mattermost 消息不能为空");
    const text: string[] = [];
    const fileIds: string[] = [];
    let rootId: string | undefined;
    for (const segment of segments) {
        if (!isRecord(segment.data)) {
            throw MattermostError.invalid("Mattermost 消息段 data 必须是对象");
        }
        if (segment.type === "text") {
            text.push(requireString(segment.data.text, "text.text"));
            continue;
        }
        if (segment.type === "at") {
            const username = stringValue(segment.data.username) || stringValue(segment.data.name);
            if (!username) {
                throw new MattermostError("Mattermost @mention 必须提供 username 或 name", {
                    code: "MATTERMOST_MENTION_USERNAME_REQUIRED",
                });
            }
            text.push(`@${username.replace(/^@/u, "")}`);
            continue;
        }
        if (segment.type === "emoji") {
            const name = requireString(
                segment.data.name ?? segment.data.emoji,
                "emoji.name",
            ).replace(/^:|:$/gu, "");
            text.push(`:${name}:`);
            continue;
        }
        if (segment.type === "reply" || segment.type === "thread") {
            rootId = requireString(
                segment.data.message_id ?? segment.data.root_id,
                `${segment.type}.message_id`,
            );
            continue;
        }
        if (["image", "video", "audio", "file"].includes(segment.type)) {
            compileMedia(segment, text, fileIds);
            continue;
        }
        if (segment.type === "location") {
            const location = compileLocation(segment.data);
            text.push(`[${location.label}](${location.url})`);
            continue;
        }
        throw new MattermostError(`Mattermost 不支持消息段 ${segment.type}`, {
            code: "MATTERMOST_UNSUPPORTED_SEGMENT",
        });
    }
    const message = text.join("");
    if (!message && !fileIds.length) {
        throw MattermostError.invalid("Mattermost 消息没有可发送内容");
    }
    return {
        channel_id: channelId,
        message,
        root_id: rootId,
        file_ids: fileIds.length ? [...new Set(fileIds)] : undefined,
    };
}

/** 将 post 正文与 metadata.files 投影为 canonical 消息段。 */
export function projectMattermostPost(post: MattermostPost): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    if (post.root_id) {
        segments.push({
            type: "thread",
            data: { root_id: post.root_id, message_id: post.root_id },
        });
    }
    if (post.message) segments.push({ type: "text", data: { text: post.message } });
    for (const file of post.metadata?.files || []) segments.push(projectFile(file));
    if (!segments.length) segments.push({ type: "text", data: { text: "" } });
    return segments;
}

export function projectFile(file: MattermostFileInfo): CommonTypes.Segment {
    const type = mediaType(file.mime_type);
    return {
        type,
        data: {
            file_id: file.id,
            file: file.id,
            name: file.name,
            size: file.size,
            mime_type: file.mime_type,
            width: file.width,
            height: file.height,
        },
    };
}

function compileMedia(segment: CommonTypes.Segment, text: string[], fileIds: string[]): void {
    const id = stringValue(segment.data.file_id) || stringValue(segment.data.id);
    if (id) {
        if (!/^[a-z0-9]+$/u.test(id)) {
            throw MattermostError.invalid(`${segment.type}.file_id 不是有效 Mattermost ID`);
        }
        fileIds.push(id);
        return;
    }
    const url = stringValue(segment.data.url) || stringValue(segment.data.file);
    if (!url) {
        throw new MattermostError(`Mattermost ${segment.type} 必须先 upload_file 或提供公开 URL`, {
            code: "MATTERMOST_MEDIA_SOURCE_REQUIRED",
        });
    }
    const safeUrl = assertHttpUrl(url, `${segment.type}.url`);
    const label = stringValue(segment.data.name) || segment.type;
    text.push(
        segment.type === "image"
            ? `![${escapeLabel(label)}](${safeUrl})`
            : `[${escapeLabel(label)}](${safeUrl})`,
    );
}

function compileLocation(data: Record<string, unknown>): { label: string; url: string } {
    const url = stringValue(data.url);
    if (url)
        return {
            label: stringValue(data.name) || "Location",
            url: assertHttpUrl(url, "location.url"),
        };
    const latitude = Number(data.latitude ?? data.lat);
    const longitude = Number(data.longitude ?? data.lon ?? data.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw MattermostError.invalid("location 必须提供 URL 或有效经纬度");
    }
    return {
        label: stringValue(data.name) || `${latitude}, ${longitude}`,
        url: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}`,
    };
}

function mediaType(mimeType: string): "image" | "video" | "audio" | "file" {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return "file";
}

function assertHttpUrl(value: string, field: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw MattermostError.invalid(`${field} 不是有效 URL`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw MattermostError.invalid(`${field} 必须使用 HTTP 或 HTTPS`);
    }
    return url.href;
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value) {
        throw MattermostError.invalid(`${field} 必须是非空字符串`);
    }
    return value;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function escapeLabel(value: string): string {
    return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}
