import type { Bot, Context } from "grammy";
import type { Message, MessageEntity } from "grammy/types";
import type { TelegramCallbackQuery, TelegramMessage } from "./types.js";

interface TelegramLegacyEventCallbacks {
    getSelfId(): number | undefined;
    privateMessage(message: TelegramMessage): void;
    groupMessage(message: TelegramMessage): void;
    channelMessage(message: TelegramMessage): void;
    guestMessage(message: TelegramMessage): void;
    editedMessage(message: TelegramMessage): void;
    callbackQuery(query: TelegramCallbackQuery): void;
}

/**
 * 维护 TelegramBot 早期公开的细分事件。
 * Account 的标准事件只依赖完整 Update；这层桥接不参与 canonical 投影。
 */
export function installTelegramLegacyEventHandlers(
    bot: Bot,
    callbacks: TelegramLegacyEventCallbacks,
): void {
    bot.on("message", ctx => {
        const message = ctx.message;
        if (!message || (message.from?.is_bot && message.from.id === callbacks.getSelfId())) return;
        const event = transformMessage(message, ctx);
        if (message.chat.type === "private") callbacks.privateMessage(event);
        else callbacks.groupMessage(event);
    });

    bot.on("edited_message", ctx => {
        if (ctx.editedMessage) callbacks.editedMessage(transformMessage(ctx.editedMessage, ctx));
    });

    bot.on("channel_post", ctx => {
        if (ctx.channelPost) callbacks.channelMessage(transformMessage(ctx.channelPost, ctx));
    });

    bot.on("guest_message", ctx => {
        if (ctx.guestMessage) callbacks.guestMessage(transformMessage(ctx.guestMessage, ctx));
    });

    bot.on("callback_query", ctx => {
        if (ctx.callbackQuery) {
            callbacks.callbackQuery(ctx.callbackQuery as unknown as TelegramCallbackQuery);
        }
    });
}

function transformMessage(message: Message, context: Context): TelegramMessage {
    return {
        message_id: message.message_id,
        from: message.from,
        date: message.date,
        guest_query_id: message.guest_query_id,
        chat: message.chat,
        text: (message as Message.TextMessage).text,
        caption: (message as Message & { caption?: string }).caption,
        photo: (message as Message.PhotoMessage).photo,
        video: (message as Message.VideoMessage).video,
        audio: (message as Message.AudioMessage).audio,
        document: (message as Message.DocumentMessage).document,
        sticker: (message as Message.StickerMessage).sticker,
        location: (message as Message.LocationMessage).location,
        contact: (message as Message.ContactMessage).contact,
        reply_to_message: message.reply_to_message as unknown as TelegramMessage,
        entities: (message as Message.TextMessage).entities,
        caption_entities: (message as Message & { caption_entities?: MessageEntity[] })
            .caption_entities,
        _original: message,
        _ctx: context,
    } as TelegramMessage;
}
