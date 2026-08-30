import { materializeMediaSource, type Adapter } from "onebots";
import { InputFile } from "grammy";
import type { MessageEntity, Opts } from "grammy/types";
import type { TelegramBot } from "./bot.js";
import { TelegramError } from "./errors.js";

/** 编译 Telegram 可编辑文本；媒体编辑应通过 call_telegram_api 选择对应原生方法。 */
export function compileTelegramEditableText(
    message: Adapter.UpdateMessageParams["message"],
    context: { resolveUserId(value: string | number): string },
): string {
    let text = "";
    for (const segment of message) {
        if (segment.type === "text") text += String(segment.data.text ?? "");
        else if (segment.type === "at") {
            const id = segment.data.qq ?? segment.data.id ?? segment.data.user_id;
            text += id === "all" ? "@all " : `@${context.resolveUserId(idValue(id))} `;
        } else {
            throw TelegramError.invalid(
                `Telegram 文本更新不支持消息段 ${segment.type}`,
                "TELEGRAM_MESSAGE_SEGMENT_UNSUPPORTED",
                { segment_type: segment.type },
            );
        }
    }
    if (!text) {
        throw TelegramError.invalid("Telegram 更新文本不能为空", "TELEGRAM_MESSAGE_EMPTY");
    }
    return text;
}

/** 将通用消息段按 Telegram 的原生发送方法投递，支持同一消息中的多个媒体段。 */
export async function sendTelegramMessage(
    bot: TelegramBot,
    chatId: string,
    message: Adapter.SendMessageParams["message"],
    context: { resolveUserId(value: string | number): string } = { resolveUserId: String },
): Promise<number> {
    let text = "";
    const entities: MessageEntity[] = [];
    let replyTo: number | undefined;
    const media: Array<{ type: string; data: Record<string, unknown> }> = [];
    let replyCount = 0;

    for (const segment of message) {
        if (segment.type === "text") text += String(segment.data.text ?? "");
        else if (segment.type === "at") {
            const id = segment.data.qq ?? segment.data.id ?? segment.data.user_id;
            if (id === "all") text += "@all ";
            else {
                const userId = requireTelegramUserId(context.resolveUserId(idValue(id)));
                const label = String(segment.data.name ?? `@${userId}`);
                entities.push({
                    type: "text_link",
                    offset: text.length,
                    length: label.length,
                    url: `tg://user?id=${userId}`,
                });
                text += `${label} `;
            }
        } else if (segment.type === "reply") {
            replyCount += 1;
            const value = Number(segment.data.message_id ?? segment.data.id);
            if (!Number.isSafeInteger(value) || value <= 0) {
                throw TelegramError.invalid(
                    "Telegram reply.message_id 必须为正整数",
                    "TELEGRAM_REPLY_INVALID",
                );
            }
            replyTo = value;
        } else if (
            ["image", "video", "audio", "file", "sticker", "location", "contact"].includes(
                segment.type,
            )
        ) {
            media.push(segment);
        } else {
            throw TelegramError.invalid(
                `Telegram 不支持消息段 ${segment.type}`,
                "TELEGRAM_MESSAGE_SEGMENT_UNSUPPORTED",
                { segment_type: segment.type },
            );
        }
    }
    if (replyCount > 1) {
        throw TelegramError.invalid(
            "Telegram 消息只能包含一个 reply 段",
            "TELEGRAM_REPLY_DUPLICATED",
        );
    }

    const options = replyTo ? { reply_parameters: { message_id: replyTo } } : {};
    let lastMessageId: number | undefined;
    let caption = text || undefined;
    for (const segment of media) {
        const file =
            segment.type === "location" || segment.type === "contact"
                ? undefined
                : await telegramFile(segment.data);
        let result: { message_id: number } | undefined;
        let usedCaption = false;
        const captionOptions = {
            ...options,
            caption,
            caption_entities: caption && entities.length ? entities : undefined,
        };
        switch (segment.type) {
            case "image":
                result = await bot.sendPhoto(chatId, file!, captionOptions as never);
                usedCaption = Boolean(caption);
                break;
            case "video":
                if (segment.data.animation === true) {
                    result = await bot.callApi("sendAnimation", () =>
                        bot.getBot().api.sendAnimation(chatId, file!, captionOptions),
                    );
                } else {
                    result = await bot.sendVideo(chatId, file!, captionOptions as never);
                }
                usedCaption = Boolean(caption);
                break;
            case "audio":
                if (segment.data.voice === true) {
                    result = await bot.callApi("sendVoice", () =>
                        bot.getBot().api.sendVoice(chatId, file!, captionOptions),
                    );
                } else result = await bot.sendAudio(chatId, file!, captionOptions as never);
                usedCaption = Boolean(caption);
                break;
            case "file":
                result = await bot.sendDocument(chatId, file!, captionOptions as never);
                usedCaption = Boolean(caption);
                break;
            case "sticker":
                result = await bot.callApi("sendSticker", () =>
                    bot.getBot().api.sendSticker(chatId, file!, options),
                );
                break;
            case "location":
                const latitude = boundedNumber(segment.data.latitude, "location.latitude", -90, 90);
                const longitude = boundedNumber(
                    segment.data.longitude,
                    "location.longitude",
                    -180,
                    180,
                );
                result = await bot.callApi("sendLocation", () =>
                    bot.getBot().api.sendLocation(chatId, latitude, longitude, options),
                );
                break;
            case "contact":
                const phoneNumber = requiredString(
                    segment.data.phone_number,
                    "contact.phone_number",
                );
                const firstName = requiredString(segment.data.first_name, "contact.first_name");
                result = await bot.callApi("sendContact", () =>
                    bot.getBot().api.sendContact(chatId, phoneNumber, firstName, {
                        ...options,
                        last_name: String(segment.data.last_name ?? "") || undefined,
                    }),
                );
                break;
        }
        if (result) {
            lastMessageId = result.message_id;
            if (usedCaption) caption = undefined;
        }
    }

    if (lastMessageId == null || caption) {
        if (!(caption ?? text)) {
            throw TelegramError.invalid("Telegram 消息不包含可发送内容", "TELEGRAM_MESSAGE_EMPTY");
        }
        const result = await bot.sendMessage(chatId, caption ?? text, {
            ...options,
            entities: entities.length ? entities : undefined,
        } as Opts<"sendMessage">);
        lastMessageId = result.message_id;
    }
    if (lastMessageId == null) {
        throw TelegramError.invalid(
            "Telegram 发送结果缺少 message_id",
            "TELEGRAM_MESSAGE_ID_MISSING",
        );
    }
    return lastMessageId;
}

async function telegramFile(data: Record<string, unknown>): Promise<string | InputFile> {
    const source = requiredString(data.url ?? data.file, "media.file");
    if (/^https?:\/\//u.test(source)) return source;
    if (!isMaterializedSource(source)) return source;
    const media = await materializeMediaSource({
        source,
        filename: optionalString(data.filename ?? data.name),
        contentType: optionalString(data.mime ?? data.content_type),
    });
    return new InputFile(media.data, media.filename);
}

function isMaterializedSource(value: string): boolean {
    return /^(?:base64:|data:|file:|\.{0,2}\/|\/)/u.test(value) || /^[A-Za-z]:[\\/]/u.test(value);
}

function idValue(value: unknown): string | number {
    if (typeof value === "string" || typeof value === "number") return value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        return idValue(record.string ?? record.source);
    }
    throw TelegramError.invalid("Telegram at 段缺少有效用户 ID", "TELEGRAM_MENTION_USER_INVALID");
}

function requiredString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value) {
        throw TelegramError.invalid(
            `Telegram ${name} 不能为空`,
            "TELEGRAM_MESSAGE_FIELD_REQUIRED",
            { name },
        );
    }
    return value;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function boundedNumber(value: unknown, name: string, min: number, max: number): number {
    const result = Number(value);
    if (!Number.isFinite(result) || result < min || result > max) {
        throw TelegramError.invalid(
            `Telegram ${name} 必须是 ${min}-${max} 范围内的数字`,
            "TELEGRAM_MESSAGE_FIELD_INVALID",
            { name, min, max },
        );
    }
    return result;
}

function requireTelegramUserId(value: string): string {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
        throw TelegramError.invalid(
            "Telegram at 段的用户 ID 必须为安全整数",
            "TELEGRAM_MENTION_USER_INVALID",
        );
    }
    return value;
}
