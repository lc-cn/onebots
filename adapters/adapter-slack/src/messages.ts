import type { CommonTypes, MediaSourceInput } from "onebots";
import type { SlackMessageOptions } from "./types.js";

export interface SlackFileInput extends MediaSourceInput {
    title?: string;
    altText?: string;
}

export interface CompiledSlackMessage {
    text: string;
    options: SlackMessageOptions;
    files: SlackFileInput[];
}

/** 将通用消息段编译为 Slack chat.postMessage / filesUploadV2 输入。 */
export function compileSlackMessage(message: CommonTypes.Segment[]): CompiledSlackMessage {
    let text = "";
    const options: SlackMessageOptions = {};
    const files: SlackFileInput[] = [];
    for (const segment of message) {
        const data = record(segment.data);
        switch (segment.type) {
            case "text":
                text += stringValue(data.text);
                break;
            case "at": {
                const id = idValue(data.qq ?? data.id ?? data.user_id, "at.id");
                text += id === "all" ? "<!channel> " : `<@${id}> `;
                break;
            }
            case "reply":
                options.thread_ts = idValue(data.message_id ?? data.id, "reply.message_id");
                break;
            case "image":
            case "file":
            case "audio":
            case "video":
                files.push(fileInput(segment.type, data));
                break;
            case "slack_message": {
                const native = record(data.body ?? data.message ?? data);
                if (typeof native.text === "string") text += native.text;
                const nativeOptions = structuredClone(native);
                delete nativeOptions.text;
                delete nativeOptions.channel;
                Object.assign(options, nativeOptions);
                break;
            }
            default:
                throw new Error(`Slack 不支持消息段 ${segment.type}`);
        }
    }
    if (!text && !files.length && !options.blocks?.length && !options.attachments?.length) {
        throw new Error("Slack 消息不包含可发送内容");
    }
    const unsupported = unsupportedUploadOptions(options);
    if (files.length && unsupported.length) {
        throw new Error(`Slack 文件上传不能与这些消息选项混用: ${unsupported.join(", ")}`);
    }
    if (files.length && text && options.blocks?.length) {
        throw new Error("Slack 文件上传不能同时发送正文与 Block Kit，请拆分为两条消息");
    }
    return { text, options, files };
}

function fileInput(type: string, data: Record<string, unknown>): SlackFileInput {
    return {
        source: requiredString(data.url ?? data.file ?? data.src, `${type}.url/file`),
        filename: optionalString(data.filename ?? data.name),
        contentType: optionalString(data.content_type ?? data.mime),
        title: optionalString(data.title ?? data.name ?? data.filename),
        altText: optionalString(data.alt ?? data.description),
    };
}

function unsupportedUploadOptions(options: SlackMessageOptions): string[] {
    const supported = new Set(["thread_ts", "blocks"]);
    return Object.keys(options).filter(key => !supported.has(key));
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function idValue(value: unknown, name: string): string {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const object = value as Record<string, unknown>;
        value = object.string ?? object.source;
    }
    return requiredString(value, name);
}

function requiredString(value: unknown, name: string): string {
    const result = optionalString(value) || (typeof value === "number" ? String(value) : "");
    if (!result) throw new Error(`Slack ${name} 必须为非空字符串`);
    return result;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function stringValue(value: unknown): string {
    return value == null ? "" : String(value);
}

/** filesUploadV2 返回多层 completion/file/share，统一提取真正的消息 ts。 */
export function slackUploadMessageTimestamp(value: unknown): string | undefined {
    const timestamps: string[] = [];
    visit(value, (key, item) => {
        if ((key === "ts" || key === "timestamp") && typeof item === "string") {
            timestamps.push(item);
        }
    });
    return timestamps.find(timestamp => /^\d+\.\d+$/u.test(timestamp));
}

function visit(value: unknown, callback: (key: string, value: unknown) => void): void {
    if (Array.isArray(value)) {
        value.forEach(item => visit(item, callback));
        return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
        callback(key, item);
        visit(item, callback);
    }
}
