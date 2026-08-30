import type {
    InlineKeyboard,
    QQBotInboundMessage,
    SendMessageOptions,
} from "@tencent-connect/qqbot-nodejs";

export const QQ_INTENTS = {
    GUILDS: 1,
    GUILD_MEMBERS: 2,
    GUILD_MESSAGES: 512,
    GUILD_MESSAGE_REACTIONS: 1024,
    DIRECT_MESSAGE: 4096,
    GROUP_MEMBER: 16777216,
    GROUP_AND_C2C_EVENT: 33554432,
    INTERACTION: 67108864,
    MESSAGE_AUDIT: 134217728,
    FORUMS_EVENT: 268435456,
    AUDIO_ACTION: 536870912,
    PUBLIC_GUILD_MESSAGES: 1073741824,
} as const;

export type QQIntent = keyof typeof QQ_INTENTS;
export type QQReceiveMode = "websocket" | "webhook" | "manual";

export interface QQConfig {
    account_id: string;
    appid: string;
    secret: string;
    receive_mode?: QQReceiveMode;
    intents?: QQIntent[];
    markdown_support?: boolean;
    api_base_url?: string;
    token_base_url?: string;
    webhook_path?: string;
}

export interface QQPlatformCall {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    query?: Record<string, string | number | boolean>;
    body?: unknown;
}

/** QQ OpenAPI 返回的当前机器人身份。 */
export interface QQUser {
    id: string;
    username?: string;
    avatar?: string;
}

export interface QQMessagePayload extends Omit<SendMessageOptions, "target"> {
    keyboard?: InlineKeyboard;
}

/** 官方 SDK 对 Gateway 消息的归一化视图。 */
export type QQInboundMessage = QQBotInboundMessage;

/** QQ Gateway 未归一化的原始消息载荷，对应 CommonEvent.raw_event。 */
export type QQRawMessage = QQBotInboundMessage["raw"];

export function resolveIntentMask(intents: readonly QQIntent[] | undefined): number | undefined {
    if (!intents?.length) return undefined;
    // Intent 是位标志。使用按位并集可保证重复配置不会改变最终权限集合。
    return intents.reduce((mask, intent) => mask | QQ_INTENTS[intent], 0);
}
