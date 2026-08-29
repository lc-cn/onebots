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
export * from "./adapter.js";
export * from "./capabilities.js";

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
        ],
        ui: { section: "transport" },
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
            description: "Telegram 将通过请求头回传此值；建议使用随机字符串",
            ui: {
                section: "credentials",
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
