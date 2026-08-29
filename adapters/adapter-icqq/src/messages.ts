import { segment } from "@icqqjs/icqq";
import type { MessageElem, Sendable } from "@icqqjs/icqq/lib/message";
import type { CommonTypes } from "onebots";
import type { ICQQMessageElement } from "./types.js";

/** 将通用消息段严格编译为 ICQQ Sendable；不静默丢弃未知段。 */
export function compileICQQMessage(
    message: readonly CommonTypes.Segment[],
): Array<string | MessageElem> {
    return message.map(item => {
        if (typeof item === "string") return item;
        const data = item.data;
        switch (item.type) {
            case "text":
                return requireString(data.text, "text.text");
            case "at": {
                const qq = data.qq ?? data.id ?? data.user_id;
                return segment.at(qq === "all" ? "all" : requireInteger(qq, "at.qq"));
            }
            case "image":
                return segment.image(resolveICQQMediaSource(data, "image"));
            case "face":
                return segment.face(requireInteger(data.id, "face.id"));
            case "record":
            case "audio":
                return segment.record(resolveICQQMediaSource(data, item.type));
            case "video":
                return segment.video(resolveICQQMediaSource(data, "video"));
            case "reply":
                return { type: "reply", id: requireString(data.id, "reply.id") } as MessageElem;
            case "share":
                return segment.share(
                    requireString(data.url, "share.url"),
                    requireString(data.title, "share.title"),
                    optionalString(data.content, "share.content"),
                    optionalString(data.image, "share.image"),
                );
            case "json":
                return segment.json(requireString(data.data, "json.data"));
            case "xml":
                return segment.xml(requireString(data.data, "xml.data"));
            case "icqq":
                return requireNativeElement(data.element);
            default:
                throw new TypeError(`ICQQ 不支持消息段 ${item.type}`);
        }
    });
}

/** 将 ICQQ 消息元素保真投影；未知元素使用 icqq_raw 而非占位文本。 */
export function projectICQQMessageSegments(
    message: ReadonlyArray<ICQQMessageElement | MessageElem>,
): CommonTypes.Segment[] {
    return message.map(element => {
        switch (element.type) {
            case "text":
                return { type: "text", data: { text: element.text } };
            case "face":
            case "sface":
                return { type: "face", data: { id: String(element.id) } };
            case "image":
                return { type: "image", data: { url: element.url, file: element.file } };
            case "record":
                return { type: "record", data: { url: element.url, file: element.file } };
            case "video":
                return {
                    type: "video",
                    data: { url: "url" in element ? element.url : undefined, file: element.file },
                };
            case "at":
                return { type: "at", data: { qq: String(element.qq) } };
            case "share":
                return {
                    type: "share",
                    data: {
                        url: element.url,
                        title: element.title,
                        content: element.content,
                        image: element.image,
                    },
                };
            case "json":
            case "xml":
                return { type: element.type, data: { data: element.data } };
            case "reply":
                return { type: "reply", data: { id: element.id } };
            case "icqq_raw":
                return { type: "icqq_raw", data: { element: element.data } };
            default:
                return { type: "icqq_raw", data: { element } };
        }
    });
}

export function compileICQQReply(message: string | ICQQMessageElement[]): Sendable {
    if (typeof message === "string") return message;
    return message.map(element =>
        element.type === "icqq_raw" ? requireNativeElement(element.data) : (element as MessageElem),
    );
}

export function resolveICQQMediaSource(
    data: Readonly<Record<string, unknown>>,
    segmentType: string,
): string | Buffer {
    const value = data.file ?? data.url;
    const source = requireString(value, `${segmentType}.file`);
    if (!source.startsWith("base64://")) return source;
    const encoded = source.slice("base64://".length).replace(/\s/g, "");
    if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
        throw new TypeError(`${segmentType}.file 包含无效 Base64`);
    }
    return Buffer.from(encoded, "base64");
}

function requireNativeElement(value: unknown): MessageElem {
    if (!value || typeof value !== "object" || !("type" in value)) {
        throw new TypeError("icqq.element 必须是原生消息元素");
    }
    return value as MessageElem;
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value) throw new TypeError(`${field} 必须是非空字符串`);
    return value;
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    return requireString(value, field);
}

function requireInteger(value: unknown, field: string): number {
    const number = typeof value === "string" && value.trim() ? Number(value) : value;
    if (typeof number !== "number" || !Number.isSafeInteger(number)) {
        throw new TypeError(`${field} 必须是安全整数`);
    }
    return number;
}
