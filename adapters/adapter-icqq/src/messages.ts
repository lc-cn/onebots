import { segment } from "@icqqjs/icqq";
import type { MessageElem, Sendable } from "@icqqjs/icqq/lib/message";
import type { CommonTypes } from "onebots";
import type { ICQQMessageElement } from "./types.js";
import { ICQQError, invalidICQQParam } from "./errors.js";
import {
    optionalBoolean,
    optionalInteger,
    optionalString,
    optionalStringArray,
    requireFiniteNumber,
    requireInteger,
    requirePresent,
    requireSegments,
    requireString,
} from "./message-input.js";
import {
    buttonContent,
    markdownConfig,
    optionalHeaders,
    recordOptions,
    videoOptions,
} from "./message-structured-elements.js";

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
                const text = optionalString(data.text, "at.text");
                const dummy = optionalBoolean(data.dummy, "at.dummy");
                if (data.id !== undefined) {
                    const tinyId = requireString(data.id, "at.id");
                    return segment.at(tinyId === "all" ? "all" : tinyId, text, dummy);
                }
                const qq = data.qq ?? data.user_id;
                return segment.at(qq === "all" ? "all" : requireInteger(qq, "at.qq"), text, dummy);
            }
            case "image": {
                const summary = optionalString(data.summary, "image.summary");
                return {
                    ...segment.image(
                        resolveICQQMediaSource(data, "image"),
                        optionalBoolean(data.cache, "image.cache"),
                        optionalInteger(data.timeout, "image.timeout"),
                        optionalHeaders(data.headers, "image.headers"),
                    ),
                    asface: optionalBoolean(data.asface, "image.asface"),
                    origin: optionalBoolean(data.origin, "image.origin"),
                    ...(summary ? { summary } : {}),
                };
            }
            case "flash": {
                const summary = optionalString(data.summary, "flash.summary");
                return {
                    ...segment.flash(
                        resolveICQQMediaSource(data, "flash"),
                        optionalBoolean(data.cache, "flash.cache"),
                        optionalInteger(data.timeout, "flash.timeout"),
                        optionalHeaders(data.headers, "flash.headers"),
                    ),
                    asface: optionalBoolean(data.asface, "flash.asface"),
                    origin: optionalBoolean(data.origin, "flash.origin"),
                    ...(summary ? { summary } : {}),
                };
            }
            case "face": {
                const id = requireInteger(data.id, "face.id");
                const text = optionalString(data.text, "face.text");
                if (
                    data.variant !== undefined &&
                    data.variant !== "face" &&
                    data.variant !== "sface"
                ) {
                    throw invalidICQQParam("face.variant 只能是 face 或 sface", data.variant);
                }
                if (data.variant === "sface") return segment.sface(id, text);
                return {
                    ...segment.face(id),
                    text,
                    big: optionalBoolean(data.is_large ?? data.big, "face.is_large"),
                    stickerId: optionalString(data.sticker_id, "face.sticker_id"),
                    stickerType: optionalInteger(data.sticker_type, "face.sticker_type"),
                };
            }
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
                return segment.record(
                    resolveICQQMediaSource(data, item.type),
                    recordOptions(data, item.type),
                );
            case "video":
                return segment.video(
                    resolveICQQMediaSource(data, "video"),
                    videoOptions(data, "video"),
                );
            case "bubble":
                return segment.bubble(
                    resolveICQQMediaSource(data, "bubble"),
                    videoOptions(data, "bubble"),
                );
            case "reply":
                return {
                    type: "reply",
                    id: requireString(data.id, "reply.id"),
                    text: optionalString(data.text, "reply.text"),
                };
            case "share":
                return segment.share(
                    requireString(data.url, "share.url"),
                    requireString(data.title, "share.title"),
                    optionalString(data.image, "share.image"),
                    optionalString(data.content, "share.content"),
                    optionalString(data.audio, "share.audio"),
                );
            case "location":
                return {
                    ...segment.location(
                        requireFiniteNumber(data.lat, "location.lat"),
                        requireFiniteNumber(data.lng ?? data.lon, "location.lng"),
                        requireString(data.address, "location.address"),
                        optionalString(data.id, "location.id"),
                    ),
                    name: optionalString(data.name, "location.name"),
                };
            case "poke":
                return {
                    ...segment.poke(requireInteger(data.id, "poke.id")),
                    text: optionalString(data.text, "poke.text"),
                };
            case "json":
                return segment.json(requirePresent(data.data, "json.data"));
            case "xml":
                return segment.xml(
                    requireString(data.data, "xml.data"),
                    optionalInteger(data.id, "xml.id"),
                );
            case "markdown":
                return segment.markdown(
                    requireString(data.content, "markdown.content"),
                    markdownConfig(data.config),
                );
            case "button":
                return segment.button(buttonContent(data.content));
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
            case "quote":
                return {
                    type: "quote",
                    user_id: requireInteger(data.user_id, "quote.user_id"),
                    time: requireInteger(data.time, "quote.time"),
                    seq: requireInteger(data.seq, "quote.seq"),
                    rand: requireInteger(data.rand, "quote.rand"),
                    message: compileICQQMessage(requireSegments(data.message, "quote.message")),
                };
            case "file":
                return {
                    type: "file",
                    file: resolveICQQMediaSource(data, "file"),
                    name: optionalString(data.file_name ?? data.name, "file.name"),
                    fid: optionalString(data.file_id ?? data.fid, "file.file_id"),
                    md5: optionalString(data.md5, "file.md5"),
                    sha1: optionalString(data.sha1, "file.sha1"),
                    size: optionalInteger(data.file_size ?? data.size, "file.size"),
                    duration: optionalInteger(data.duration, "file.duration"),
                    temp: optionalBoolean(data.temp, "file.temp"),
                };
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
                        variant: element.type,
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
