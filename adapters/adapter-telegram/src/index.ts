// 导出类型
import { AdapterRegistry } from "onebots";
import type { Schema } from "onebots";
import { TELEGRAM_UPDATE_TYPES } from "./types.js";

export type {
    TelegramConfig,
    TelegramReceiveMode,
    TelegramUpdateType,
    ProxyConfig,
} from "./types.js";
export { TELEGRAM_UPDATE_TYPES } from "./types.js";
export { resolveTelegramReceiveConfig, type TelegramReceiveConfig } from "./receive-config.js";
export { TelegramBot, type TelegramBotEvents } from "./bot.js";
export { TelegramError, type TelegramErrorOptions } from "./errors.js";
export { projectTelegramEvents, type TelegramEventProjectorContext } from "./events.js";
export { TELEGRAM_BOT_ACTIONS } from "./platform-actions-bot.js";
export { TELEGRAM_CHAT_ACTIONS } from "./platform-actions-chat.js";
export { TELEGRAM_INTERACTION_ACTIONS } from "./platform-actions-interaction.js";
export {
    TELEGRAM_PLATFORM_ACTIONS,
    executeTelegramPlatformAction,
    type TelegramPlatformAction,
} from "./platform-actions.js";
export * from "./adapter.js";
export * from "./capabilities.js";
export { acceptTelegramHttp, ingestTelegramHttp, type TelegramHttpResult } from "./webhook.js";

export const telegramSchema: Schema = {
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
        default: "polling",
        label: "事件接收方式",
        choices: [
            { value: "polling", label: "长轮询" },
            { value: "webhook", label: "Webhook" },
            { value: "manual", label: "手动接入已有连接" },
        ],
        description: "manual 不创建连接或路由，由现有 Host/消息队列调用 ingest()",
        ui: { section: "transport" },
    },
    proxy: {
        url: {
            type: "string",
            label: "代理地址",
            placeholder: "http://127.0.0.1:7890",
            pattern: /^(?:https?|socks[45]):\/\/[^\s]+$/,
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
    webhook: {
        url: {
            type: "string",
            label: "Webhook URL",
            placeholder: "https://bot.example.com/telegram/{account_id}/webhook",
            pattern: /^https:\/\/[^\s]+$/,
            ui: {
                section: "transport",
                visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
            },
        },
        secret_token: {
            type: "string",
            label: "Webhook 密钥",
            sensitive: true,
            description: "Webhook 模式必填；Telegram 将通过请求头回传此随机字符串",
            ui: {
                section: "credentials",
                visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
            },
        },
        ip_address: {
            type: "string",
            label: "Webhook 来源 IP",
            description: "可选；要求 Telegram 固定从该 IPv4/IPv6 地址连接",
            ui: {
                section: "advanced",
                visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
            },
        },
        max_connections: {
            type: "number",
            min: 1,
            max: 100,
            default: 40,
            label: "Webhook 最大连接数",
            ui: {
                section: "advanced",
                visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
            },
        },
        drop_pending_updates: {
            type: "boolean",
            default: false,
            label: "丢弃待处理更新",
            description: "注册 Webhook 时清空 Telegram 服务端积压的 Update",
            ui: {
                section: "advanced",
                visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
            },
        },
        allowed_updates: {
            type: "array",
            default: [...TELEGRAM_UPDATE_TYPES],
            label: "Webhook 更新类型",
            choices: TELEGRAM_UPDATE_TYPES.map(value => ({ value, label: value })),
            ui: {
                widget: "choice-list",
                section: "filter",
                visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
            },
        },
    },
    polling: {
        drop_pending_updates: {
            type: "boolean",
            default: false,
            label: "丢弃待处理更新",
            description: "切换到长轮询时清除旧 Webhook，并可同时清空积压 Update",
            ui: {
                section: "advanced",
                visibleWhen: { path: "receive_mode", oneOf: ["polling"] },
            },
        },
        timeout: {
            type: "number",
            min: 1,
            max: 50,
            default: 30,
            label: "轮询超时（秒）",
            ui: {
                section: "transport",
                visibleWhen: { path: "receive_mode", oneOf: ["polling"] },
            },
        },
        limit: {
            type: "number",
            min: 1,
            max: 100,
            default: 100,
            label: "每批更新数",
            ui: {
                section: "transport",
                visibleWhen: { path: "receive_mode", oneOf: ["polling"] },
            },
        },
        allowed_updates: {
            type: "array",
            default: [...TELEGRAM_UPDATE_TYPES],
            label: "轮询更新类型",
            choices: TELEGRAM_UPDATE_TYPES.map(value => ({ value, label: value })),
            ui: {
                widget: "choice-list",
                section: "filter",
                visibleWhen: { path: "receive_mode", oneOf: ["polling"] },
            },
        },
    },
};

AdapterRegistry.registerSchema("telegram", telegramSchema);
