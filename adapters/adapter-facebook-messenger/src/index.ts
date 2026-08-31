import { AdapterRegistry, type Schema } from "onebots";
import { FacebookMessengerAdapter } from "./adapter.js";
import {
    FACEBOOK_MESSENGER_EVENT_TYPES,
    FACEBOOK_MESSENGER_WEBHOOK_FIELDS,
    facebookMessengerCapabilities,
} from "./capabilities.js";
import type { FacebookMessengerConfig } from "./types.js";

export { FacebookMessengerAdapter };
export { FacebookMessengerClient, type FacebookMessengerClientDependencies } from "./client.js";
export {
    FACEBOOK_MESSENGER_EVENT_TYPES,
    FACEBOOK_MESSENGER_WEBHOOK_FIELDS,
    describeFacebookMessengerCapabilities,
    facebookMessengerCapabilities,
} from "./capabilities.js";
export { FacebookMessengerError } from "./errors.js";
export {
    compileMessengerMessage,
    projectApiMessage,
    projectWebhookMessage,
    type MessengerAttachmentUploader,
} from "./messages.js";
export { projectFacebookMessengerEvent } from "./events.js";
export { FacebookMessengerWebhookCodec } from "./webhook-codec.js";
export {
    executeFacebookMessengerPlatformAction,
    FACEBOOK_MESSENGER_PLATFORM_ACTIONS,
} from "./platform-actions.js";
export type {
    FacebookMessengerCallOptions,
    FacebookMessengerClientEvents,
    FacebookMessengerConfig,
    FacebookMessengerDelivery,
    FacebookMessengerDefaultMessagingType,
    FacebookMessengerEvent,
    FacebookMessengerEventType,
    FacebookMessengerHttpRequest,
    FacebookMessengerHttpResponse,
    FacebookMessengerIngestResult,
    FacebookMessengerMessagingType,
    FacebookMessengerReceiveMode,
    FacebookMessengerSenderAction,
    MessengerApiMessage,
    MessengerAttachment,
    MessengerConversation,
    MessengerMessage,
    MessengerMessagingItem,
    MessengerOutgoingMessage,
    MessengerPageProfile,
    MessengerSendResponse,
    MessengerUserProfile,
    MessengerWebhookEnvelope,
} from "./types.js";

const MESSENGER_PERMISSIONS = [
    "pages_messaging",
    "pages_manage_metadata",
    "pages_read_engagement",
    "page_utility_messaging",
] as const;

export const facebookMessengerSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内区分 Facebook Page 的稳定标识",
        ui: { section: "credentials" },
    },
    page_id: {
        type: "string",
        required: true,
        label: "Facebook Page ID",
        pattern: /^\d+$/,
        ui: { section: "credentials" },
    },
    page_access_token: {
        type: "string",
        required: true,
        label: "Page Access Token",
        sensitive: true,
        description: "需由具备 MESSAGING 或 MODERATE Page task 的身份签发",
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
        label: "已授予 Page Permissions",
        choices: MESSENGER_PERMISSIONS.map(value => ({ value, label: value })),
        allowCustomValues: true,
        description: "用于动态收敛 Web 能力展示；不声明时以运行时 Graph 权限为准",
        ui: {
            widget: "choice-list",
            section: "credentials",
            itemLabel: "Permission",
            addLabel: "添加 Permission",
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
        placeholder: "/facebook-messenger/{account_id}/events",
        pattern: /^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/,
        description: "留空使用账号隔离路径；不会另开监听端口",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    auto_subscribe: {
        type: "boolean",
        default: false,
        label: "启动时订阅 Page",
        description: "调用 /{page-id}/subscribed_apps；需要 pages_manage_metadata",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    subscribed_fields: {
        type: "array",
        default: ["messages", "message_deliveries", "message_reads", "messaging_postbacks"],
        label: "Webhook Fields",
        choices: FACEBOOK_MESSENGER_WEBHOOK_FIELDS.map(value => ({ value, label: value })),
        description: "生成订阅调用并动态收敛能力；Web 表单可逐项增减，无需手写 JSON",
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
        default: [...FACEBOOK_MESSENGER_EVENT_TYPES],
        label: "接收事件",
        choices: FACEBOOK_MESSENGER_EVENT_TYPES.map(value => ({ value, label: value })),
        description: "在 batch 展开后过滤；原始 envelope 仍保留在每个已接收事件中",
        ui: {
            widget: "choice-list",
            section: "filter",
            itemLabel: "Messenger 事件",
            addLabel: "添加事件",
        },
    },
    default_messaging_type: {
        type: "string",
        default: "RESPONSE",
        label: "默认 Messaging Type",
        choices: [
            { value: "RESPONSE", label: "RESPONSE（标准回复）" },
            { value: "UPDATE", label: "UPDATE（非营销更新）" },
            { value: "MESSAGE_TAG", label: "MESSAGE_TAG（获准标签）" },
        ],
        ui: { section: "delivery" },
    },
    default_message_tag: {
        type: "string",
        label: "默认 Message Tag",
        description: "仅填已获 Meta 批准且符合使用场景的标签",
        ui: {
            section: "delivery",
            visibleWhen: { path: "default_messaging_type", oneOf: ["MESSAGE_TAG"] },
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
        default: "https://graph.facebook.com",
        label: "Graph API Origin",
        description: "仅代理、测试或私有网关需要修改；生产必须 HTTPS",
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

AdapterRegistry.registerSchema("facebook-messenger", facebookMessengerSchema);

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            "facebook-messenger": FacebookMessengerConfig;
        }
    }
}

AdapterRegistry.register("facebook-messenger", FacebookMessengerAdapter, {
    name: "facebook-messenger",
    displayName: "Facebook Messenger",
    description: "Messenger Platform Send、Conversations、Profile、Webhook 与 Page 管理适配器",
    icon: "https://static.xx.fbcdn.net/rsrc.php/yd/r/hlvibnBVrEb.svg",
    homepage: "https://www.postman.com/meta/messenger-platform-api/overview",
    author: "凉菜",
    capabilities: facebookMessengerCapabilities,
});
