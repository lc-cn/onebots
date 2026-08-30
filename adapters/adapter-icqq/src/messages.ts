import { segment } from "@icqqjs/icqq";
import type { MessageElem, Sendable } from "@icqqjs/icqq/lib/message";
import type { CommonTypes } from "onebots";
import type { ICQQMessageElement } from "./types.js";
import { ICQQError, invalidICQQParam } from "./errors.js";

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
                if (data.id !== undefined) {
                    const tinyId = requireString(data.id, "at.id");
                    return segment.at(tinyId === "all" ? "all" : tinyId);
                }
                const qq = data.qq ?? data.user_id;
                return segment.at(qq === "all" ? "all" : requireInteger(qq, "at.qq"));
            }
            case "image": {
                const summary = optionalString(data.summary, "image.summary");
                return {
                    ...segment.image(resolveICQQMediaSource(data, "image")),
                    asface: data.asface === true,
                    ...(summary ? { summary } : {}),
                };
            }
            case "flash":
                return segment.flash(resolveICQQMediaSource(data, "flash"));
            case "face":
                return {
                    ...segment.face(requireInteger(data.id, "face.id")),
                    big: data.is_large === true || data.big === true,
                };
            case "rps":
                return segment.rps(optionalInteger(data.id, "rps.id"));
            case "dice":
                return segment.dice(optionalInteger(data.id, "dice.id"));
            case "bface":
                return segment.bface(
                    requireString(data.file, "bface.file"),
                    requireString(data.text, "bface.text"),
                );
            case "record":
            case "audio":
                return segment.record(resolveICQQMediaSource(data, item.type));
            case "video":
                return segment.video(resolveICQQMediaSource(data, "video"));
            case "bubble":
                return segment.bubble(resolveICQQMediaSource(data, "bubble"));
            case "reply":
                return { type: "reply", id: requireString(data.id, "reply.id") } as MessageElem;
            case "share":
                return segment.share(
                    requireString(data.url, "share.url"),
                    requireString(data.title, "share.title"),
                    optionalString(data.image, "share.image"),
                    optionalString(data.content, "share.content"),
                    optionalString(data.audio, "share.audio"),
                );
            case "location":
                return segment.location(
                    requireFiniteNumber(data.lat, "location.lat"),
                    requireFiniteNumber(data.lng ?? data.lon, "location.lng"),
                    requireString(data.address, "location.address"),
                    optionalString(data.id, "location.id"),
                );
            case "poke":
                return segment.poke(requireInteger(data.id, "poke.id"));
            case "json":
                return segment.json(requireString(data.data, "json.data"));
            case "xml":
                return segment.xml(requireString(data.data, "xml.data"));
            case "markdown":
                return segment.markdown(requireString(data.content, "markdown.content"));
            case "mirai":
                return segment.mirai(requireString(data.data, "mirai.data"));
            case "long_msg":
                return segment.long_msg(requireString(data.resid, "long_msg.resid"));
            case "forward":
                return segment.multimsg(
                    requireString(data.resid ?? data.forward_id, "forward.forward_id"),
                    optionalString(data.filename, "forward.filename") ?? "MultiMsg",
                    optionalStringArray(data.preview, "forward.preview"),
                    optionalString(data.title, "forward.title"),
                    optionalString(data.summary ?? data.content, "forward.summary"),
                    optionalString(data.prompt, "forward.prompt"),
                );
            case "node":
                return segment.node(
                    requireInteger(data.user_id ?? data.uin, "node.user_id"),
                    compileICQQMessage(
                        requireSegments(data.message ?? data.content, "node.message"),
                    ),
                    optionalString(data.nickname ?? data.name, "node.nickname"),
                    optionalInteger(data.time, "node.time"),
                    optionalInteger(data.seq, "node.seq"),
                    optionalInteger(data.rand, "node.rand"),
                    optionalString(data.preview, "node.preview"),
                );
            case "icqq":
                return requireNativeElement(data.element);
            default:
                throw new ICQQError(`ICQQ 不支持消息段 ${item.type}`, {
                    code: "ICQQ_UNSUPPORTED_SEGMENT",
                    details: item.type,
                });
        }
    });
}

/** 将 ICQQ 消息元素保真投影；未知元素使用 icqq_raw 而非占位文本。 */
export function projectICQQMessageSegments(
    message: ReadonlyArray<ICQQMessageElement>,
): CommonTypes.Segment[] {
    return message.map(element => {
        switch (element.type) {
            case "text":
                return { type: "text", data: { text: element.text } };
            case "face":
            case "sface":
                return {
                    type: "face",
                    data: {
                        id: String(element.id),
                        ...(element.text === undefined ? {} : { text: element.text }),
                        ...(element.big === undefined ? {} : { is_large: element.big }),
                        ...(element.stickerId === undefined
                            ? {}
                            : { sticker_id: element.stickerId }),
                        ...(element.stickerType === undefined
                            ? {}
                            : { sticker_type: element.stickerType }),
                    },
                };
            case "image":
                return {
                    type: "image",
                    data: {
                        url: element.url,
                        file: element.file,
                        ...imageMetadata(element),
                    },
                };
            case "flash":
                return { type: "flash", data: mediaData(element) };
            case "record":
                return {
                    type: "record",
                    data: {
                        url: element.url,
                        file: element.file,
                        ...mediaMetadata(element),
                        ...(element.brief === undefined ? {} : { brief: element.brief }),
                    },
                };
            case "video":
                return {
                    type: "video",
                    data: {
                        url: "url" in element ? element.url : undefined,
                        file: element.file,
                        ...mediaMetadata(element),
                    },
                };
            case "bubble":
                return { type: "bubble", data: mediaData(element) };
            case "at": {
                const tinyId = "id" in element ? element.id : undefined;
                return {
                    type: "at",
                    data: {
                        ...(tinyId ? { id: tinyId } : { qq: String(element.qq) }),
                        ...(element.text === undefined ? {} : { text: element.text }),
                        ...(element.dummy === undefined ? {} : { dummy: element.dummy }),
                    },
                };
            }
            case "rps":
            case "dice":
                return { type: element.type, data: { id: element.id } };
            case "bface":
                return { type: "bface", data: { file: element.file, text: element.text } };
            case "share":
                return {
                    type: "share",
                    data: {
                        url: element.url,
                        title: element.title,
                        content: element.content,
                        image: element.image,
                        audio: "audio" in element ? element.audio : undefined,
                    },
                };
            case "location":
                return {
                    type: "location",
                    data: {
                        lat: element.lat,
                        lng: element.lng,
                        address: element.address,
                        id: element.id,
                        ...(element.name === undefined ? {} : { name: element.name }),
                    },
                };
            case "poke":
                return {
                    type: "poke",
                    data: { id: element.id, text: "text" in element ? element.text : undefined },
                };
            case "json":
                return { type: "json", data: { data: element.data } };
            case "xml":
                return {
                    type: "xml",
                    data: {
                        data: element.data,
                        ...(element.id === undefined ? {} : { id: element.id }),
                    },
                };
            case "markdown":
                return {
                    type: "markdown",
                    data: {
                        content: element.content,
                        ...(element.config === undefined ? {} : { config: element.config }),
                    },
                };
            case "button":
                return { type: "button", data: { content: element.content } };
            case "forum":
                return {
                    type: "forum",
                    data: { id: element.id, create_time: element.create_time },
                };
            case "mirai":
                return { type: "mirai", data: { data: element.data } };
            case "long_msg":
                return { type: "long_msg", data: { resid: element.resid } };
            case "multimsg":
                return {
                    type: "forward",
                    data: {
                        forward_id: element.resid,
                        filename: element.filename,
                        preview: element.preview,
                        title: element.title,
                        summary: element.content,
                        prompt: element.prompt,
                    },
                };
            case "file":
                return {
                    type: "file",
                    data: {
                        file: element.file,
                        file_id: element.fid,
                        file_name: element.name,
                        file_size: element.size,
                        md5: element.md5,
                        sha1: element.sha1,
                        ...(element.duration === undefined ? {} : { duration: element.duration }),
                    },
                };
            case "reply":
                return {
                    type: "reply",
                    data: {
                        id: element.id,
                        ...(element.text === undefined ? {} : { text: element.text }),
                    },
                };
            case "quote":
                return {
                    type: "quote",
                    data: {
                        user_id: element.user_id,
                        time: element.time,
                        seq: element.seq,
                        rand: element.rand,
                        message: projectSendable(element.message),
                    },
                };
            case "node":
                return {
                    type: "node",
                    data: {
                        user_id: element.user_id,
                        nickname: element.nickname,
                        time: element.time,
                        seq: element.seq,
                        rand: element.rand,
                        preview: element.preview,
                        message: projectSendable(element.message),
                    },
                };
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
        throw invalidICQQParam(`${segmentType}.file 包含无效 Base64`, source);
    }
    return Buffer.from(encoded, "base64");
}

function requireNativeElement(value: unknown): MessageElem {
    if (!value || typeof value !== "object" || !("type" in value)) {
        throw invalidICQQParam("icqq.element 必须是原生消息元素", value);
    }
    return value as MessageElem;
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value)
        throw invalidICQQParam(`${field} 必须是非空字符串`, value);
    return value;
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    return requireString(value, field);
}

function requireInteger(value: unknown, field: string): number {
    const number = typeof value === "string" && value.trim() ? Number(value) : value;
    if (typeof number !== "number" || !Number.isSafeInteger(number)) {
        throw invalidICQQParam(`${field} 必须是安全整数`, value);
    }
    return number;
}

function optionalInteger(value: unknown, field: string): number | undefined {
    return value === undefined ? undefined : requireInteger(value, field);
}

function requireFiniteNumber(value: unknown, field: string): number {
    const number = typeof value === "string" && value.trim() ? Number(value) : value;
    if (typeof number !== "number" || !Number.isFinite(number)) {
        throw invalidICQQParam(`${field} 必须是有限数字`, value);
    }
    return number;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw invalidICQQParam(`${field} 必须是字符串数组`, value);
    return value.map(item => requireString(item, field));
}

function requireSegments(value: unknown, field: string): CommonTypes.Segment[] {
    if (!Array.isArray(value)) throw invalidICQQParam(`${field} 必须是消息段数组`, value);
    return value.map((item, index) => {
        if (!isRecord(item)) {
            throw invalidICQQParam(`${field}[${index}] 必须是消息段对象`, item);
        }
        const data = item.data;
        if (!isRecord(data)) {
            throw invalidICQQParam(`${field}[${index}].data 必须是对象`, data);
        }
        return {
            type: requireString(item.type, `${field}[${index}].type`),
            data,
        };
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mediaData(element: { file: unknown; url?: string; name?: string }) {
    return { file: element.file, url: element.url, name: element.name };
}

function imageMetadata(element: Extract<MessageElem, { type: "image" }>) {
    return {
        ...(element.summary === undefined ? {} : { summary: element.summary }),
        ...(element.asface === undefined ? {} : { asface: element.asface }),
        ...(element.origin === undefined ? {} : { origin: element.origin }),
        ...mediaMetadata(element),
    };
}

function mediaMetadata(element: {
    name?: string;
    fid?: string | number;
    md5?: string;
    sha1?: string;
    height?: number;
    width?: number;
    size?: number;
    seconds?: number;
    nt?: boolean;
}) {
    return {
        ...(element.name === undefined ? {} : { name: element.name }),
        ...(element.fid === undefined ? {} : { file_id: element.fid }),
        ...(element.md5 === undefined ? {} : { md5: element.md5 }),
        ...(element.sha1 === undefined ? {} : { sha1: element.sha1 }),
        ...(element.height === undefined ? {} : { height: element.height }),
        ...(element.width === undefined ? {} : { width: element.width }),
        ...(element.size === undefined ? {} : { size: element.size }),
        ...(element.seconds === undefined ? {} : { duration: element.seconds }),
        ...(element.nt === undefined ? {} : { nt: element.nt }),
    };
}

function projectSendable(message: Sendable): CommonTypes.Segment[] {
    const elements = Array.isArray(message) ? message : [message];
    return elements.flatMap(element =>
        typeof element === "string"
            ? [{ type: "text", data: { text: element } }]
            : projectICQQMessageSegments([element]),
    );
}
