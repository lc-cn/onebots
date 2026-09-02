import type { CommonTypes } from "onebots";
import { Ircv3Error } from "./errors.js";

export interface CompiledIrcv3Message {
    text: string;
    replyMessageId?: string;
}

/** 将通用消息段编译为 IRC 文本；无原生资源上传的段只接受公开 URL。 */
export function compileIrcv3Message(
    segments: readonly CommonTypes.Segment[],
): CompiledIrcv3Message {
    let replyMessageId: string | undefined;
    const parts: string[] = [];
    for (const segment of segments) {
        if (segment.type === "reply") {
            replyMessageId = stringField(segment.data.id) || stringField(segment.data.message_id);
            continue;
        }
        if (segment.type === "text") {
            parts.push(stringField(segment.data.text) || "");
            continue;
        }
        if (segment.type === "at") {
            parts.push(
                stringField(segment.data.name) ||
                    stringField(segment.data.user_name) ||
                    stringField(segment.data.id) ||
                    "",
            );
            continue;
        }
        if (segment.type === "emoji") {
            parts.push(
                stringField(segment.data.name) ||
                    stringField(segment.data.text) ||
                    stringField(segment.data.id) ||
                    "",
            );
            continue;
        }
        if (["image", "video", "audio", "file"].includes(segment.type)) {
            const url = stringField(segment.data.url) || stringField(segment.data.file);
            if (!url || !/^https?:\/\//u.test(url)) {
                throw new Ircv3Error(`IRC ${segment.type} 段必须提供公开 HTTP(S) URL`, {
                    code: "IRCV3_MEDIA_URL_REQUIRED",
                });
            }
            parts.push(url);
            continue;
        }
        throw new Ircv3Error(`IRC 不支持消息段 ${segment.type}`, {
            code: "IRCV3_UNSUPPORTED_SEGMENT",
        });
    }
    const text = parts.join("").replace(/\r\n?/gu, "\n");
    if (!text) throw new Ircv3Error("IRC 消息内容不能为空", { code: "IRCV3_EMPTY_MESSAGE" });
    return { text, replyMessageId };
}

/** 按 UTF-8 byte 边界和 512-byte 主报文限制安全拆分 PRIVMSG/NOTICE。 */
export function splitIrcv3Text(
    command: "PRIVMSG" | "NOTICE",
    target: string,
    text: string,
): string[] {
    const overhead = Buffer.byteLength(`${command} ${target} :\r\n`, "utf8");
    const limit = 512 - overhead;
    if (limit < 1)
        throw new Ircv3Error("IRC target 过长，无法发送消息", { code: "IRCV3_TARGET_TOO_LONG" });
    return splitTextByBytes(text, limit);
}

/** CTCP ACTION 的每个分片都保持独立完整的 framing。 */
export function splitIrcv3ActionText(target: string, text: string): string[] {
    const overhead = Buffer.byteLength(`PRIVMSG ${target} :\u0001ACTION \u0001\r\n`, "utf8");
    const limit = 512 - overhead;
    if (limit < 1)
        throw new Ircv3Error("IRC target 过长，无法发送 ACTION", {
            code: "IRCV3_TARGET_TOO_LONG",
        });
    return splitTextByBytes(text, limit).map(chunk => `\u0001ACTION ${chunk}\u0001`);
}

function splitTextByBytes(text: string, limit: number): string[] {
    const output: string[] = [];
    for (const logicalLine of text.split("\n")) {
        if (!logicalLine) {
            output.push(" ");
            continue;
        }
        let current = "";
        let bytes = 0;
        for (const character of logicalLine) {
            const size = Buffer.byteLength(character, "utf8");
            if (size > limit)
                throw new Ircv3Error("单个字符超过 IRC 行限制", {
                    code: "IRCV3_CHARACTER_TOO_LONG",
                });
            if (bytes + size > limit) {
                output.push(current);
                current = character;
                bytes = size;
            } else {
                current += character;
                bytes += size;
            }
        }
        if (current) output.push(current);
    }
    return output;
}

export function projectIrcv3MessageSegments(
    text: string,
    tags: Readonly<Record<string, string | null>>,
): CommonTypes.Segment[] {
    const segments: CommonTypes.Segment[] = [];
    if (typeof tags["+reply"] === "string")
        segments.push({ type: "reply", data: { id: tags["+reply"] } });
    const action = /^\u0001ACTION ([\s\S]*)\u0001$/u.exec(text);
    segments.push({ type: "text", data: { text: action ? action[1] : text } });
    return segments;
}

function stringField(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}
