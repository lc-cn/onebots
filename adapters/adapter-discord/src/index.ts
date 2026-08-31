import { AdapterRegistry } from "onebots";
import type { Schema } from "onebots";
import { DISCORD_GATEWAY_INTENTS } from "./types.js";
import { DEFAULT_DISCORD_INTENTS } from "./intents.js";

// 导出类型
export type { DiscordConfig, ProxyConfig, GatewayIntentName, PresenceStatus } from "./types.js";
export { ChannelType, MessageType, ActivityType } from "./types.js";
export { DISCORD_GATEWAY_INTENTS } from "./types.js";
export { DEFAULT_DISCORD_INTENTS, resolveDiscordIntents } from "./intents.js";
export { DiscordError, type DiscordErrorOptions } from "./errors.js";
export {
    DISCORD_PLATFORM_ACTIONS,
    executeDiscordPlatformAction,
    type DiscordPlatformAction,
} from "./platform-actions.js";
export {
    projectDiscordEvents,
    projectDiscordMessageSegments,
    type DiscordDispatchEvent,
    type DiscordIdContext,
    type DiscordProjectorContext,
} from "./events.js";

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
export { compileDiscordMessage, type CompiledDiscordMessage } from "./messages.js";
export { materializeDiscordFile, type DiscordFileInput, type DiscordUpload } from "./media.js";

// 导出 Bot 类型（Bot 类为内部实现）
export type {
    DiscordUser,
    DiscordMessage,
    DiscordGuild,
    DiscordChannel,
    DiscordMember,
    DiscordAttachment,
} from "./bot.js";
export type { DiscordBotEvents } from "./bot-events.js";

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
    receive_mode: {
        type: "string",
        default: "gateway",
        label: "事件接收方式",
        choices: [
            { value: "gateway", label: "Gateway WebSocket" },
            { value: "interactions", label: "Interactions Webhook" },
            { value: "webhook_events", label: "Webhook Events" },
            { value: "manual", label: "手动接入已验签事件" },
        ],
        description:
            "Gateway 接收实时事件；Interactions 接收交互；Webhook Events 接收应用事件；HTTP 模式均复用 OneBots Host",
        ui: { section: "transport" },
    },
    application_id: {
        type: "string",
        label: "Application ID",
        placeholder: "Discord Developer Portal 中的 Application ID",
        ui: {
            section: "credentials",
            visibleWhen: {
                path: "receive_mode",
                oneOf: ["interactions", "webhook_events"],
            },
        },
    },
    public_key: {
        type: "string",
        label: "Application Public Key",
        pattern: /^[\da-f]{64}$/i,
        placeholder: "64 位十六进制公钥",
        ui: {
            section: "credentials",
            visibleWhen: {
                path: "receive_mode",
                oneOf: ["interactions", "webhook_events"],
            },
        },
    },
    proxy: {
        url: {
            type: "string",
            label: "代理地址",
            placeholder: "http://127.0.0.1:7890",
            pattern: /^(?:https?|socks[45]?):\/\/[^\s]+$/,
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
        description:
            "按需订阅 Gateway 事件；GuildMembers、GuildPresences、MessageContent 需先在 Developer Portal 开启",
        choices: DISCORD_GATEWAY_INTENTS.map(value => ({ value, label: value })),
        ui: {
            widget: "choice-list",
            section: "filter",
            visibleWhen: { path: "receive_mode", oneOf: ["gateway"] },
        },
    },
    shard: {
        id: {
            type: "number",
            min: 0,
            label: "当前分片编号",
            description: "从 0 开始；单分片机器人无需填写",
            ui: {
                section: "delivery",
                visibleWhen: { path: "receive_mode", oneOf: ["gateway"] },
            },
        },
        total: {
            type: "number",
            min: 1,
            label: "分片总数",
            description: "必须与 Developer Portal 和其他进程的分片规划一致",
            ui: {
                section: "delivery",
                visibleWhen: { path: "receive_mode", oneOf: ["gateway"] },
            },
        },
    },
    presence: {
        status: {
            type: "string",
            label: "状态",
            ui: {
                section: "delivery",
                visibleWhen: { path: "receive_mode", oneOf: ["gateway"] },
            },
            choices: [
                { value: "online", label: "在线" },
                { value: "idle", label: "闲置" },
                { value: "dnd", label: "请勿打扰" },
                { value: "invisible", label: "隐身" },
            ],
        },
        since: {
            type: "number",
            min: 0,
            label: "闲置起始时间",
            description: "Unix 毫秒时间戳；留空表示当前未闲置",
            ui: {
                section: "advanced",
                visibleWhen: { path: "receive_mode", oneOf: ["gateway"] },
            },
        },
        afk: {
            type: "boolean",
            default: false,
            label: "AFK",
            ui: {
                section: "delivery",
                visibleWhen: { path: "receive_mode", oneOf: ["gateway"] },
            },
        },
        activities: {
            type: "array",
            label: "活动列表",
            description: "可动态增减；Streaming 类型可额外填写直播 URL",
            ui: {
                section: "delivery",
                widget: "record-list",
                itemLabel: "活动",
                addLabel: "添加活动",
                visibleWhen: { path: "receive_mode", oneOf: ["gateway"] },
                fields: [
                    { key: "name", label: "活动名称", placeholder: "正在使用 OneBots" },
                    {
                        key: "type",
                        label: "活动类型编号",
                        type: "number",
                        description: "0 游戏、1 直播、2 收听、3 观看、4 自定义、5 竞赛",
                    },
                    { key: "url", label: "直播 URL", placeholder: "https://twitch.tv/..." },
                    { key: "state", label: "自定义状态文本" },
                ],
            },
        },
    },
};

AdapterRegistry.registerSchema("discord", discordSchema);
