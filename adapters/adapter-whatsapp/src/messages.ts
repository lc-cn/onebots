import type { CommonTypes } from "onebots";
import { WhatsAppApiError } from "./errors.js";
import type { WhatsAppContact, WhatsAppSendMessageParams } from "./types.js";

/** 将通用消息段编译为顺序明确的 WhatsApp Cloud API 消息。 */
export function compileWhatsAppMessages(
    to: string,
    input: ReadonlyArray<CommonTypes.Segment | string>,
): WhatsAppSendMessageParams[] {
    const messages: WhatsAppSendMessageParams[] = [];
    let text = "";
    let context: { message_id: string } | undefined;
    const flushText = (): void => {
        if (!text) return;
        messages.push({ to, type: "text", text: { body: text }, context });
        text = "";
        context = undefined;
    };

    for (const segment of input) {
        if (typeof segment === "string") {
            text += segment;
            continue;
        }
        const data = segment.data as Record<string, unknown>;
        if (segment.type === "text") {
            text += data.text == null ? "" : String(data.text);
            continue;
        }
        if (segment.type === "reply") {
            context = { message_id: firstString(data, ["message_id", "id"]) };
            continue;
        }
        flushText();
        messages.push(compileNonText(to, segment.type, data, context));
        context = undefined;
    }
    flushText();
    if (!messages.length) {
        throw new WhatsAppApiError("消息中没有 WhatsApp 可发送的内容", {
            code: "WHATSAPP_EMPTY_MESSAGE",
        });
    }
    return messages;
}

function compileNonText(
    to: string,
    type: string,
    data: Record<string, unknown>,
    context: { message_id: string } | undefined,
): WhatsAppSendMessageParams {
    if (type === "whatsapp_message" || type === "whatsapp") {
        const native = recordValue(data.message ?? data, "whatsapp_message");
        if (typeof native.type !== "string") invalidSegment("原生消息缺少 type");
        return { ...structuredClone(native), to, type: native.type as string, context };
    }
    if (
        ["image", "video", "audio", "voice", "record", "file", "document", "sticker"].includes(type)
    ) {
        return compileMedia(to, type, data, context);
    }
    if (type === "location") {
        return {
            to,
            type,
            context,
            location: {
                latitude: numberValue(data.latitude ?? data.lat, "latitude"),
                longitude: numberValue(data.longitude ?? data.lon, "longitude"),
                name: optionalString(data.name ?? data.title),
                address: optionalString(data.address),
            },
        };
    }
    if (type === "contact" || type === "contacts") {
        const value = data.contacts ?? data.contact;
        const contacts = Array.isArray(value) ? value : value ? [value] : [];
        if (!contacts.length) invalidSegment("联系人段缺少 contacts");
        return {
            to,
            type: "contacts",
            context,
            contacts: structuredClone(contacts) as WhatsAppContact[],
        };
    }
    if (type === "reaction") {
        return {
            to,
            type,
            context,
            reaction: {
                message_id: firstString(data, ["message_id", "id"]),
                emoji: typeof data.emoji === "string" ? data.emoji : "",
            },
        };
    }
    return invalidSegment(`不支持消息段 ${type}，可用 whatsapp_message 发送原生负载`);
}

function compileMedia(
    to: string,
    segmentType: string,
    data: Record<string, unknown>,
    context: { message_id: string } | undefined,
): WhatsAppSendMessageParams {
    const type = mediaType(segmentType);
    const source = mediaSource(data);
    const media = {
        ...source,
        ...(type !== "audio" && type !== "sticker"
            ? { caption: optionalString(data.caption) }
            : {}),
        ...(type === "document" ? { filename: optionalString(data.name ?? data.filename) } : {}),
    };
    return { to, type, context, [type]: media };
}

function mediaSource(data: Record<string, unknown>): { id: string } | { link: string } {
    const id = optionalString(data.media_id ?? data.id);
    if (id) return { id };
    const source = firstString(data, ["url", "file"]);
    if (source.startsWith("whatsapp://media/")) return { id: source.slice(17) };
    if (!URL.canParse(source) || new URL(source).protocol !== "https:") {
        invalidSegment("媒体必须提供 media_id 或公开 HTTPS URL");
    }
    return { link: source };
}

function mediaType(type: string): "image" | "video" | "audio" | "document" | "sticker" {
    if (type === "voice" || type === "record") return "audio";
    if (type === "file") return "document";
    return type as "image" | "video" | "audio" | "document" | "sticker";
}

function firstString(data: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
        const value = optionalString(data[key]);
        if (value) return value;
    }
    return invalidSegment(`消息段缺少 ${keys.join("/")}`);
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown, name: string): number {
    const result = Number(value);
    if (!Number.isFinite(result)) invalidSegment(`${name} 必须是数字`);
    return result;
}

function recordValue(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return invalidSegment(`${name} 必须是对象`);
    }
    return value as Record<string, unknown>;
}

function invalidSegment(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_SEGMENT" });
}
