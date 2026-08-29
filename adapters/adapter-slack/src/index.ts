// 导出类型
import { AdapterRegistry } from "onebots";
import type { Schema } from "onebots";

export type { SlackConfig, SlackReceiveMode } from "./types.js";
export * from "./adapter.js";
export * from "./capabilities.js";
export { SlackBot, type SlackBotEvents } from "./bot.js";
export { SlackError, type SlackErrorOptions } from "./errors.js";
export { compileSlackMessage, type CompiledSlackMessage, type SlackFileInput } from "./messages.js";
export {
    SLACK_PLATFORM_ACTIONS,
    executeSlackPlatformAction,
    type SlackPlatformAction,
} from "./platform-actions.js";

export const slackSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内部用于区分 Slack 工作区连接的稳定标识",
        ui: { section: "credentials" },
    },
    token: {
        type: "string",
        required: true,
        label: "Bot Token",
        sensitive: true,
        placeholder: "xoxb-…",
        ui: { section: "credentials" },
    },
    signing_secret: {
        type: "string",
        label: "Signing Secret",
        sensitive: true,
        description: "HTTP Events API 请求签名密钥",
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    receive_mode: {
        type: "string",
        default: "socket",
        label: "事件接收方式",
        choices: [
            { value: "socket", label: "Socket Mode（推荐）" },
            { value: "webhook", label: "HTTP Events API" },
        ],
        description: "Socket Mode 无需公网地址，并由 Slack 官方客户端自动恢复连接",
        ui: { section: "transport" },
    },
    app_token: {
        type: "string",
        label: "App Token",
        sensitive: true,
        placeholder: "xapp-…",
        description: "仅 Socket Mode 使用，需包含 connections:write scope",
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["socket"] },
        },
    },
};

AdapterRegistry.registerSchema("slack", slackSchema);
