import { materializeMediaSource, type Adapter } from "onebots";
import { InputFile } from "grammy";
import type { TelegramBot } from "./bot.js";

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
            throw new Error(`Telegram 文本更新不支持消息段 ${segment.type}`);
        }
    }
    if (!text) throw new Error("Telegram 更新文本不能为空");
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
    let replyTo: number | undefined;
    const media: Array<{ type: string; data: Record<string, unknown> }> = [];
    let replyCount = 0;

    for (const segment of message) {
        if (segment.type === "text") text += String(segment.data.text ?? "");
        else if (segment.type === "at") {
            const id = segment.data.qq ?? segment.data.id ?? segment.data.user_id;
            text += id === "all" ? "@all " : `@${context.resolveUserId(idValue(id))} `;
        } else if (segment.type === "reply") {
            replyCount += 1;
            const value = Number(segment.data.message_id ?? segment.data.id);
            if (!Number.isSafeInteger(value) || value <= 0) {
                throw new Error("Telegram reply.message_id 必须为正整数");
            }
            replyTo = value;
        } else if (
            ["image", "video", "audio", "file", "sticker", "location", "contact"].includes(
                segment.type,
            )
        ) {
            media.push(segment);
        } else throw new Error(`Telegram 不支持消息段 ${segment.type}`);
    }
    if (replyCount > 1) throw new Error("Telegram 消息只能包含一个 reply 段");

    const options = replyTo ? { reply_parameters: { message_id: replyTo } } : {};
    let lastMessageId: number | undefined;
    let caption = text || undefined;
    for (const segment of media) {
        const file =
            segment.type === "location" || segment.type === "contact"
                ? undefined
                : await telegramFile(segment.data);
        let result: { message_id: number } | undefined;
        switch (segment.type) {
            case "image":
                result = await bot.sendPhoto(chatId, file!, {
                    ...options,
                    caption,
                } as never);
                break;
            case "video":
                if (segment.data.animation === true) {
                    result = await bot.getBot().api.sendAnimation(chatId, file!, {
                        ...options,
                        caption,
                    });
                } else {
                    result = await bot.sendVideo(chatId, file!, {
                        ...options,
                        caption,
                    } as never);
                }
                break;
            case "audio":
                if (segment.data.voice === true) {
                    result = await bot.getBot().api.sendVoice(chatId, file!, {
                        ...options,
                        caption,
                    });
                } else
                    result = await bot.sendAudio(chatId, file!, {
                        ...options,
                        caption,
                    } as never);
                break;
            case "file":
                result = await bot.sendDocument(chatId, file!, {
                    ...options,
                    caption,
                } as never);
                break;
            case "sticker":
                result = await bot.getBot().api.sendSticker(chatId, file!, options);
                break;
            case "location":
                const latitude = finiteNumber(segment.data.latitude, "location.latitude");
                const longitude = finiteNumber(segment.data.longitude, "location.longitude");
                result = await bot.getBot().api.sendLocation(chatId, latitude, longitude, options);
                break;
            case "contact":
                const phoneNumber = requiredString(
                    segment.data.phone_number,
                    "contact.phone_number",
                );
                const firstName = requiredString(segment.data.first_name, "contact.first_name");
                result = await bot.getBot().api.sendContact(chatId, phoneNumber, firstName, {
                    ...options,
                    last_name: String(segment.data.last_name ?? "") || undefined,
                });
                break;
        }
        if (result) {
            lastMessageId = result.message_id;
            caption = undefined;
        }
    }

    if (lastMessageId == null || caption) {
        if (!(caption ?? text)) throw new Error("Telegram 消息不包含可发送内容");
        const result = await bot.sendMessage(chatId, caption ?? text, options as never);
        lastMessageId = result.message_id;
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
    throw new Error("Telegram at 段缺少有效用户 ID");
}

function requiredString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value) throw new Error(`Telegram ${name} 不能为空`);
    return value;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function finiteNumber(value: unknown, name: string): number {
    const result = Number(value);
    if (!Number.isFinite(result)) throw new Error(`Telegram ${name} 必须是数字`);
    return result;
}
