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
export type QQReceiveMode = "websocket" | "webhook";

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

export interface QQMessagePayload extends Omit<SendMessageOptions, "target"> {
    keyboard?: InlineKeyboard;
}

export type QQRawMessage = QQBotInboundMessage;

export function resolveIntentMask(intents: readonly QQIntent[] | undefined): number | undefined {
    if (!intents?.length) return undefined;
    return intents.reduce((mask, intent) => mask + QQ_INTENTS[intent], 0);
}
