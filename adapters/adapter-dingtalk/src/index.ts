import { AdapterRegistry, type Schema } from "onebots";

export { DingTalkBot, type DingTalkBotEvents, type DingTalkOutboundMessage } from "./bot.js";
export * from "./errors.js";
export type {
    DingTalkApiRequestOptions,
    DingTalkConfig,
    DingTalkEvent,
    DingTalkReceiveMode,
    DingTalkRobotMessage,
} from "./types.js";
export * from "./adapter.js";
export * from "./capabilities.js";
export {
    DINGTALK_PLATFORM_ACTIONS,
    executeDingTalkPlatformAction,
    type DingTalkPlatformAction,
} from "./platform-actions.js";

const dingtalkSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内部区分钉钉机器人连接的稳定标识",
        ui: { section: "credentials" },
    },
    receive_mode: {
        type: "string",
        default: "stream",
        label: "事件接收方式",
        choices: [
            { label: "Stream 长连接（推荐）", value: "stream" },
            { label: "HTTP 回调", value: "webhook" },
        ],
        description: "Stream 无需公网地址并由官方 SDK 自动恢复连接",
        ui: { section: "transport" },
    },
    app_key: {
        type: "string",
        label: "Client ID / AppKey",
        description: "Stream、企业机器人和开放平台 API 使用",
        ui: { section: "credentials" },
    },
    app_secret: {
        type: "string",
        label: "Client Secret / AppSecret",
        sensitive: true,
        ui: { section: "credentials" },
    },
    robot_code: {
        type: "string",
        label: "Robot Code",
        description: "企业机器人编码；留空时使用 AppKey",
        ui: { section: "credentials" },
    },
    agent_id: {
        type: "string",
        label: "Agent ID",
        description: "工作通知等企业内部应用 API 使用",
        ui: { section: "credentials" },
    },
    corp_id: {
        type: "string",
        label: "Corp ID",
        description: "启用 HTTP 加密回调时用于校验回调归属",
        ui: { section: "credentials" },
    },
    token: {
        type: "string",
        label: "回调 Token",
        sensitive: true,
        description: "HTTP 加密回调签名使用",
        ui: { section: "credentials" },
    },
    encrypt_key: {
        type: "string",
        label: "EncodingAESKey",
        sensitive: true,
        description: "HTTP 加密回调使用的 43 字符 AES Key",
        ui: { section: "credentials" },
    },
    webhook_url: {
        type: "string",
        label: "自定义机器人 Webhook",
        placeholder: "https://oapi.dingtalk.com/robot/send?access_token=…",
        description: "仅用于向固定群发送，不决定事件接收方式",
        ui: { section: "delivery" },
    },
    webhook_secret: {
        type: "string",
        label: "自定义机器人加签密钥",
        sensitive: true,
        ui: { section: "credentials" },
    },
};

AdapterRegistry.registerSchema("dingtalk", dingtalkSchema);
