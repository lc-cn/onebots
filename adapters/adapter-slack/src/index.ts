// 导出类型
import { AdapterRegistry } from "onebots";
import type { Schema } from "onebots";

export type { SlackConfig } from "./types.js";
export * from "./adapter.js";
export * from "./capabilities.js";

const slackSchema: Schema = {
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
        ui: { section: "credentials" },
    },
    socket_mode: {
        type: "boolean",
        default: false,
        label: "Socket Mode",
        description: "无需公网 Webhook；启用后由 Slack 官方客户端保持并自动恢复连接",
        ui: { section: "transport" },
    },
    app_token: {
        type: "string",
        label: "App Token",
        sensitive: true,
        placeholder: "xapp-…",
        description: "仅 Socket Mode 使用，需包含 connections:write scope",
        ui: { section: "credentials" },
    },
};

AdapterRegistry.registerSchema("slack", slackSchema);
