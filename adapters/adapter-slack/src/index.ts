// 导出类型
import { AdapterRegistry } from "onebots";
import type { Schema } from "onebots";

export type {
    SlackConfig,
    SlackProxyConfig,
    SlackReceiveMode,
    SlackHttpResult,
    SlackWebhookBody,
    SlackEvent,
    SlackMessage,
    SlackUser,
    SlackChannel,
} from "./types.js";
export * from "./adapter.js";
export * from "./capabilities.js";
export { SlackBot, type SlackBotEvents } from "./bot.js";
export { SlackError, type SlackErrorOptions } from "./errors.js";
export { projectSlackEvent, projectSlackMessageSegments } from "./events.js";
export { slackUserDisplayName } from "./users.js";
export { compileSlackMessage, type CompiledSlackMessage, type SlackFileInput } from "./messages.js";
export { acceptSlackSocketEnvelope, type SlackSocketEnvelope } from "./socket-envelope.js";
export {
    SLACK_PLATFORM_ACTIONS,
    executeSlackPlatformAction,
    type SlackPlatformAction,
} from "./platform-actions.js";
export { SLACK_COLLABORATION_ACTIONS } from "./platform-actions-collaboration.js";
export { SLACK_CALL_ACTIONS } from "./platform-actions-calls.js";
export { SLACK_REMOTE_FILE_ACTIONS } from "./platform-actions-remote-files.js";
export {
    SLACK_AGENT_ACTIONS,
    requireSlackAgentSessionStatus,
    type SlackAgentSessionStatus,
} from "./agent-actions.js";
export {
    SLACK_STREAM_ACTIONS,
    type SlackAppendMessageStreamParams,
    type SlackStartMessageStreamParams,
    type SlackStopMessageStreamParams,
    type SlackTaskDisplayMode,
} from "./stream-actions.js";
export { createSlackDispatcher, createSlackFetch } from "./transport.js";

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
            visibleWhen: { path: "receive_mode", oneOf: ["webhook", "manual"] },
        },
    },
    receive_mode: {
        type: "string",
        default: "socket",
        label: "事件接收方式",
        choices: [
            { value: "socket", label: "Socket Mode（推荐）" },
            { value: "webhook", label: "HTTP Events API" },
            { value: "manual", label: "手动接入已有连接" },
        ],
        description: "manual 不创建连接或路由，由现有 Host/消息队列调用 ingest()",
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
    proxy: {
        url: {
            type: "string",
            label: "代理地址",
            placeholder: "http://127.0.0.1:7890",
            pattern: /^(?:https?|socks5):\/\/[^\s]+$/,
            ui: { section: "advanced" },
        },
        username: { type: "string", label: "代理用户名", ui: { section: "advanced" } },
        password: {
            type: "string",
            label: "代理密码",
            sensitive: true,
            ui: { section: "advanced" },
        },
    },
};

AdapterRegistry.registerSchema("slack", slackSchema);
