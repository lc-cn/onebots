// 导出类型和常量
import { AdapterRegistry } from "onebots";
import type { Schema } from "onebots";
import { FeishuEndpoint } from "./types.js";

export {
    FeishuEndpoint,
    type FeishuApiRequestOptions,
    type FeishuConfig,
    type FeishuEndpointType,
} from "./types.js";
export * from "./adapter.js";
export * from "./capabilities.js";

const feishuSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内部区分飞书/Lark 连接的稳定标识",
    },
    app_id: {
        type: "string",
        required: true,
        label: "App ID",
        placeholder: "cli_…",
        ui: { section: "credentials" },
    },
    app_secret: {
        type: "string",
        required: true,
        label: "App Secret",
        ui: { section: "credentials" },
    },
    long_connection: {
        type: "boolean",
        default: false,
        label: "官方长连接",
        description: "无需公网 Webhook，由飞书官方 SDK 保持并自动恢复连接",
        ui: { section: "transport" },
    },
    encrypt_key: {
        type: "string",
        label: "事件加密 Key",
        description: "Webhook 加密推送开启后必须配置",
        ui: { section: "credentials" },
    },
    verification_token: {
        type: "string",
        label: "事件验证 Token",
        ui: { section: "credentials" },
    },
    endpoint: {
        type: "string",
        label: "API 端点",
        placeholder: FeishuEndpoint.FEISHU,
        description: `国内版使用 ${FeishuEndpoint.FEISHU}，国际版使用 ${FeishuEndpoint.LARK}`,
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("feishu", feishuSchema);
