import type { Bot, Context } from "grammy";
import type { Message, MessageEntity } from "grammy/types";
import type { TelegramCallbackQuery, TelegramMessage } from "./types.js";

interface TelegramLegacyEventCallbacks {
    getSelfId(): number | undefined;
    privateMessage(message: TelegramMessage): void | PromiseLike<void>;
    groupMessage(message: TelegramMessage): void | PromiseLike<void>;
    channelMessage(message: TelegramMessage): void | PromiseLike<void>;
    guestMessage(message: TelegramMessage): void | PromiseLike<void>;
    editedMessage(message: TelegramMessage): void | PromiseLike<void>;
    callbackQuery(query: TelegramCallbackQuery): void | PromiseLike<void>;
}

/**
 * 维护 TelegramBot 早期公开的细分事件。
 * Account 的标准事件只依赖完整 Update；这层桥接不参与 canonical 投影。
 */
export function installTelegramLegacyEventHandlers(
    bot: Bot,
    callbacks: TelegramLegacyEventCallbacks,
): void {
    bot.use(async context => {
        const update = context.update;
        if (update.message) {
            const message = update.message;
            if (message.from?.is_bot && message.from.id === callbacks.getSelfId()) return;
            const event = transformMessage(message, context);
            if (message.chat.type === "private") await callbacks.privateMessage(event);
            else await callbacks.groupMessage(event);
        } else if (update.edited_message) {
            await callbacks.editedMessage(transformMessage(update.edited_message, context));
        } else if (update.channel_post) {
            await callbacks.channelMessage(transformMessage(update.channel_post, context));
        } else if (update.guest_message) {
            await callbacks.guestMessage(transformMessage(update.guest_message, context));
        } else if (update.callback_query) {
            await callbacks.callbackQuery(
                update.callback_query as unknown as TelegramCallbackQuery,
            );
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
