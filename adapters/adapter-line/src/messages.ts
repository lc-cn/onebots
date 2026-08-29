import type { messagingApi } from "@line/bot-sdk";
import type { CommonTypes } from "onebots";
import { LineApiError } from "./errors.js";

type MessageInput = Array<CommonTypes.Segment | string>;

/** 将通用消息段编译为 LINE 原生 Message，原生 line_message 段可无损承载新消息类型。 */
export function compileLineMessages(input: MessageInput): messagingApi.Message[] {
    const messages: messagingApi.Message[] = [];
    let text = "";
    let substitutions: NonNullable<messagingApi.TextMessageV2["substitution"]> = {};
    let quoteToken: string | undefined;
    let mentionIndex = 0;

    const flushText = (): void => {
        if (!text) return;
        if (text.length > 5_000) {
            throw new LineApiError("LINE 文本消息不能超过 5000 个字符", {
                code: "LINE_TEXT_TOO_LONG",
                details: text.length,
            });
        }
        if (Object.keys(substitutions).length) {
            messages.push({ type: "textV2", text, substitution: substitutions, quoteToken });
        } else {
            messages.push({ type: "text", text, quoteToken });
        }
        text = "";
        substitutions = {};
        quoteToken = undefined;
    };

    for (const segment of input) {
        if (typeof segment === "string") {
            text += segment;
            continue;
        }
        const data = segment.data as Record<string, unknown>;
        if (segment.type === "text") {
            text += stringValue(data.text);
            continue;
        }
        if (segment.type === "at") {
            const key = `mention${mentionIndex++}`;
            text += `{${key}}`;
            const target = mentionTarget(data);
            substitutions[key] = {
                type: "mention",
                mentionee: target === "all" ? { type: "all" } : { type: "user", userId: target },
            };
            continue;
        }
        if (segment.type === "reply") {
            quoteToken = firstString(data, ["quote_token", "quoteToken"]);
            continue;
        }
        flushText();
        const native = compileNonTextSegment(segment.type, data);
        if (native) {
            if (quoteToken && native.type === "sticker") {
                messages.push({ ...native, quoteToken });
                quoteToken = undefined;
            } else {
                if (quoteToken) {
                    throw new LineApiError("LINE quote_token 只能用于文本或 Sticker 消息", {
                        code: "LINE_INVALID_QUOTE_TARGET",
                    });
                }
                messages.push(native);
            }
        }
    }
    flushText();
    if (!messages.length) {
        throw new LineApiError("消息中没有 LINE 可发送的内容", {
            code: "LINE_EMPTY_MESSAGE",
        });
    }
    return messages;
}

export function chunkLineMessages(messages: messagingApi.Message[]): messagingApi.Message[][] {
    const chunks: messagingApi.Message[][] = [];
    for (let index = 0; index < messages.length; index += 5) {
        chunks.push(messages.slice(index, index + 5));
    }
    return chunks;
}

function compileNonTextSegment(
    type: string,
    data: Record<string, unknown>,
): messagingApi.Message | undefined {
    if (type === "line_message" || type === "line") return nativeMessage(data);
    if (type === "image") {
        const originalContentUrl = httpsMediaUrl(data);
        return {
            type: "image",
            originalContentUrl,
            previewImageUrl: optionalHttpsUrl(data.thumbnail) || originalContentUrl,
        };
    }
    if (type === "video") {
        const originalContentUrl = httpsMediaUrl(data);
        return {
            type: "video",
            originalContentUrl,
            previewImageUrl: optionalHttpsUrl(data.thumbnail) || originalContentUrl,
            trackingId: optionalString(data.tracking_id) || optionalString(data.trackingId),
        };
    }
    if (["audio", "voice", "record"].includes(type)) {
        return {
            type: "audio",
            originalContentUrl: httpsMediaUrl(data),
            duration: positiveNumber(data.duration, 60_000),
        };
    }
    if (type === "location") {
        return {
            type: "location",
            title: optionalString(data.title) || "位置",
            address: optionalString(data.address) || "",
            latitude: requiredNumber(data.latitude ?? data.lat, "latitude"),
            longitude: requiredNumber(data.longitude ?? data.lon, "longitude"),
        };
    }
    if (type === "face" || type === "sticker") {
        const [fallbackPackage, fallbackSticker] = optionalString(data.id)?.split(":") || [];
        const packageId = firstString(data, ["package_id", "packageId"], false) || fallbackPackage;
        const stickerId = firstString(data, ["sticker_id", "stickerId"], false) || fallbackSticker;
        if (!packageId || !stickerId) {
            throw new LineApiError("LINE Sticker 段缺少 package_id/sticker_id", {
                code: "LINE_INVALID_SEGMENT",
            });
        }
        return {
            type: "sticker",
            packageId,
            stickerId,
        };
    }
    return undefined;
}

function mentionTarget(data: Record<string, unknown>): string {
    for (const key of ["user_id", "id", "qq"]) {
        const value = data[key];
        if (typeof value === "string" || typeof value === "number") return String(value);
        if (value && typeof value === "object" && !Array.isArray(value)) {
            const record = value as Record<string, unknown>;
            const id = record.string ?? record.source;
            if (typeof id === "string" || typeof id === "number") return String(id);
        }
    }
    throw new LineApiError("LINE at 段缺少 user_id/id", { code: "LINE_INVALID_SEGMENT" });
}

function nativeMessage(data: Record<string, unknown>): messagingApi.Message {
    const candidate = data.message ?? data;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new LineApiError("line_message.data.message 必须是 LINE Message 对象", {
            code: "LINE_INVALID_NATIVE_MESSAGE",
        });
    }
    const record = candidate as Record<string, unknown>;
    if (typeof record.type !== "string") {
        throw new LineApiError("LINE 原生消息缺少 type", {
            code: "LINE_INVALID_NATIVE_MESSAGE",
        });
    }
    return structuredClone(record) as messagingApi.Message;
}

function httpsMediaUrl(data: Record<string, unknown>): string {
    return requireHttpsUrl(firstString(data, ["url", "file"]), "媒体 URL");
}

function optionalHttpsUrl(value: unknown): string | undefined {
    const string = optionalString(value);
    return string ? requireHttpsUrl(string, "预览 URL") : undefined;
}

function requireHttpsUrl(value: string, name: string): string {
    if (!URL.canParse(value) || new URL(value).protocol !== "https:") {
        throw new LineApiError(`LINE ${name} 必须是有效 HTTPS URL`, {
            code: "LINE_INVALID_MEDIA_URL",
            details: value,
        });
    }
    return value;
}

function firstString(data: Record<string, unknown>, keys: string[], required = true): string {
    for (const key of keys) {
        const value = optionalString(data[key]);
        if (value) return value;
    }
    if (!required) return "";
    throw new LineApiError(`LINE 消息段缺少 ${keys.join("/")}`, {
        code: "LINE_INVALID_SEGMENT",
    });
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value : value == null ? "" : String(value);
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function requiredNumber(value: unknown, name: string): number {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new LineApiError(`LINE 消息段 ${name} 必须是数字`, {
            code: "LINE_INVALID_SEGMENT",
        });
    }
    return number;
}

function positiveNumber(value: unknown, fallback: number): number {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
