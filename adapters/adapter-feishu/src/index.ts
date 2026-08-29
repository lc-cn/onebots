// 导出类型和常量
import { AdapterRegistry } from "onebots";
import type { Schema } from "onebots";
import { FeishuEndpoint } from "./types.js";

export {
    FeishuEndpoint,
    type FeishuApiEnvelope,
    type FeishuApiRequestOptions,
    type FeishuConfig,
    type FeishuEndpointType,
    type FeishuReceiveIdType,
    type FeishuReceiveMode,
} from "./types.js";
export * from "./adapter.js";
export * from "./capabilities.js";
export { FeishuError, type FeishuErrorOptions } from "./errors.js";
export { FeishuBot, type FeishuBotEvents } from "./bot.js";
export { compileFeishuMessage, type CompiledFeishuMessage } from "./messages.js";
export {
    FEISHU_PLATFORM_ACTIONS,
    executeFeishuPlatformAction,
    type FeishuPlatformAction,
} from "./platform-actions.js";

export const feishuSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内部区分飞书/Lark 连接的稳定标识",
        ui: { section: "credentials" },
    },
    app_id: {
        type: "string",
        required: true,
        label: "App ID",
        placeholder: "cli_…",
        ui: { section: "credentials" },
    },
    app_secret: {
        type: "string",
        required: true,
        label: "App Secret",
        sensitive: true,
        ui: { section: "credentials" },
    },
    receive_mode: {
        type: "string",
        default: "long_connection",
        label: "事件接收方式",
        choices: [
            { value: "long_connection", label: "官方长连接（推荐）" },
            { value: "webhook", label: "Webhook" },
            { value: "manual", label: "手动接入已有连接" },
        ],
        description: "manual 不创建连接或路由，由现有 Host/消息队列调用 ingest()",
        ui: { section: "transport" },
    },
    encrypt_key: {
        type: "string",
        label: "事件加密 Key",
        sensitive: true,
        description: "Webhook 加密推送开启后必须配置",
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    verification_token: {
        type: "string",
        label: "事件验证 Token",
        sensitive: true,
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    endpoint: {
        type: "string",
        label: "API 端点",
        placeholder: FeishuEndpoint.FEISHU,
        pattern: /^https:\/\/[^\s?#]+$/,
        description: `国内版使用 ${FeishuEndpoint.FEISHU}，国际版使用 ${FeishuEndpoint.LARK}`,
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("feishu", feishuSchema);
