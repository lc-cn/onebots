import type { CommonTypes } from "onebots";
import { ZulipError } from "./errors.js";

export interface ZulipMessageCompiler {
    resolveMention(userId: string): Promise<{ id: number; name: string }>;
    upload(segment: CommonTypes.Segment): Promise<{ url: string; name: string }>;
}

/** 将通用消息段编译为 Zulip-flavored Markdown。 */
export async function compileZulipMessage(
    message: readonly (string | CommonTypes.Segment)[],
    compiler: ZulipMessageCompiler,
): Promise<string> {
    let content = "";
    for (const segment of message) {
        if (typeof segment === "string") {
            content += segment;
            continue;
        }
        switch (segment.type) {
            case "text":
                content += stringValue(segment.data.text);
                break;
            case "at":
                content += await compileMention(segment, compiler);
                break;
            case "image":
            case "file": {
                const uploaded = await compiler.upload(segment);
                const label = escapeLabel(
                    stringValue(segment.data.caption || segment.data.name) || uploaded.name,
                );
                content = appendBlock(
                    content,
                    segment.type === "image"
                        ? `![${label}](${uploaded.url})`
                        : `[${label}](${uploaded.url})`,
                );
                break;
            }
            case "emoji":
                content += `:${stringValue(segment.data.name || segment.data.id)}:`;
                break;
            default:
                throw new ZulipError(`Zulip 不支持消息段 ${segment.type}`, {
                    code: "ZULIP_UNSUPPORTED_SEGMENT",
                    details: segment,
                });
        }
    }
    content = content.trim();
    if (!content) {
        throw new ZulipError("Zulip 消息不能为空", { code: "ZULIP_EMPTY_MESSAGE" });
    }
    return content;
}

function appendBlock(content: string, block: string): string {
    const prefix = content && !content.endsWith("\n") ? "\n" : "";
    return `${content}${prefix}${block}\n`;
}

function compileMention(
    segment: CommonTypes.Segment,
    compiler: ZulipMessageCompiler,
): Promise<string> | string {
    const raw = segment.data.id ?? segment.data.user_id ?? segment.data.qq;
    const id = stringValue(raw);
    if (!id) throw new ZulipError("Zulip at 消息段缺少用户 ID", { code: "ZULIP_INVALID_AT" });
    if (id === "all") return "@**all**";
    return compiler.resolveMention(id).then(user => `@**${escapeMention(user.name)}|${user.id}**`);
}

function stringValue(value: unknown): string {
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function escapeLabel(value: string): string {
    return value.replace(/[\[\]]/g, "\\$&");
}

function escapeMention(value: string): string {
    return value.replace(/[|*]/g, "");
}
