import { AdapterRegistry, type Schema } from "onebots";

export { KookApiError, KookError } from "./errors.js";
export { assertKookConfig } from "./config.js";
export { KookWebhookReceiver, type KookIngestResult } from "./webhook.js";
export { KookRestClient, type KookBinaryResult, type KookHttpTransport } from "./rest-client.js";
export { KookBot, type KookBotEvents } from "./bot.js";
export type { KookConfig, KookEvent, KookApiRequestOptions } from "./types.js";
export * from "./adapter.js";
export * from "./capabilities.js";
export {
    KOOK_PLATFORM_ACTIONS,
    executeKookPlatformAction,
    type KookPlatformAction,
} from "./platform-actions.js";

export const kookSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内部区分 KOOK 机器人连接的稳定标识",
        ui: { section: "credentials" },
    },
    token: {
        type: "string",
        required: true,
        label: "Bot Token",
        sensitive: true,
        description: "KOOK 开发者中心「机器人」页面生成的 Token",
        ui: { section: "credentials" },
    },
    receive_mode: {
        type: "string",
        default: "gateway",
        label: "事件接收方式",
        choices: [
            { value: "gateway", label: "Gateway 长连接（推荐）" },
            { value: "webhook", label: "HTTP Webhook" },
            { value: "manual", label: "手动接入既有连接" },
        ],
        description: "manual 不创建事件连接或路由，由现有 Host/消息队列调用 ingest()",
        ui: { section: "transport" },
    },
    verify_token: {
        type: "string",
        label: "Webhook Verify Token",
        sensitive: true,
        description: "仅 Webhook 模式使用，必须与开发者中心回调配置一致",
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    encrypt_key: {
        type: "string",
        label: "Webhook Encrypt Key",
        sensitive: true,
        description: "仅在开发者中心启用 Webhook 加密时填写",
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    api_base_url: {
        type: "string",
        label: "API Base URL",
        default: "https://www.kookapp.cn/api",
        placeholder: "https://www.kookapp.cn/api",
        pattern: /^https:\/\/[^\s?#]+$/,
        description: "高级用途；默认直接连接 KOOK 官方 API",
        ui: { section: "advanced" },
    },
    max_retries: {
        type: "number",
        min: 0,
        max: 10,
        default: 3,
        label: "REST 限流重试次数",
        description: "收到 KOOK 429 后按官方限流响应头等待并重试",
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("kook", kookSchema);
