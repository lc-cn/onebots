import { API_CONSTANTS } from "grammy";
import type { Update } from "grammy/types";
import type {
    PhotoSize,
    Audio,
    Document,
    Video,
    Sticker,
    Location,
    Contact,
    MessageEntity,
} from "grammy/types";
/**
 * Telegram Bot API 类型定义
 * 基于 Telegram Bot API 官方文档
 */

/**
 * 代理配置
 */
export interface ProxyConfig {
    /** 代理服务器地址，如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080 */
    url: string;
    /** 代理用户名（可选） */
    username?: string;
    /** 代理密码（可选） */
    password?: string;
}

export type TelegramReceiveMode = "polling" | "webhook" | "manual";
export type TelegramUpdateType = Exclude<keyof Update, "update_id">;

/**
 * 默认订阅 grammY 当前认识的完整 Bot API Update 集合。
 * 运行时、配置校验与 Web Schema 必须共享官方来源，避免升级 Bot API 后静默漏收事件。
 */
export const TELEGRAM_UPDATE_TYPES =
    API_CONSTANTS.ALL_UPDATE_TYPES satisfies ReadonlyArray<TelegramUpdateType>;

// 配置类型
export interface TelegramConfig {
    account_id: string;
    token: string;
    /** Update 接收模式；Webhook 与长轮询互斥。 */
    receive_mode?: TelegramReceiveMode;
    /** 代理配置（用于访问 Telegram API） */
    proxy?: ProxyConfig;
    webhook?: {
        url?: string;
        secret_token?: string;
        /** Telegram 连接 Webhook 时使用的固定来源 IP。 */
        ip_address?: string;
        max_connections?: number;
        drop_pending_updates?: boolean;
        allowed_updates?: ReadonlyArray<TelegramUpdateType>;
    };
    polling?: {
        timeout?: number;
        limit?: number;
        drop_pending_updates?: boolean;
        allowed_updates?: ReadonlyArray<TelegramUpdateType>;
    };
}

// Telegram 用户类型（简化版，grammy 有完整类型）
export interface TelegramUser {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
}

// Telegram 聊天类型
export interface TelegramChat {
    id: number;
    type: "private" | "group" | "supergroup" | "channel";
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
}

// Telegram 回调查询类型
export interface TelegramCallbackQuery {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    inline_message_id?: string;
    chat_instance: string;
    data?: string;
    game_short_name?: string;
}

// Telegram 内联查询类型
export interface TelegramInlineQuery {
    id: string;
    from: TelegramUser;
    query: string;
    offset: string;
    chat_type?: string;
    location?: Location;
}

// Telegram 选择的内联结果类型
export interface TelegramChosenInlineResult {
    result_id: string;
    from: TelegramUser;
    query: string;
    inline_message_id?: string;
    location?: Location;
}

// Telegram 消息类型
export interface TelegramMessage {
    message_id: number;
    from?: TelegramUser;
    date: number;
    /** Guest Mode 查询 ID；回复时交给 answer_guest_query。 */
    guest_query_id?: string;
    chat: TelegramChat;
    text?: string;
    caption?: string;
    photo?: PhotoSize[];
    video?: Video;
    audio?: Audio;
    document?: Document;
    sticker?: Sticker;
    location?: Location;
    contact?: Contact;
    reply_to_message?: TelegramMessage;
    entities?: MessageEntity[];
    caption_entities?: MessageEntity[];
    [key: string]: unknown;
}

// Telegram 更新类型
export interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
    edited_message?: TelegramMessage;
    channel_post?: TelegramMessage;
    edited_channel_post?: TelegramMessage;
    callback_query?: TelegramCallbackQuery;
    inline_query?: TelegramInlineQuery;
    chosen_inline_result?: TelegramChosenInlineResult;
    [key: string]: unknown;
}
