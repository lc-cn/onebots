import { AdapterRegistry, type Schema } from "onebots";

export { WhatsAppAdapter } from "./adapter.js";
export { whatsAppCapabilities } from "./capabilities.js";
export { WhatsAppClient } from "./client.js";
export { WhatsAppApiError, type WhatsAppApiErrorOptions } from "./errors.js";
export { projectMessageContent, projectWhatsAppWebhook } from "./events.js";
export { compileWhatsAppMessages } from "./messages.js";
export {
    executeWhatsAppPlatformAction,
    WHATSAPP_PLATFORM_ACTIONS,
    type WhatsAppPlatformAction,
} from "./platform-actions.js";
export { WhatsAppWebhookHost } from "./webhook-host.js";
export type { WhatsAppHttpContext } from "./webhook-host.js";
export type {
    WhatsAppAPIResponse,
    WhatsAppCallOptions,
    WhatsAppClientEvents,
    WhatsAppConfig,
    WhatsAppContact,
    WhatsAppErrorData,
    WhatsAppMediaInfo,
    WhatsAppMediaObject,
    WhatsAppIngestResult,
    WhatsAppMessageEvent,
    WhatsAppMessageStatus,
    WhatsAppMessageStatusEvent,
    WhatsAppMessageType,
    WhatsAppObservedContact,
    WhatsAppPhoneNumberInfo,
    WhatsAppSendMessageParams,
    WhatsAppWebhookChange,
    WhatsAppWebhookEvent,
    WhatsAppWebhookMetadata,
    WhatsAppWebhookRequest,
    WhatsAppWebhookResponse,
    WhatsAppWebhookValue,
} from "./types.js";

export const whatsappSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内部区分 WhatsApp 号码的稳定标识",
        ui: { section: "credentials" },
    },
    phone_number_id: {
        type: "string",
        required: true,
        label: "Phone Number ID",
        description: "WhatsApp > API Setup 中的 Phone Number ID",
        ui: { section: "credentials" },
    },
    business_account_id: {
        type: "string",
        required: true,
        label: "Business Account ID",
        description: "WhatsApp Business Account ID，用于模板等管理 API",
        ui: { section: "credentials" },
    },
    access_token: {
        type: "string",
        required: true,
        label: "Access Token",
        sensitive: true,
        description: "建议使用系统用户生成的长期访问令牌",
        ui: { section: "credentials" },
    },
    app_secret: {
        type: "string",
        label: "App Secret",
        sensitive: true,
        description: "Meta 应用 Secret，仅用于校验 X-Hub-Signature-256",
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    receive_mode: {
        type: "string",
        default: "webhook",
        label: "事件接收方式",
        choices: [
            { value: "webhook", label: "Webhook" },
            { value: "manual", label: "手动接入既有 Host/队列" },
        ],
        description: "manual 不注册路由，由现有连接调用 ingest()",
        ui: { section: "transport" },
    },
    webhook_verify_token: {
        type: "string",
        label: "Webhook Verify Token",
        sensitive: true,
        description: "自定义随机令牌，须与 Meta Webhook 配置完全一致",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    webhook_path: {
        type: "string",
        label: "Webhook 路径",
        placeholder: "/whatsapp/{account_id}/webhook",
        description: "复用 OneBots 主 HTTP 服务；留空自动生成账号隔离路径",
        pattern: /^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/,
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    api_version: {
        type: "string",
        required: true,
        label: "Graph API 版本",
        description: "按 Meta 应用当前已启用的版本填写，例如 v23.0，避免隐式版本漂移",
        ui: { section: "advanced" },
    },
    api_base_url: {
        type: "string",
        default: "https://graph.facebook.com",
        label: "Graph API Base URL",
        description: "仅官方兼容代理或测试环境需要覆盖，必须使用 HTTPS",
        pattern: /^https:\/\/[^\s/?#]+(?::\d+)?\/?$/,
        ui: { section: "advanced" },
    },
    deduplicate_webhooks: {
        type: "boolean",
        default: true,
        label: "过滤重复 Webhook",
        description: "按原始负载哈希过滤 Meta 重投递",
        ui: { section: "delivery" },
    },
    webhook_deduplication_limit: {
        type: "number",
        default: 10000,
        label: "去重缓存上限",
        description: "进程内保留的最近 Webhook 哈希数量，最低 100",
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("whatsapp", whatsappSchema);
