import type { CommonTypes } from "onebots";
import type { InputFile, SendMediaOptions } from "./sdk/protocol/chat-event.js";

export type WechatClawbotOutboundOperation =
    | { kind: "text"; text: string }
    | {
          kind: "image" | "video" | "file";
          input: InputFile;
          options: SendMediaOptions;
      };

/** 严格编译通用消息段，确保发请求前已消除空消息、歧义来源和不可复用的入站句柄。 */
export function compileWechatClawbotMessage(
    segments: readonly CommonTypes.Segment[],
): WechatClawbotOutboundOperation[] {
    const operations: WechatClawbotOutboundOperation[] = [];
    for (const segment of segments) {
        if (segment.type === "text") {
            const text = optionalString(segment.data.text, "text.text");
            if (text) operations.push({ kind: "text", text });
            continue;
        }
        if (segment.type !== "image" && segment.type !== "video" && segment.type !== "file") {
            throw new TypeError(`微信 ClawBot 不支持消息段: ${segment.type}`);
        }
        operations.push({
            kind: segment.type,
            input: mediaSource(segment),
            options: {
                caption: optionalString(segment.data.summary, `${segment.type}.summary`),
                filename: optionalString(
                    segment.data.name ?? segment.data.filename,
                    `${segment.type}.name`,
                ),
                contentType: optionalString(
                    segment.data.content_type ?? segment.data.mime,
                    `${segment.type}.content_type`,
                ),
            },
        });
    }
    if (operations.length === 0) throw new TypeError("微信 ClawBot 消息不能全部为空");
    return operations;
}

function mediaSource(segment: CommonTypes.Segment): string {
    const candidates = ["url", "path", "file", "data"]
        .map(field => ({ field, value: segment.data[field] }))
        .filter(candidate => candidate.value !== undefined);
    if (candidates.length !== 1) {
        const nativeHint = segment.data.file_id
            ? "；file_id 是入站加密句柄，请先调用 download_media"
            : "";
        throw new TypeError(
            `${segment.type} 必须且只能提供 url、path、file、data 之一${nativeHint}`,
        );
    }
    const [{ field, value }] = candidates;
    const source = optionalString(value, `${segment.type}.${field}`);
    if (!source) throw new TypeError(`${segment.type}.${field} 不能为空`);
    return field === "data" && !/^(?:base64:\/\/|data:)/u.test(source)
        ? `base64://${source}`
        : source;
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new TypeError(`${field} 必须是字符串`);
    return value;
}
