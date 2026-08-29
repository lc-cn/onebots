import { AdapterRegistry, type Schema } from "onebots";

export { KookApiError } from "./bot.js";
export type { KookConfig, KookEvent, KookApiRequestOptions } from "./types.js";
export * from "./adapter.js";
export * from "./capabilities.js";

const kookSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内部区分 KOOK 机器人连接的稳定标识",
    },
    token: {
        type: "string",
        required: true,
        label: "Bot Token",
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
        ],
        description: "Gateway 无需公网地址且默认无限重连；Webhook 适合已有 HTTP 网关",
        ui: { section: "transport" },
    },
    verify_token: {
        type: "string",
        label: "Webhook Verify Token",
        description: "仅 Webhook 模式使用，必须与开发者中心回调配置一致",
        ui: { section: "credentials" },
    },
    encrypt_key: {
        type: "string",
        label: "Webhook Encrypt Key",
        description: "仅在开发者中心启用 Webhook 加密时填写",
        ui: { section: "credentials" },
    },
    api_base_url: {
        type: "string",
        label: "API Base URL",
        default: "https://www.kookapp.cn/api",
        placeholder: "https://www.kookapp.cn/api",
        description: "高级用途；默认直接连接 KOOK 官方 API",
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("kook", kookSchema);
