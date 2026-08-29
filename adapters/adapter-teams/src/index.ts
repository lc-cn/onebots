import { AdapterRegistry, type Schema } from "onebots";

export { TeamsAdapter } from "./adapter.js";
export { TeamsBot, type TeamsContext, type TeamsReferenceRepository } from "./bot.js";
export { teamsCapabilities } from "./capabilities.js";
export { TeamsApiError, TeamsConversationReferenceError } from "./errors.js";
export { compileTeamsActivity, projectTeamsSegments } from "./activity.js";
export type {
    TeamsConfig,
    TeamsUser,
    TeamsChannel,
    TeamsMessage,
    TeamsActivity,
    TeamsEvent,
    TeamsAttachment,
    TeamsChannelData,
    TeamsChannelDataTenant,
    TeamsConversationReference,
    TeamsEntity,
    TeamsOutboundActivity,
    TeamsSendOptions,
} from "./types.js";

const teamsSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内部区分 Microsoft Teams Agent 的稳定标识",
    },
    app_id: {
        type: "string",
        required: true,
        label: "Microsoft App ID",
        description: "Azure Bot 绑定的 Microsoft Entra 应用 Client ID",
        ui: { section: "credentials" },
    },
    app_password: {
        type: "string",
        required: true,
        label: "Client Secret",
        description: "Microsoft Entra 应用的客户端密钥值（不是 Secret ID）",
        ui: { section: "credentials" },
    },
    tenant_id: {
        type: "string",
        label: "Tenant ID",
        placeholder: "单租户应用的 Directory (tenant) ID",
        description: "单租户填写具体 Tenant ID；多租户 Azure Bot 留空以使用 botframework.com",
        ui: { section: "credentials" },
    },
    validate_service_url: {
        type: "boolean",
        default: true,
        label: "校验 Service URL",
        description: "校验 Activity serviceUrl 与 JWT claim，防止伪造出站目标；生产环境应保持开启",
        ui: { section: "advanced" },
    },
    authority_endpoint: {
        type: "string",
        label: "Entra Authority",
        placeholder: "https://login.microsoftonline.com",
        description: "主权云或自定义 Entra 环境才需要覆盖",
        ui: { section: "advanced" },
    },
    graph_base_url: {
        type: "string",
        label: "Graph API Base URL",
        default: "https://graph.microsoft.com/v1.0",
        description: "主权云可覆盖；普通 Microsoft 365 环境保持默认",
        ui: { section: "advanced" },
    },
    graph_tenant_id: {
        type: "string",
        label: "Graph Tenant ID",
        description:
            "仅多租户 Bot 调用 app-only Graph 时填写具体目标 Tenant；单租户默认复用 Tenant ID",
        ui: { section: "advanced" },
    },
    bot_audience: {
        type: "string",
        label: "Bot Connector Audience",
        default: "https://api.botframework.com",
        choices: [
            { value: "https://api.botframework.com", label: "Azure 公有云" },
            { value: "https://api.botframework.us", label: "Azure 美国政府云" },
        ],
        description: "首次主动建会话和 Connector token 使用的 audience",
        ui: { section: "advanced" },
    },
    allowed_service_urls: {
        type: "array",
        default: [],
        label: "额外可信 Service URL",
        description: "微软官方 Connector 域名已内置；仅自定义/私有云 Connector 需要动态添加",
        ui: {
            widget: "endpoint-list",
            section: "advanced",
            itemLabel: "Service URL",
            addLabel: "添加可信 URL",
            schemes: ["https:"],
        },
    },
};

AdapterRegistry.registerSchema("teams", teamsSchema);
