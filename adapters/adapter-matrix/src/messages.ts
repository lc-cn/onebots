import type { CommonTypes } from "onebots";
import { MatrixError } from "./errors.js";
import { isRecord } from "./validation.js";

export interface MatrixMessageContent extends Record<string, unknown> {
    msgtype: string;
    body: string;
    format?: "org.matrix.custom.html";
    formatted_body?: string;
    url?: string;
    info?: Record<string, unknown>;
}

/** 将通用消息编译为一个或多个 Matrix m.room.message 内容。 */
export function compileMatrixMessages(
    segments: readonly CommonTypes.Segment[],
): MatrixMessageContent[] {
    if (!segments.length) throw MatrixError.invalid("Matrix 消息不能为空");
    const result: MatrixMessageContent[] = [];
    let plain = "";
    let html = "";
    const flushText = (): void => {
        if (!plain) return;
        result.push({
            msgtype: "m.text",
            body: plain,
            ...(html && html !== escapeHtml(plain)
                ? { format: "org.matrix.custom.html", formatted_body: html }
                : {}),
        });
        plain = "";
        html = "";
    };
    for (const segment of segments) {
        if (!isRecord(segment.data)) throw MatrixError.invalid("Matrix 消息段 data 必须是对象");
        if (segment.type === "text") {
            const text = requireText(segment.data.text, "text.text");
            plain += text;
            html += escapeHtml(text);
            continue;
        }
        if (segment.type === "at") {
            const userId = requireText(segment.data.user_id ?? segment.data.id, "at.user_id");
            const label = stringValue(segment.data.name) || userId;
            plain += label;
            html += `<a href="https://matrix.to/#/${escapeAttribute(userId)}">${escapeHtml(label)}</a>`;
            continue;
        }
        if (segment.type === "emoji") {
            const value = requireText(segment.data.emoji ?? segment.data.name, "emoji.emoji");
            plain += value;
            html += escapeHtml(value);
            continue;
        }
        flushText();
        result.push(compileMedia(segment));
    }
    flushText();
    return result;
}

/** 将 Matrix 消息内容无损投影为通用消息段。 */
export function projectMatrixMessageContent(
    content: Record<string, unknown>,
): CommonTypes.Segment[] {
    const msgtype = stringValue(content.msgtype) || "m.text";
    const body = stringValue(content.body) || "";
    if (["m.image", "m.video", "m.audio", "m.file"].includes(msgtype)) {
        return [
            {
                type: msgtype.slice(2),
                data: {
                    file: stringValue(content.url),
                    url: stringValue(content.url),
                    name: body,
                    info: isRecord(content.info) ? content.info : undefined,
                },
            },
        ];
    }
    if (msgtype === "m.location") {
        return [
            {
                type: "location",
                data: { content: stringValue(content.geo_uri), name: body },
            },
        ];
    }
    return [
        {
            type: "text",
            data: {
                text: body,
                html:
                    content.format === "org.matrix.custom.html"
                        ? stringValue(content.formatted_body)
                        : undefined,
                msgtype,
            },
        },
    ];
}

function compileMedia(segment: CommonTypes.Segment): MatrixMessageContent {
    if (segment.type === "location") {
        return {
            msgtype: "m.location",
            body: stringValue(segment.data.name) || "Location",
            geo_uri: requireText(segment.data.content ?? segment.data.geo_uri, "location.content"),
        };
    }
    if (!["image", "video", "audio", "file"].includes(segment.type)) {
        throw new MatrixError(`Matrix 不支持消息段 ${segment.type}`, {
            code: "MATRIX_UNSUPPORTED_SEGMENT",
        });
    }
    const url = requireText(segment.data.url ?? segment.data.file, `${segment.type}.url`);
    if (!url.startsWith("mxc://")) {
        throw new MatrixError("Matrix 媒体消息必须先通过 upload_file 上传为 mxc:// URI", {
            code: "MATRIX_MEDIA_UPLOAD_REQUIRED",
        });
    }
    return {
        msgtype: `m.${segment.type}`,
        body: stringValue(segment.data.name) || segment.type,
        url,
        info: isRecord(segment.data.info) ? segment.data.info : undefined,
    };
}

function requireText(value: unknown, field: string): string {
    if (typeof value !== "string" || !value) throw MatrixError.invalid(`${field} 必须是非空字符串`);
    return value;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
    return encodeURI(value).replaceAll('"', "%22");
}
