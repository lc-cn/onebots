import { AdapterRegistry, type Schema } from "onebots";
import { QQ_INTENTS } from "./types.js";

export { QQAdapter } from "./adapter.js";
export { qqCapabilities } from "./capabilities.js";
export { QQClient } from "./client.js";
export { QQApiError } from "./errors.js";
export { projectQQGatewayMessage, projectQQMessage, projectQQRawEvent } from "./events.js";
export { compileMessage, sendQQMessage } from "./messages.js";
export { QQOpenApi } from "./open-api.js";
export { executeQQPlatformAction, QQ_PLATFORM_ACTIONS } from "./platform-actions.js";
export { QQWebhookHost } from "./webhook-host.js";
export { QQ_INTENTS, resolveIntentMask } from "./types.js";
export type {
    QQConfig,
    QQIntent,
    QQMessagePayload,
    QQPlatformCall,
    QQRawMessage,
    QQReceiveMode,
} from "./types.js";
export * from "@tencent-connect/qqbot-nodejs";

const intentChoices = Object.keys(QQ_INTENTS).map(value => ({ value, label: value }));

const qqSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内部区分 QQ 机器人的稳定标识，建议直接使用 AppID",
        ui: { section: "credentials" },
    },
    appid: {
        type: "string",
        required: true,
        label: "App ID",
        description: "QQ 开放平台机器人 AppID",
        ui: { section: "credentials" },
    },
    secret: {
        type: "string",
        required: true,
        label: "App Secret",
        sensitive: true,
        description: "QQ 开放平台机器人 AppSecret",
        ui: { section: "credentials" },
    },
    receive_mode: {
        type: "string",
        default: "websocket",
        label: "事件接收方式",
        description: "Webhook 直接复用 OneBots 主 HTTP 服务，不会另开端口",
        choices: [
            { value: "websocket", label: "WebSocket 正向连接" },
            { value: "webhook", label: "Webhook 回调" },
        ],
        ui: { section: "transport" },
    },
    webhook_path: {
        type: "string",
        label: "Webhook 路径",
        placeholder: "/qq/{account_id}/webhook",
        description: "仅 Webhook 模式使用；留空时自动生成账号隔离路径",
        ui: { section: "transport" },
    },
    intents: {
        type: "array",
        label: "事件订阅",
        description: "仅选择机器人已在 QQ 开放平台获批的事件；留空使用官方 SDK 安全默认值",
        choices: intentChoices,
        ui: { section: "filter" },
    },
    markdown_support: {
        type: "boolean",
        default: false,
        label: "已开通 Markdown 权限",
        description: "仅在机器人已获 QQ Markdown 消息权限时启用",
        ui: { section: "delivery" },
    },
    api_base_url: {
        type: "string",
        label: "OpenAPI Base URL",
        placeholder: "https://api.sgroup.qq.com",
        description: "官方兼容代理或测试环境才需要覆盖",
        ui: { section: "advanced" },
    },
    token_base_url: {
        type: "string",
        label: "Token Base URL",
        placeholder: "https://bots.qq.com",
        description: "官方兼容代理或测试环境才需要覆盖",
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("qq", qqSchema);
