import { AdapterRegistry, type Schema } from "onebots";
import { GoogleChatAdapter } from "./adapter.js";
import { GOOGLE_CHAT_EVENT_TYPES, googleChatCapabilities } from "./capabilities.js";
import type { GoogleChatConfig } from "./types.js";

export { GoogleChatAdapter };
export { GoogleChatClient, type GoogleChatClientDependencies } from "./client.js";
export {
    googleChatCapabilities,
    describeGoogleChatCapabilities,
    GOOGLE_CHAT_EVENT_TYPES,
    GOOGLE_CHAT_INTERACTION_TYPES,
    GOOGLE_CHAT_WORKSPACE_EVENT_TYPES,
} from "./capabilities.js";
export { GoogleChatAuth, type GoogleChatTokenVerifier } from "./auth.js";
export { GoogleChatTransport } from "./transport.js";
export { GoogleChatError, type GoogleChatErrorOptions } from "./errors.js";
export {
    compileGoogleChatMessage,
    projectGoogleChatMessage,
    type CompiledGoogleChatMessage,
} from "./messages.js";
export { projectGoogleChatEvent, type GoogleChatProjectionContext } from "./events.js";
export {
    parseCloudEvent,
    parseInteractionEvent,
    parseManualEvent,
    parsePubSubEnvelope,
} from "./event-validation.js";
export type { GoogleChatInteractionType } from "./event-types.js";
export {
    executeGoogleChatPlatformAction,
    GOOGLE_CHAT_PLATFORM_ACTIONS,
    type GoogleChatPlatformAction,
} from "./platform-actions.js";
export type {
    GoogleChatAuthMode,
    GoogleChatCallOptions,
    GoogleChatClientEvents,
    GoogleChatCloudEvent,
    GoogleChatConfig,
    GoogleChatEventEnvelope,
    GoogleChatHttpRequest,
    GoogleChatHttpResponse,
    GoogleChatIngestResult,
    GoogleChatInteractionEvent,
    GoogleChatMembership,
    GoogleChatMediaResponse,
    GoogleChatMessage,
    GoogleChatReaction,
    GoogleChatReceiveMode,
    GoogleChatSpace,
    GoogleChatUser,
    GoogleChatVerificationMode,
} from "./types.js";

const GOOGLE_CHAT_SCOPES = [
    "https://www.googleapis.com/auth/chat.bot",
    "https://www.googleapis.com/auth/chat.messages",
    "https://www.googleapis.com/auth/chat.messages.create",
    "https://www.googleapis.com/auth/chat.messages.readonly",
    "https://www.googleapis.com/auth/chat.messages.reactions",
    "https://www.googleapis.com/auth/chat.messages.reactions.readonly",
    "https://www.googleapis.com/auth/chat.spaces",
    "https://www.googleapis.com/auth/chat.spaces.readonly",
    "https://www.googleapis.com/auth/chat.spaces.create",
    "https://www.googleapis.com/auth/chat.memberships",
    "https://www.googleapis.com/auth/chat.memberships.readonly",
    "https://www.googleapis.com/auth/chat.memberships.app",
    "https://www.googleapis.com/auth/chat.users.readstate",
    "https://www.googleapis.com/auth/chat.users.readstate.readonly",
    "https://www.googleapis.com/auth/chat.users.availability",
    "https://www.googleapis.com/auth/chat.users.availability.readonly",
    "https://www.googleapis.com/auth/chat.app.messages.readonly",
    "https://www.googleapis.com/auth/chat.app.spaces",
    "https://www.googleapis.com/auth/chat.app.spaces.readonly",
    "https://www.googleapis.com/auth/chat.app.memberships",
    "https://www.googleapis.com/auth/chat.app.memberships.readonly",
] as const;

export const googleChatSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内区分 Google Chat 应用的稳定标识",
        ui: { section: "credentials" },
    },
    auth_mode: {
        type: "string",
        default: "service-account",
        label: "API 身份",
        choices: [
            { value: "service-account", label: "Service Account（应用身份）" },
            { value: "access-token", label: "已有 OAuth Access Token（用户身份）" },
        ],
        ui: { section: "credentials" },
    },
    service_account_email: {
        type: "string",
        label: "Service Account Email",
        placeholder: "bot@project.iam.gserviceaccount.com",
        ui: {
            section: "credentials",
            visibleWhen: { path: "auth_mode", oneOf: ["service-account"] },
        },
    },
    service_account_private_key: {
        type: "string",
        label: "Service Account Private Key",
        sensitive: true,
        description: "粘贴 PEM 私钥；不会在 Web 配置回显中展示明文",
        ui: {
            section: "credentials",
            visibleWhen: { path: "auth_mode", oneOf: ["service-account"] },
        },
    },
    access_token: {
        type: "string",
        label: "OAuth Access Token",
        sensitive: true,
        description: "由外部 OAuth 流程维护；适配器不会静默刷新未知凭据",
        ui: {
            section: "credentials",
            visibleWhen: { path: "auth_mode", oneOf: ["access-token"] },
        },
    },
    oauth_scopes: {
        type: "array",
        label: "OAuth Scopes",
        choices: GOOGLE_CHAT_SCOPES.map(value => ({
            value,
            label: value.replace(/^.+\/auth\//u, ""),
        })),
        allowCustomValues: true,
        description: "Service Account 留空默认 chat.bot；管理型能力需显式增加并在 Workspace 授权",
        ui: {
            widget: "choice-list",
            section: "credentials",
            itemLabel: "OAuth scope",
            addLabel: "增加 scope",
        },
    },
    principal_name: {
        type: "string",
        label: "调用主体",
        placeholder: "users/app 或 users/me",
        pattern: /^users\/(?:app|me|[A-Za-z0-9_@.+-]+)$/,
        description: "留空按身份自动选择：Service Account 为 users/app，用户 OAuth 为 users/me",
        ui: { section: "credentials" },
    },
    app_display_name: {
        type: "string",
        label: "应用显示名",
        description: "仅用于 OneBots 账号展示，不覆盖 Google Cloud 中的 Chat 应用名称",
        ui: { section: "credentials" },
    },
    receive_mode: {
        type: "string",
        default: "interaction-http",
        label: "事件接收方式",
        choices: [
            { value: "interaction-http", label: "Chat Interaction HTTPS Endpoint" },
            { value: "pubsub-push", label: "Workspace Events + Pub/Sub Push" },
            { value: "manual", label: "手动接入已有 Host/连接" },
        ],
        description: "三种方式共用同一个 Client、可靠去重与 canonical 事件管线",
        ui: { section: "transport" },
    },
    http_path: {
        type: "string",
        label: "HTTP 挂载路径",
        placeholder: "/google-chat/{account_id}/events",
        pattern: /^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/,
        description: "留空使用账号隔离路径；可挂到 OneBots 现有 Koa Host",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["interaction-http", "pubsub-push"] },
        },
    },
    verification_mode: {
        type: "string",
        label: "Interaction Token 校验",
        choices: [
            { value: "endpoint-url", label: "OIDC ID Token（Audience 为 Endpoint URL）" },
            { value: "project-number", label: "Chat 自签 JWT（Audience 为 Project Number）" },
        ],
        description: "留空默认 Endpoint URL 模式；Pub/Sub 会固定使用其 OIDC 校验",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["interaction-http"] },
        },
    },
    verification_audience: {
        type: "string",
        label: "Token Audience",
        description: "Interaction 填 endpoint URL/project number；Pub/Sub 填 push audience",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["interaction-http", "pubsub-push"] },
        },
    },
    pubsub_service_account_email: {
        type: "string",
        label: "Pub/Sub Push Service Account",
        description: "必须与 Pub/Sub push OIDC token 的已验证 email 完全一致",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["pubsub-push"] },
        },
    },
    event_types: {
        type: "array",
        default: [...GOOGLE_CHAT_EVENT_TYPES],
        label: "接收事件",
        choices: GOOGLE_CHAT_EVENT_TYPES.map(value => ({ value, label: value })),
        description: "按当前接收模式选择 Interaction 或 Workspace event；batch 自动展开",
        ui: {
            widget: "choice-list",
            section: "filter",
            itemLabel: "Google Chat 事件",
            addLabel: "添加事件",
        },
    },
    api_base_url: {
        type: "string",
        default: "https://chat.googleapis.com",
        label: "API Base URL",
        description: "仅代理、测试或私有网关需要修改；生产必须 HTTPS",
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("google-chat", googleChatSchema);

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            "google-chat": GoogleChatConfig;
        }
    }
}

AdapterRegistry.register("google-chat", GoogleChatAdapter, {
    name: "google-chat",
    displayName: "Google Chat",
    description: "Google Chat REST v1、Interaction HTTPS 与 Workspace Events 适配器",
    icon: "https://ssl.gstatic.com/workspace/favicon/chat.ico",
    homepage: "https://developers.google.com/workspace/chat/api/reference/rest",
    author: "凉菜",
    capabilities: googleChatCapabilities,
});
