import type { Adapter } from "onebots";
import type { TelegramBot } from "./bot.js";

/** 将通用消息段按 Telegram 的原生发送方法投递，支持同一消息中的多个媒体段。 */
export async function sendTelegramMessage(
    bot: TelegramBot,
    chatId: string,
    message: Adapter.SendMessageParams["message"],
): Promise<number> {
    let text = "";
    let replyTo: number | undefined;
    const media: Array<{ type: string; data: Record<string, unknown> }> = [];

    for (const segment of message) {
        if (typeof segment === "string") text += segment;
        else if (segment.type === "text") text += String(segment.data.text ?? "");
        else if (segment.type === "at") {
            const id = segment.data.qq ?? segment.data.id ?? segment.data.user_id;
            text += id === "all" ? "@all " : `@${String(id)} `;
        } else if (segment.type === "reply") {
            const value = Number(segment.data.message_id ?? segment.data.id);
            if (Number.isSafeInteger(value)) replyTo = value;
        } else media.push(segment);
    }

    const options = replyTo ? { reply_parameters: { message_id: replyTo } } : {};
    let lastMessageId: number | undefined;
    let caption = text || undefined;
    for (const segment of media) {
        const file = segment.data.url ?? segment.data.file;
        let result: { message_id: number } | undefined;
        switch (segment.type) {
            case "image":
                if (file)
                    result = await bot.sendPhoto(chatId, String(file), {
                        ...options,
                        caption,
                    } as never);
                break;
            case "video":
                if (file)
                    result = await bot.sendVideo(chatId, String(file), {
                        ...options,
                        caption,
                    } as never);
                break;
            case "audio":
                if (file && segment.data.voice === true) {
                    result = await bot.getBot().api.sendVoice(chatId, String(file), {
                        ...options,
                        caption,
                    });
                } else if (file)
                    result = await bot.sendAudio(chatId, String(file), {
                        ...options,
                        caption,
                    } as never);
                break;
            case "file":
                if (file)
                    result = await bot.sendDocument(chatId, String(file), {
                        ...options,
                        caption,
                    } as never);
                break;
            case "sticker":
                if (file)
                    result = await bot.getBot().api.sendSticker(chatId, String(file), options);
                break;
            case "location":
                result = await bot
                    .getBot()
                    .api.sendLocation(
                        chatId,
                        Number(segment.data.latitude),
                        Number(segment.data.longitude),
                        options,
                    );
                break;
            case "contact":
                result = await bot
                    .getBot()
                    .api.sendContact(
                        chatId,
                        String(segment.data.phone_number ?? ""),
                        String(segment.data.first_name ?? ""),
                        {
                            ...options,
                            last_name: String(segment.data.last_name ?? "") || undefined,
                        },
                    );
                break;
        }
        if (result) {
            lastMessageId = result.message_id;
            caption = undefined;
        }
    }

    if (lastMessageId == null || caption) {
        const result = await bot.sendMessage(chatId, caption ?? text, options as never);
        lastMessageId = result.message_id;
    }
    return lastMessageId;
}
