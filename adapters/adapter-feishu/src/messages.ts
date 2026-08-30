import type { CommonTypes, MediaSourceInput } from "onebots";
import { uploadFeishuFile, uploadFeishuImage, type FeishuMediaClient } from "./media.js";
import { FeishuError, invalidFeishuParam } from "./errors.js";

export interface CompiledFeishuMessage {
    msgType:
        | "text"
        | "post"
        | "image"
        | "file"
        | "audio"
        | "media"
        | "sticker"
        | "interactive"
        | "share_chat"
        | "share_user";
    content: Record<string, unknown>;
    replyTo?: string;
}

export interface FeishuMessageCompilerContext {
    client: FeishuMediaClient;
    resolveUserId(value: string | number): string;
}

/** 把通用消息段收敛为一个飞书消息；无法无损表达的组合会明确失败。 */
export async function compileFeishuMessage(
    segments: CommonTypes.Segment[],
    context: FeishuMessageCompilerContext,
): Promise<CompiledFeishuMessage> {
    const contentSegments = segments.filter(segment => segment.type !== "reply");
    const replies = segments.filter(segment => segment.type === "reply");
    if (replies.length > 1) throw invalidFeishuParam("飞书消息只能包含一个 reply 段");
    const replyTo = replies[0]
        ? requiredString(replies[0].data.message_id ?? replies[0].data.id, "reply.message_id")
        : undefined;
    if (!contentSegments.length) throw invalidFeishuParam("飞书消息不包含可发送内容");

    if (contentSegments.length === 1) {
        const native = await compileSingle(contentSegments[0], context);
        return { ...native, replyTo };
    }
    if (contentSegments.every(segment => ["text", "at", "image"].includes(segment.type))) {
        return { msgType: "post", content: await compilePost(contentSegments, context), replyTo };
    }
    throw invalidFeishuParam("飞书无法在单条消息中无损混合这些消息段，请拆分发送");
}

function textContent(segment: CommonTypes.Segment, context: FeishuMessageCompilerContext): string {
    if (segment.type === "text") return stringValue(segment.data.text);
    const rawId = segment.data.id ?? segment.data.user_id ?? segment.data.qq;
    if (rawId == null) throw invalidFeishuParam("飞书 at 段缺少 id/user_id");
    const id = rawId === "all" ? "all" : context.resolveUserId(idInput(rawId));
    const name = requiredString(segment.data.name ?? (id === "all" ? "所有人" : id), "at.name");
    return `<at user_id="${escapeAttribute(id)}">${escapeText(name)}</at>`;
}

async function compileSingle(
    segment: CommonTypes.Segment,
    context: FeishuMessageCompilerContext,
): Promise<Omit<CompiledFeishuMessage, "replyTo">> {
    if (segment.type === "text" || segment.type === "at") {
        return { msgType: "text", content: { text: textContent(segment, context) } };
    }
    if (
        segment.type === "post" ||
        segment.type === "interactive" ||
        segment.type === "share_chat" ||
        segment.type === "share_user"
    ) {
        return {
            msgType: segment.type,
            content: objectContent(segment),
        };
    }
    if (segment.type === "image") {
        const imageKey =
            optionalString(segment.data.image_key) || (await uploadImage(segment, context));
        return { msgType: "image", content: { image_key: imageKey } };
    }
    if (["file", "audio", "video"].includes(segment.type)) {
        const fileKey =
            optionalString(segment.data.file_key) || (await uploadFile(segment, context));
        return {
            msgType:
                segment.type === "video" ? "media" : segment.type === "audio" ? "audio" : "file",
            content: {
                file_key: fileKey,
                ...(segment.type === "video" && segment.data.image_key
                    ? { image_key: requiredString(segment.data.image_key, "video.image_key") }
                    : {}),
            },
        };
    }
    if (segment.type === "sticker") {
        return {
            msgType: "sticker",
            content: { file_key: requiredString(segment.data.file_key, "sticker.file_key") },
        };
    }
    throw new FeishuError(`飞书不支持消息段 ${segment.type}`, {
        code: "FEISHU_UNSUPPORTED_SEGMENT",
        details: segment.type,
    });
}

async function compilePost(
    segments: CommonTypes.Segment[],
    context: FeishuMessageCompilerContext,
): Promise<Record<string, unknown>> {
    const line: Record<string, unknown>[] = [];
    for (const segment of segments) {
        if (segment.type === "text")
            line.push({ tag: "text", text: stringValue(segment.data.text) });
        else if (segment.type === "at") {
            const rawId = segment.data.id ?? segment.data.user_id ?? segment.data.qq;
            if (rawId == null) throw invalidFeishuParam("飞书 at 段缺少 id/user_id");
            const userId = rawId === "all" ? "all" : context.resolveUserId(idInput(rawId));
            line.push({ tag: "at", user_id: userId, user_name: optionalString(segment.data.name) });
        } else {
            const imageKey =
                optionalString(segment.data.image_key) || (await uploadImage(segment, context));
            line.push({ tag: "img", image_key: imageKey });
        }
    }
    return { zh_cn: { title: "", content: [line] } };
}

async function uploadImage(
    segment: CommonTypes.Segment,
    context: FeishuMessageCompilerContext,
): Promise<string> {
    return uploadFeishuImage(context.client, mediaInput(segment, "image"));
}

async function uploadFile(
    segment: CommonTypes.Segment,
    context: FeishuMessageCompilerContext,
): Promise<string> {
    const fileType = optionalString(segment.data.file_type) || defaultFileType(segment.type);
    return uploadFeishuFile(context.client, {
        ...mediaInput(segment, segment.type),
        fileType,
        duration: optionalNumber(segment.data.duration),
    });
}

function mediaInput(segment: CommonTypes.Segment, name: string): MediaSourceInput {
    return {
        source: requiredString(
            segment.data.url ?? segment.data.file ?? segment.data.src,
            `${name}.file`,
        ),
        filename: optionalString(segment.data.filename ?? segment.data.name),
        contentType: optionalString(segment.data.mime ?? segment.data.content_type),
    };
}

function objectContent(segment: CommonTypes.Segment): Record<string, unknown> {
    const value = segment.data.content ?? segment.data.card ?? segment.data;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalidFeishuParam(`飞书 ${segment.type}.content 必须是对象`, value);
    }
    let content: Record<string, unknown>;
    try {
        content = structuredClone(value as Record<string, unknown>);
    } catch (error) {
        throw new FeishuError(`飞书 ${segment.type}.content 无法序列化`, {
            code: "FEISHU_INVALID_PARAM",
            details: value,
            cause: error,
        });
    }
    if (!Object.keys(content).length)
        throw invalidFeishuParam(`飞书 ${segment.type}.content 不能为空`);
    return content;
}

function defaultFileType(type: string): string {
    if (type === "audio") return "opus";
    if (type === "video") return "mp4";
    return "stream";
}

function idInput(value: unknown): string | number {
    if (typeof value === "string" || typeof value === "number") return value;
    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        return requiredString(record.string ?? record.source, "at.id");
    }
    throw invalidFeishuParam("飞书 at.id 必须为字符串或数字", value);
}

function requiredString(value: unknown, name: string): string {
    const result = optionalString(value) || (typeof value === "number" ? String(value) : "");
    if (!result) throw invalidFeishuParam(`飞书 ${name} 必须为非空字符串`, value);
    return result;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function stringValue(value: unknown): string {
    return value == null ? "" : String(value);
}

function escapeAttribute(value: string): string {
    return value.replace(
        /[&"<>]/gu,
        character =>
            ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[character] || character,
    );
}

function escapeText(value: string): string {
    return value.replace(
        /[&<>]/gu,
        character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character] || character,
    );
}
