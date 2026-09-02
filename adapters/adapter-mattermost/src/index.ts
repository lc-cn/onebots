import { AdapterRegistry, type Schema } from "onebots";
import { MattermostAdapter } from "./adapter.js";
import { MATTERMOST_EVENT_TYPES, mattermostCapabilities } from "./capabilities.js";
import type { MattermostConfig } from "./types.js";

export { MattermostAdapter };
export { MattermostClient, type MattermostClientDependencies } from "./client.js";
export {
    describeMattermostCapabilities,
    MATTERMOST_EVENT_TYPES,
    mattermostCapabilities,
} from "./capabilities.js";
export { MattermostError, type MattermostErrorOptions } from "./errors.js";
export {
    assertMattermostApiPath,
    assertMattermostConfig,
    parseMattermostServerUrl,
} from "./configuration.js";
export { projectMattermostEvent, type MattermostProjectionContext } from "./events.js";
export { compileMattermostMessage, projectMattermostPost } from "./messages.js";
export {
    executeMattermostPlatformAction,
    MATTERMOST_PLATFORM_ACTIONS,
    type MattermostPlatformAction,
} from "./platform-actions.js";
export { FetchMattermostRestTransport, type MattermostRestTransport } from "./rest.js";
export { MattermostWebSocketTransport, type MattermostWebSocketDependencies } from "./websocket.js";
export type {
    MattermostCallOptions,
    MattermostChannel,
    MattermostChannelMember,
    MattermostChannelType,
    MattermostClientEvents,
    MattermostConfig,
    MattermostCreatePost,
    MattermostDelivery,
    MattermostFileInfo,
    MattermostHttpMethod,
    MattermostIngestResult,
    MattermostPost,
    MattermostPostList,
    MattermostReaction,
    MattermostReceiveMode,
    MattermostSocketAttachOptions,
    MattermostStatus,
    MattermostTeam,
    MattermostTeamMember,
    MattermostUploadResult,
    MattermostUser,
    MattermostWebSocketEvent,
    MattermostWebSocketResponse,
} from "./types.js";

export const mattermostSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内区分 Mattermost bot 或用户账号的稳定标识",
        ui: { section: "credentials" },
    },
    server_url: {
        type: "string",
        required: true,
        label: "Mattermost Server URL",
        placeholder: "https://mattermost.example.com",
        pattern: /^https?:\/\/[^\s?#]+\/?$/,
        description: "实例根地址，也支持部署在子路径的 Mattermost；生产环境必须使用 HTTPS",
        ui: { section: "credentials" },
    },
    access_token: {
        type: "string",
        required: true,
        label: "Personal Access Token",
        sensitive: true,
        description: "Mattermost Bot Account Access Token 或 Personal Access Token",
        ui: { section: "credentials" },
    },
    receive_mode: {
        type: "string",
        default: "websocket",
        label: "事件接收方式",
        choices: [
            { value: "websocket", label: "可靠 WebSocket（自动连接与续接）" },
            { value: "manual", label: "外部 socket / ingest(rawEvent)" },
        ],
        description: "两种方式共用同一 Client、严格解析、过滤、去重与 canonical 投影",
        ui: { section: "transport" },
    },
    event_types: {
        type: "array",
        default: [...MATTERMOST_EVENT_TYPES],
        label: "接收事件",
        choices: MATTERMOST_EVENT_TYPES.map(value => ({ value, label: value })),
        allowCustomValues: true,
        description: "按 Mattermost WebSocket event 动态增减；自定义插件事件可直接添加",
        ui: {
            widget: "choice-list",
            section: "filter",
            itemLabel: "Mattermost event",
            addLabel: "添加事件",
        },
    },
    team_ids: {
        type: "array",
        default: [],
        label: "Team 过滤",
        allowCustomValues: true,
        description: "留空接收全部；每项是 Mattermost team ID，无需手写 JSON",
        ui: {
            widget: "choice-list",
            section: "filter",
            itemLabel: "Team ID",
            addLabel: "添加 Team",
        },
    },
    channel_ids: {
        type: "array",
        default: [],
        label: "Channel 过滤",
        allowCustomValues: true,
        description: "留空接收全部；每项是 Mattermost channel ID，可随时增减",
        ui: {
            widget: "choice-list",
            section: "filter",
            itemLabel: "Channel ID",
            addLabel: "添加 Channel",
        },
    },
    reconnect_initial_delay_ms: {
        type: "number",
        default: 1000,
        min: 100,
        max: 60000,
        label: "重连初始延迟（ms）",
        description: "失败后指数退避的起点；默认无限重连",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["websocket"] },
        },
    },
    reconnect_max_delay_ms: {
        type: "number",
        default: 30000,
        min: 100,
        max: 300000,
        label: "重连最大延迟（ms）",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["websocket"] },
        },
    },
    connect_timeout_ms: {
        type: "number",
        default: 15000,
        min: 100,
        max: 120000,
        label: "连接与 Action 超时（ms）",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["websocket"] },
        },
    },
    max_response_bytes: {
        type: "number",
        default: 10485760,
        min: 1024,
        max: 52428800,
        label: "REST 响应上限（bytes）",
        description: "限制不可信服务端响应的内存占用",
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("mattermost", mattermostSchema);

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            mattermost: MattermostConfig;
        }
    }
}

AdapterRegistry.register("mattermost", MattermostAdapter, {
    name: "mattermost",
    displayName: "Mattermost",
    description: "Mattermost REST API v4、可靠 WebSocket、manual ingress 与平台扩展适配器",
    icon: "https://mattermost.com/wp-content/uploads/2022/02/icon.png",
    homepage: "https://api.mattermost.com/",
    author: "凉菜",
    capabilities: mattermostCapabilities,
});
