import { randomUUID } from "node:crypto";
import type { CommonTypes } from "onebots";
import type { DingTalkOutboundMessage } from "./bot.js";
import { DingTalkError } from "./errors.js";

/** 将统一消息段编译为钉钉企业机器人与自定义机器人共用的消息描述。 */
export function buildDingTalkOutboundMessage(
    segments: CommonTypes.Segment[],
    context: { resolveUserId(value: string | number): string } = { resolveUserId: String },
): DingTalkOutboundMessage {
    const native = segments.filter(segment => segment.type !== "at");
    const atUserIds: string[] = [];
    let isAtAll = false;
    for (const segment of segments.filter(item => item.type === "at")) {
        const rawId = segment.data.user_id ?? segment.data.id ?? segment.data.qq;
        const id = idValue(rawId);
        if (id === "all") isAtAll = true;
        else atUserIds.push(context.resolveUserId(id));
    }
    if (!native.length) {
        throw DingTalkError.invalid("钉钉消息不能只包含 @", "DINGTALK_MESSAGE_CONTENT_REQUIRED");
    }
    const unsupported = native.find(
        segment => !["text", "markdown", "image", "link", "action_card"].includes(segment.type),
    );
    if (unsupported) {
        throw DingTalkError.invalid(
            `钉钉不支持消息段 ${unsupported.type}`,
            "DINGTALK_MESSAGE_SEGMENT_UNSUPPORTED",
            { type: unsupported.type },
        );
    }
    if (native.length > 1 && native.some(segment => segment.type !== "text")) {
        throw DingTalkError.invalid(
            "钉钉无法在单条消息中无损混合这些消息段，请拆分发送",
            "DINGTALK_MESSAGE_SEGMENTS_INCOMPATIBLE",
        );
    }
    const text = native.map(segment => stringValue(segment.data.text)).join("");
    const only = native.length === 1 ? native[0] : undefined;
    if (only?.type === "markdown") {
        const title = stringValue(only.data.title, "消息");
        const markdown = stringValue(only.data.text || only.data.content);
        if (!markdown) {
            throw DingTalkError.invalid(
                "钉钉 markdown 消息内容不能为空",
                "DINGTALK_MARKDOWN_CONTENT_REQUIRED",
            );
        }
        return withAt(
            {
                msgKey: "sampleMarkdown",
                msgParam: { title, text: markdown },
                webhook: { msgtype: "markdown", markdown: { title, text: markdown } },
            },
            atUserIds,
            isAtAll,
        );
    }
    if (only?.type === "image") {
        const url = publicUrl(only.data.url, "image.url");
        return withAt(
            {
                msgKey: "sampleImageMsg",
                msgParam: { photoURL: url },
                webhook: {
                    msgtype: "link",
                    link: { title: "图片", text: "图片", messageUrl: url, picUrl: url },
                },
            },
            atUserIds,
            isAtAll,
        );
    }
    if (only?.type === "link") {
        const title = stringValue(only.data.title, "链接");
        const description = stringValue(only.data.description || only.data.text);
        const messageUrl = publicUrl(only.data.url, "link.url");
        const picUrl = optionalPublicUrl(only.data.image || only.data.pic_url, "link.image");
        return withAt(
            {
                msgKey: "sampleLink",
                msgParam: { title, text: description, messageUrl, picUrl },
                webhook: {
                    msgtype: "link",
                    link: { title, text: description, messageUrl, ...(picUrl ? { picUrl } : {}) },
                },
            },
            atUserIds,
            isAtAll,
        );
    }
    if (only?.type === "action_card") {
        const card = { ...only.data };
        if (!Object.keys(card).length) {
            throw DingTalkError.invalid(
                "钉钉 action_card 内容不能为空",
                "DINGTALK_ACTION_CARD_CONTENT_REQUIRED",
            );
        }
        return withAt(
            {
                msgKey: "sampleActionCard",
                msgParam: card,
                webhook: { msgtype: "actionCard", actionCard: card },
            },
            atUserIds,
            isAtAll,
        );
    }
    if (!text) {
        throw DingTalkError.invalid("钉钉文本消息内容不能为空", "DINGTALK_TEXT_CONTENT_REQUIRED");
    }
    return withAt(
        {
            msgKey: "sampleText",
            msgParam: { content: text },
            webhook: { msgtype: "text", text: { content: text } },
        },
        atUserIds,
        isAtAll,
    );
}

export function dingtalkMessageId(result: unknown): string {
    if (result && typeof result === "object") {
        const data = result as Record<string, unknown>;
        for (const key of ["processQueryKey", "task_id", "request_id"]) {
            if (typeof data[key] === "string" && data[key]) return data[key];
            if (typeof data[key] === "number") return String(data[key]);
        }
    }
    return `webhook:${randomUUID()}`;
}

function withAt(
    message: DingTalkOutboundMessage,
    atUserIds: string[],
    isAtAll: boolean,
): DingTalkOutboundMessage {
    message.atUserIds = atUserIds;
    message.isAtAll = isAtAll;
    message.webhook.at = { atUserIds, isAtAll };
    return message;
}

function stringValue(value: unknown, fallback = ""): string {
    return typeof value === "string" && value ? value : fallback;
}

function idValue(value: unknown): string | number {
    if (typeof value === "string" || typeof value === "number") return value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        return idValue(record.string ?? record.source);
    }
    throw DingTalkError.invalid("钉钉 at 段缺少有效 user_id", "DINGTALK_AT_USER_ID_REQUIRED");
}

function publicUrl(value: unknown, name: string): string {
    const result = stringValue(value);
    if (!URL.canParse(result)) {
        throw DingTalkError.invalid(
            `钉钉 ${name} 必须是 HTTP(S) URL`,
            "DINGTALK_MESSAGE_URL_INVALID",
            { field: name },
        );
    }
    const url = new URL(result);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw DingTalkError.invalid(
            `钉钉 ${name} 必须是无凭据的 HTTP(S) URL`,
            "DINGTALK_MESSAGE_URL_UNSAFE",
            { field: name },
        );
    }
    return url.toString();
}

function optionalPublicUrl(value: unknown, name: string): string {
    return value == null || value === "" ? "" : publicUrl(value, name);
}
