import { AdapterRegistry, type Schema } from "onebots";

export { WeComAdapter } from "./adapter.js";
export { weComCapabilities } from "./capabilities.js";
export { WeComClient } from "./client.js";
export { WECOM_CUSTOMER_ENGAGEMENT_ACTIONS } from "./customer-engagement-actions.js";
export { WeComApiError, type WeComApiErrorOptions } from "./errors.js";
export { projectWeComEvent, projectWeComSegments } from "./events.js";
export { WECOM_EXTERNAL_CONTACT_ACTIONS } from "./external-contact-actions.js";
export { prepareWeComMediaSegments, uploadWeComMedia, weComMediaType } from "./media.js";
export type { WeComMediaType } from "./media.js";
export { compileWeComMessages } from "./messages.js";
export type { WeComOutboundMessage } from "./messages.js";
export {
    executeWeComPlatformAction,
    WECOM_PLATFORM_ACTIONS,
    type WeComPlatformAction,
} from "./platform-actions.js";
export type { WeComActionParams } from "./platform-action-context.js";
export { WeComWebhookHost, weComEventId } from "./webhook-host.js";
export type { WeComHttpContext } from "./webhook-host.js";
export type {
    WeComAgent,
    WeComAPIResponse,
    WeComAppChat,
    WeComCallOptions,
    WeComClientEvents,
    WeComConfig,
    WeComDepartment,
    WeComEvent,
    WeComIngestResult,
    WeComNamedEvent,
    WeComSendMessageRequest,
    WeComSendMessageResponse,
    WeComUser,
    WeComWebhookRequest,
    WeComWebhookResponse,
} from "./types.js";

export const wecomSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        min: 1,
        label: "账号标识",
        description: "OneBots 内部区分企业应用的稳定标识",
        ui: { section: "credentials" },
    },
    corp_id: {
        type: "string",
        required: true,
        min: 1,
        label: "CorpID",
        description: "企业信息页的企业 ID，也是回调解密后的 receiveid 校验值",
        ui: { section: "credentials" },
    },
    corp_secret: {
        type: "string",
        required: true,
        min: 1,
        label: "应用 Secret",
        description: "自建应用详情中的 Secret",
        sensitive: true,
        ui: { section: "credentials" },
    },
    agent_id: {
        type: "string",
        required: true,
        min: 1,
        label: "AgentID",
        description: "自建应用的数字 AgentID",
        ui: { section: "credentials" },
    },
    token: {
        type: "string",
        min: 1,
        label: "回调 Token",
        description: "须与企业微信接收消息配置完全一致",
        sensitive: true,
        ui: {
            section: "transport",
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
    encoding_aes_key: {
        type: "string",
        min: 43,
        max: 43,
        label: "EncodingAESKey",
        description: "企业微信加密回调的 43 位密钥",
        sensitive: true,
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    webhook_path: {
        type: "string",
        label: "Webhook 路径",
        placeholder: "/wecom/{account_id}/webhook",
        description: "复用 OneBots 主 HTTP 服务；留空按账号自动生成",
        pattern: /^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/,
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    deduplicate_webhooks: {
        type: "boolean",
        default: true,
        label: "过滤重复 Webhook",
        description: "按 MsgId 或事件复合键过滤企业微信重试",
        ui: { section: "delivery" },
    },
    webhook_deduplication_limit: {
        type: "number",
        default: 10000,
        min: 100,
        label: "去重缓存上限",
        description: "进程内最近事件 ID 数量",
        ui: { section: "advanced" },
    },
    api_base_url: {
        type: "string",
        default: "https://qyapi.weixin.qq.com",
        label: "API Base URL",
        description: "仅官方兼容 HTTPS 代理或测试入口需要覆盖",
        pattern: /^https:\/\/[^\s?#]+$/,
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("wecom", wecomSchema);
