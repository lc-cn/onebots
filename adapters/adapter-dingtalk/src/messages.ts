import { randomUUID } from "node:crypto";
import type { CommonTypes } from "onebots";
import type { DingTalkOutboundMessage } from "./bot.js";

/** 将统一消息段编译为钉钉企业机器人与自定义机器人共用的消息描述。 */
export function buildDingTalkOutboundMessage(
    segments: CommonTypes.Segment[],
): DingTalkOutboundMessage {
    const objects = segments.filter(segment => typeof segment !== "string");
    const native = objects.filter(segment => segment.type !== "at");
    const atUserIds: string[] = [];
    let isAtAll = false;
    let text = "";
    for (const segment of segments) {
        if (typeof segment === "string") text += segment;
        else if (segment.type === "text") text += stringValue(segment.data.text);
        else if (segment.type === "at") {
            const id = stringValue(segment.data.user_id || segment.data.id || segment.data.qq);
            if (id === "all") isAtAll = true;
            else if (id) atUserIds.push(id);
        }
    }
    const only = native.length === 1 ? native[0] : undefined;
    if (only?.type === "markdown") {
        const title = stringValue(only.data.title, "消息");
        const markdown = stringValue(only.data.text || only.data.content);
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
    if (only?.type === "image" && stringValue(only.data.url)) {
        const url = stringValue(only.data.url);
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
        const messageUrl = stringValue(only.data.url);
        const picUrl = stringValue(only.data.image || only.data.pic_url);
        if (!messageUrl) throw new Error("钉钉 link 消息必须提供 url");
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
