import type { CommonTypes } from "onebots";
import type { Milky } from "./types.js";

/** 将 Milky 发送消息段编译为通用消息段；不支持的段显式失败。 */
export function compileMilkySegments(
    segments: readonly Milky.Segment[],
    resolveMessageId: (sequence: number) => string = String,
): CommonTypes.Segment[] {
    if (!Array.isArray(segments)) throw new TypeError("message 必须是消息段数组");
    return segments.map(segment => {
        const data = requireRecord(segment.data, `${segment.type}.data`);
        switch (segment.type) {
            case "text":
                return { type: "text", data: { text: requireString(data.text, "text.text") } };
            case "mention":
                return {
                    type: "at",
                    data: { qq: requireInteger(data.user_id, "mention.user_id") },
                };
            case "mention_all":
                return { type: "at", data: { qq: "all" } };
            case "face":
                return {
                    type: "face",
                    data: {
                        id: requireIdentifier(data.face_id, "face.face_id"),
                        is_large: data.is_large === true,
                    },
                };
            case "reply": {
                const sequence = requireInteger(data.message_seq, "reply.message_seq");
                return {
                    type: "reply",
                    data: { id: resolveMessageId(sequence), message_seq: sequence },
                };
            }
            case "image": {
                const subType = data.sub_type ?? "normal";
                if (subType !== "normal" && subType !== "sticker") {
                    throw new TypeError("image.sub_type 必须是 normal 或 sticker");
                }
                return {
                    type: "image",
                    data: {
                        file: requireString(data.uri, "image.uri"),
                        asface: subType === "sticker",
                        ...(typeof data.summary === "string" ? { summary: data.summary } : {}),
                    },
                };
            }
            case "record":
                return { type: "record", data: { file: requireString(data.uri, "record.uri") } };
            case "video":
                if (data.thumb_uri !== undefined) {
                    throw new TypeError("当前 Adapter seam 不支持 video.thumb_uri");
                }
                return { type: "video", data: { file: requireString(data.uri, "video.uri") } };
            case "light_app":
                return {
                    type: "json",
                    data: { data: requireString(data.json_payload, "light_app.json_payload") },
                };
            case "xml":
                return {
                    type: "xml",
                    data: { data: requireString(data.xml_payload, "xml.xml_payload") },
                };
            default:
                throw new TypeError(`暂不支持发送 Milky 消息段 ${segment.type}`);
        }
    });
}

/** 将通用接收消息段投影为 canonical Milky 消息段；不可表示的扩展段会被过滤。 */
export function projectMilkySegments(segments: readonly CommonTypes.Segment[]): Milky.Segment[] {
    return segments.flatMap(segment => {
        const data = requireRecord(segment.data, `${segment.type}.data`);
        switch (segment.type) {
            case "text":
                return segmentOf("text", { text: optionalString(data.text) ?? "" });
            case "at": {
                const name = optionalString(data.name ?? data.text);
                return data.qq === "all"
                    ? segmentOf("mention_all", {})
                    : segmentOf("mention", {
                          user_id: optionalInteger(data.qq ?? data.user_id) ?? 0,
                          ...(name ? { name } : {}),
                      });
            }
            case "face":
                return segmentOf("face", {
                    face_id: String(data.id ?? data.face_id ?? ""),
                    is_large: data.is_large === true || data.big === true,
                });
            case "image":
                return segmentOf("image", {
                    resource_id: mediaResourceId(data),
                    temp_url: optionalString(data.temp_url ?? data.url) ?? "",
                    width: optionalInteger(data.width) ?? 0,
                    height: optionalInteger(data.height) ?? 0,
                    summary: optionalString(data.summary) ?? "",
                    sub_type: data.asface === true ? "sticker" : "normal",
                });
            case "record":
            case "audio":
                return segmentOf("record", {
                    resource_id: mediaResourceId(data),
                    temp_url: optionalString(data.temp_url ?? data.url) ?? "",
                    duration: optionalInteger(data.duration ?? data.seconds) ?? 0,
                });
            case "video":
                return segmentOf("video", {
                    resource_id: mediaResourceId(data),
                    temp_url: optionalString(data.temp_url ?? data.url) ?? "",
                    width: optionalInteger(data.width) ?? 0,
                    height: optionalInteger(data.height) ?? 0,
                    duration: optionalInteger(data.duration ?? data.seconds) ?? 0,
                });
            case "reply": {
                const sequence = optionalInteger(data.message_seq ?? data.id);
                return sequence === undefined ? [] : segmentOf("reply", { message_seq: sequence });
            }
            case "json":
                return segmentOf("light_app", {
                    app_name: optionalString(data.app_name) ?? "",
                    json_payload: optionalString(data.data ?? data.json_payload) ?? "",
                });
            case "xml":
                return segmentOf("xml", {
                    service_id: optionalInteger(data.service_id) ?? 60,
                    xml_payload: optionalString(data.data ?? data.xml_payload) ?? "",
                });
            case "icqq_raw":
                return projectICQQRawSegment(data.element);
            default:
                return [];
        }
    });
}

function projectICQQRawSegment(value: unknown): Milky.Segment[] {
    if (!value || typeof value !== "object") return [];
    const element = value as Record<string, unknown>;
    if (element.type === "markdown" && typeof element.content === "string") {
        return segmentOf("markdown", { content: element.content });
    }
    if (element.type === "file") {
        const fileHash = optionalString(element.sha1);
        return segmentOf("file", {
            file_id: optionalString(element.fid) ?? "",
            file_name: optionalString(element.name) ?? "",
            file_size: optionalInteger(element.size) ?? 0,
            ...(fileHash ? { file_hash: fileHash } : {}),
        });
    }
    if (element.type === "multimsg") {
        return segmentOf("forward", {
            forward_id: optionalString(element.resid) ?? "",
            title: optionalString(element.title) ?? "",
            preview: Array.isArray(element.preview) ? element.preview : [],
            summary: optionalString(element.content) ?? "",
        });
    }
    return [];
}

function segmentOf(type: Milky.SegmentType, data: Record<string, unknown>): Milky.Segment[] {
    return [{ type, data }];
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${field} 必须是对象`);
    }
    return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new TypeError(`${field} 必须是非空字符串`);
    }
    return value;
}

function requireInteger(value: unknown, field: string): number {
    const result = optionalInteger(value);
    if (result === undefined) throw new TypeError(`${field} 必须是安全整数`);
    return result;
}

function requireIdentifier(value: unknown, field: string): string {
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
    throw new TypeError(`${field} 必须是字符串或安全整数`);
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
    const result = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
    return typeof result === "number" && Number.isSafeInteger(result) ? result : undefined;
}

function mediaResourceId(data: Record<string, unknown>): string {
    return String(data.resource_id ?? data.fid ?? data.file ?? data.temp_url ?? data.url ?? "");
}
