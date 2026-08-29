import { AdapterRegistry } from "onebots";
import type { Schema } from "onebots";
import { DISCORD_GATEWAY_INTENTS } from "./types.js";
import { DEFAULT_DISCORD_INTENTS } from "./intents.js";

// 导出类型
export type { DiscordConfig, ProxyConfig, GatewayIntentName, PresenceStatus } from "./types.js";
export { ChannelType, MessageType, ActivityType } from "./types.js";
export { DISCORD_GATEWAY_INTENTS } from "./types.js";
export { DEFAULT_DISCORD_INTENTS, resolveDiscordIntents } from "./intents.js";

// 导出 Discord API 类型
export type {
    DiscordApiUser,
    DiscordApiMessage,
    DiscordApiAttachment,
    DiscordApiChannel,
    DiscordApiGuild,
    DiscordApiGuildMember,
    DiscordRole,
    DiscordEmbed,
    DiscordInteraction,
    DiscordInteractionResponse,
    CreateMessageBody,
    EditMessageBody,
    GatewayQueryOptions,
    GatewayMemberQueryOptions,
} from "./types.js";

// 导出适配器
export * from "./adapter.js";
export * from "./capabilities.js";

// 导出 Bot 类型（Bot 类为内部实现）
export type {
    DiscordUser,
    DiscordMessage,
    DiscordGuild,
    DiscordChannel,
    DiscordMember,
    DiscordAttachment,
} from "./bot.js";

// 导出轻量版客户端（用于独立使用或 Serverless）
export * from "./lite/index.js";

export const discordSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        ui: { section: "credentials" },
    },
    token: {
        type: "string",
        required: true,
        label: "Bot Token",
        sensitive: true,
        ui: { section: "credentials" },
    },
    proxy: {
        url: {
            type: "string",
            label: "代理地址",
            placeholder: "http://127.0.0.1:7890",
            pattern: /^https?:\/\/[^\s]+$/,
            ui: { section: "advanced" },
        },
        username: { type: "string", label: "代理用户名", ui: { section: "advanced" } },
        password: {
            type: "string",
            label: "代理密码",
            sensitive: true,
            ui: { section: "advanced" },
        },
    },
    intents: {
        type: "array",
        default: [...DEFAULT_DISCORD_INTENTS],
        label: "Gateway Intents",
        description: "仅选择机器人已在 Developer Portal 开通的特权 Intent",
        choices: DISCORD_GATEWAY_INTENTS.map(value => ({ value, label: value })),
        ui: { widget: "choice-list", section: "filter" },
    },
    presence: {
        status: {
            type: "string",
            label: "状态",
            ui: { section: "delivery" },
            choices: [
                { value: "online", label: "在线" },
                { value: "idle", label: "闲置" },
                { value: "dnd", label: "请勿打扰" },
                { value: "invisible", label: "隐身" },
            ],
        },
        activities: {
            type: "array",
            label: "活动列表",
            description: "高级 JSON：每项包含 name、type，可选 url",
            ui: { section: "advanced" },
        },
    },
};

AdapterRegistry.registerSchema("discord", discordSchema);
