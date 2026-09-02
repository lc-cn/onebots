import { AdapterRegistry, type Schema } from "onebots";
import { InstagramAdapter } from "./adapter.js";
import {
    INSTAGRAM_EVENT_TYPES,
    INSTAGRAM_WEBHOOK_FIELDS,
    instagramCapabilities,
} from "./capabilities.js";
import type { InstagramConfig } from "./types.js";

export { InstagramAdapter };
export { InstagramClient, type InstagramClientDependencies } from "./client.js";
export {
    describeInstagramCapabilities,
    INSTAGRAM_EVENT_TYPES,
    INSTAGRAM_WEBHOOK_FIELDS,
    instagramCapabilities,
} from "./capabilities.js";
export { InstagramError } from "./errors.js";
export { projectInstagramEvent } from "./events.js";
export {
    compileInstagramMessage,
    projectApiMessage,
    projectWebhookMessage,
    type InstagramAttachmentUploader,
} from "./messages.js";
export {
    executeInstagramPlatformAction,
    INSTAGRAM_PLATFORM_ACTIONS,
    type InstagramPlatformAction,
} from "./platform-actions.js";
export { InstagramWebhookCodec } from "./webhook-codec.js";
export type {
    InstagramApiMessage,
    InstagramAttachment,
    InstagramBusinessProfile,
    InstagramCallOptions,
    InstagramClientEvents,
    InstagramConfig,
    InstagramConversation,
    InstagramDelivery,
    InstagramEvent,
    InstagramEventType,
    InstagramGraphMethod,
    InstagramHttpRequest,
    InstagramHttpResponse,
    InstagramIngestResult,
    InstagramMessage,
    InstagramMessagingItem,
    InstagramOutgoingMessage,
    InstagramReceiveMode,
    InstagramSendResponse,
    InstagramUserProfile,
    InstagramWebhookEnvelope,
} from "./types.js";

const INSTAGRAM_PERMISSIONS = [
    "instagram_business_basic",
    "instagram_business_manage_messages",
    "instagram_business_manage_comments",
    "Human Agent",
] as const;

export const instagramSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内区分 Instagram Professional Account 的稳定标识",
        ui: { section: "credentials" },
    },
    instagram_user_id: {
        type: "string",
        required: true,
        label: "Instagram User ID",
        pattern: /^\d+$/,
        description: "Instagram Professional Account 的 Meta ID，不是 username",
        ui: { section: "credentials" },
    },
    access_token: {
        type: "string",
        required: true,
        label: "Instagram User Access Token",
        sensitive: true,
        description: "使用 Business Login for Instagram 签发；无需关联 Facebook Page",
        ui: { section: "credentials" },
    },
    app_secret: {
        type: "string",
        label: "Meta App Secret",
        sensitive: true,
        description: "Webhook 签名校验必需，也用于 Graph appsecret_proof",
        ui: { section: "credentials" },
    },
    verify_token: {
        type: "string",
        label: "Webhook Verify Token",
        sensitive: true,
        description: "与 Meta App Dashboard 中填写的自定义验证令牌完全一致",
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    declared_permissions: {
        type: "array",
        label: "已授予权限与功能",
        choices: INSTAGRAM_PERMISSIONS.map(value => ({ value, label: value })),
        allowCustomValues: true,
        description: "用于动态收敛 Web 能力展示；Human Agent 是需单独审核的平台功能",
        ui: {
            widget: "choice-list",
            section: "credentials",
            itemLabel: "Permission / feature",
            addLabel: "添加权限",
        },
    },
    receive_mode: {
        type: "string",
        default: "webhook",
        label: "事件接收方式",
        choices: [
            { value: "webhook", label: "Meta Webhook（挂载已有 Host）" },
            { value: "manual", label: "手动 ingest(rawEvent)" },
        ],
        description: "两种方式共用同一个 Client、严格解析、去重与 canonical 投影",
        ui: { section: "transport" },
    },
    http_path: {
        type: "string",
        label: "Webhook 挂载路径",
        placeholder: "/instagram/{account_id}/events",
        pattern: /^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/,
        description: "留空使用账号隔离路径；适配器不会另开监听端口",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    auto_subscribe: {
        type: "boolean",
        default: false,
        label: "启动时订阅 Professional Account",
        description: "调用 /{ig-user-id}/subscribed_apps",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    subscribed_fields: {
        type: "array",
        default: ["messages", "messaging_postbacks", "messaging_seen", "message_reactions"],
        label: "Webhook Fields",
        choices: INSTAGRAM_WEBHOOK_FIELDS.map(value => ({ value, label: value })),
        description: "可逐项增减，并同步收敛账号实际能力；无需手写 JSON",
        ui: {
            widget: "choice-list",
            section: "transport",
            itemLabel: "Webhook field",
            addLabel: "添加 field",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    event_types: {
        type: "array",
        default: [...INSTAGRAM_EVENT_TYPES],
        label: "接收事件",
        choices: INSTAGRAM_EVENT_TYPES.map(value => ({ value, label: value })),
        description: "在 batch 展开后过滤；已接收事件仍完整保留原始 envelope",
        ui: {
            widget: "choice-list",
            section: "filter",
            itemLabel: "Instagram 事件",
            addLabel: "添加事件",
        },
    },
    api_version: {
        type: "string",
        default: "v25.0",
        label: "Graph API Version",
        pattern: /^v\d+\.\d+$/,
        ui: { section: "advanced" },
    },
    api_origin: {
        type: "string",
        default: "https://graph.instagram.com",
        label: "Graph API Origin",
        description: "仅代理、测试或私有网关需要修改；生产应保持官方 HTTPS host",
        ui: { section: "advanced" },
    },
    max_body_bytes: {
        type: "number",
        default: 10485760,
        min: 1,
        max: 52428800,
        label: "Webhook Body 上限（bytes）",
        ui: {
            section: "advanced",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
};

AdapterRegistry.registerSchema("instagram", instagramSchema);

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            instagram: InstagramConfig;
        }
    }
}

AdapterRegistry.register("instagram", InstagramAdapter, {
    name: "instagram",
    displayName: "Instagram Messaging",
    description: "Instagram Login、Send、Conversations、Profile、Webhook 与平台扩展适配器",
    icon: "https://static.cdninstagram.com/rsrc.php/v4/yR/r/lam-fZmwmvn.png",
    homepage: "https://www.postman.com/meta/instagram/overview",
    author: "凉菜",
    capabilities: instagramCapabilities,
});
