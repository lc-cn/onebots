import { AdapterRegistry, type Schema } from "onebots";

export { WechatAdapter } from "./adapter.js";
export { wechatCapabilities } from "./capabilities.js";
export { WechatClient, wechatEventId } from "./client.js";
export { assertWechatConfig, requireWechatWebhookConfig } from "./config.js";
export {
    decryptWechatPayload,
    encryptWechatPayload,
    signWechatMessage,
    verifyWechatSignature,
} from "./crypto.js";
export { WechatApiError, type WechatApiErrorOptions } from "./errors.js";
export { projectWechatEvent } from "./events.js";
export { messageMediaType, prepareWechatMediaSegments, uploadWechatMedia } from "./media.js";
export type { WechatMediaType } from "./media.js";
export { compileWechatMessages } from "./messages.js";
export { WECHAT_CUSTOMER_SERVICE_ACTIONS } from "./platform-actions-customer-service.js";
export {
    executeWechatPlatformAction,
    WECHAT_PLATFORM_ACTIONS,
    type WechatPlatformAction,
} from "./platform-actions.js";
export { WechatWebhookHost } from "./webhook-host.js";
export type { WechatHttpContext } from "./webhook-host.js";
export {
    buildEncryptedReply,
    buildPassiveReply,
    parseIncomingMessage,
    parseWechatXml,
} from "./xml.js";
export type {
    WechatApiCallOptions,
    WechatClientEvents,
    WechatConfig,
    WechatIncomingMessage,
    WechatIngressOptions,
    WechatMessageType,
    WechatNamedEvent,
    WechatNewsArticle,
    WechatOutboundMessage,
    WechatTag,
    WechatTemplateMessage,
    WechatUser,
    WechatUserList,
    WechatWebhookRequest,
    WechatWebhookConfig,
    WechatWebhookResponse,
} from "./types.js";

export const wechatSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        min: 1,
        label: "账号标识",
        description: "OneBots 内部区分公众号的稳定标识",
        ui: { section: "credentials" },
    },
    app_id: {
        type: "string",
        required: true,
        min: 1,
        label: "AppID",
        description: "微信公众平台开发设置中的 AppID",
        ui: { section: "credentials" },
    },
    app_secret: {
        type: "string",
        required: true,
        min: 1,
        label: "AppSecret",
        sensitive: true,
        description: "用于换取 access_token，请按敏感凭据保存",
        ui: { section: "credentials" },
    },
    token: {
        type: "string",
        min: 1,
        label: "Webhook Token",
        sensitive: true,
        description: "须与公众平台服务器配置中的 Token 完全一致",
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
        description: "manual 不注册路由，由现有连接调用 WechatClient.ingest()",
        ui: { section: "transport" },
    },
    encoding_aes_key: {
        type: "string",
        min: 43,
        max: 43,
        label: "EncodingAESKey",
        sensitive: true,
        description: "安全模式或兼容模式使用的 43 位消息加解密密钥",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    webhook_path: {
        type: "string",
        label: "Webhook 路径",
        placeholder: "/wechat/{account_id}/webhook",
        description: "复用 OneBots 主 HTTP 服务；留空会按账号自动生成",
        pattern: /^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/,
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    passive_reply_timeout_ms: {
        type: "number",
        default: 4500,
        min: 0,
        max: 4500,
        label: "被动回复等待时间 (ms)",
        description: "等待下游按入站消息 ID 提交 reply 段；范围 0–4500",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    deduplicate_webhooks: {
        type: "boolean",
        default: true,
        label: "过滤重复事件",
        description: "Webhook 与 manual 接入统一按稳定事件身份过滤重投递",
        ui: { section: "delivery" },
    },
    webhook_deduplication_limit: {
        type: "number",
        default: 10000,
        min: 100,
        label: "去重缓存上限",
        description: "Client 进程内保留的最近事件 ID 数量，最低 100",
        ui: { section: "advanced" },
    },
    api_base_url: {
        type: "string",
        default: "https://api.weixin.qq.com",
        label: "API Base URL",
        description: "仅官方兼容代理或测试环境需要覆盖，必须使用 HTTPS",
        pattern: /^https:\/\/[^\s?#]+$/,
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("wechat", wechatSchema);
