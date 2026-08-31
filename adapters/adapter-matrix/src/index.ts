import { AdapterRegistry, type Schema } from "onebots";
import { MatrixAdapter } from "./adapter.js";
import { MATRIX_EVENT_TYPES, matrixCapabilities } from "./capabilities.js";
import type { MatrixConfig } from "./types.js";

export { MatrixAdapter };
export { MatrixClient, type MatrixClientDependencies } from "./client.js";
export {
    matrixCapabilities,
    describeMatrixCapabilities,
    MATRIX_EVENT_TYPES,
} from "./capabilities.js";
export { MatrixError, type MatrixErrorOptions } from "./errors.js";
export {
    compileMatrixMessages,
    projectMatrixMessageContent,
    type MatrixMessageContent,
} from "./messages.js";
export { projectMatrixEvent, type MatrixProjectionContext } from "./events.js";
export {
    MATRIX_PLATFORM_ACTIONS,
    executeMatrixPlatformAction,
    type MatrixPlatformAction,
} from "./platform-actions.js";
export { parseMatrixSync, type MatrixSyncBatch } from "./sync.js";
export { MatrixTransport } from "./transport.js";
export {
    MATRIX_JSON_HEADERS,
    matrixErrorResponse,
    matrixJsonResponse,
    toFetchResponse,
} from "./http.js";
export type {
    MatrixReceiveMode,
    MatrixConfig,
    MatrixIdentity,
    MatrixRawEvent,
    MatrixEventSection,
    MatrixEventEnvelope,
    MatrixIngestResult,
    MatrixTransactionResult,
    MatrixClientEvents,
    MatrixHttpRequest,
    MatrixHttpResponse,
    MatrixCallOptions,
    MatrixSendResponse,
    MatrixRoomSummary,
    MatrixRoomMember,
    MatrixRoomEventPage,
    MatrixEventContext,
    MatrixUploadResponse,
    MatrixCreateRoomParams,
    MatrixCreateRoomResponse,
} from "./types.js";

export const matrixSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内区分 Matrix 机器人的稳定标识",
        ui: { section: "credentials" },
    },
    homeserver_url: {
        type: "string",
        required: true,
        label: "Homeserver URL",
        placeholder: "https://matrix.example.com",
        description: "Matrix homeserver 根地址；生产环境必须使用 HTTPS",
        pattern: /^https?:\/\/[^\s?#]+\/?$/,
        ui: { section: "credentials" },
    },
    user_id: {
        type: "string",
        required: true,
        label: "Matrix User ID",
        placeholder: "@bot:example.com",
        pattern: /^@[^:\s]+:[^\s]+$/,
        description: "完整 Matrix 用户 ID；启动时会与凭据 whoami 结果核对",
        ui: { section: "credentials" },
    },
    receive_mode: {
        type: "string",
        default: "sync",
        label: "事件接收方式",
        choices: [
            { value: "sync", label: "Client /sync 长轮询" },
            { value: "appservice", label: "Application Service transaction" },
            { value: "manual", label: "手动接入已有连接/Host" },
        ],
        description: "三种方式共用同一个 MatrixClient、去重与 canonical 事件管线",
        ui: { section: "transport" },
    },
    access_token: {
        type: "string",
        label: "Access Token",
        sensitive: true,
        description: "sync 模式必填；manual 可使用普通用户 token 或 AppService token",
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["sync", "manual"] },
        },
    },
    device_id: {
        type: "string",
        label: "Device ID",
        description: "可选；AppService masquerade device 或普通客户端设备标识",
        ui: { section: "credentials" },
    },
    appservice_id: {
        type: "string",
        label: "Application Service ID",
        description: "homeserver registration 中不可变的 id",
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["appservice"] },
        },
    },
    as_token: {
        type: "string",
        label: "Application Service Token",
        sensitive: true,
        description: "AppService 调用 homeserver Client-Server API 的 as_token",
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["appservice", "manual"] },
        },
    },
    hs_token: {
        type: "string",
        label: "Homeserver Token",
        sensitive: true,
        description: "严格校验 homeserver 发往 AppService 的 Bearer hs_token",
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["appservice"] },
        },
    },
    appservice_path: {
        type: "string",
        label: "AppService 挂载路径",
        placeholder: "/matrix/{account_id}/appservice",
        pattern: /^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/,
        description: "留空使用账号隔离路径；registration.url 指向该路径",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["appservice"] },
        },
    },
    event_types: {
        type: "array",
        default: [...MATRIX_EVENT_TYPES],
        label: "同步事件类型",
        choices: MATRIX_EVENT_TYPES.map(value => ({ value, label: value })),
        allowCustomValues: true,
        description: "直接生成 /sync filter；可动态增减，也允许填写稳定的自定义 Matrix 类型",
        ui: {
            widget: "choice-list",
            section: "filter",
            itemLabel: "Matrix 事件类型",
            addLabel: "添加事件类型",
            visibleWhen: { path: "receive_mode", oneOf: ["sync"] },
        },
    },
    direct_room_ids: {
        type: "array",
        default: [],
        label: "额外 Direct Room",
        allowCustomValues: true,
        description: "通常由 m.direct account data 自动发现；仅外部接入缺少 account data 时补充",
        ui: {
            widget: "choice-list",
            section: "filter",
            itemLabel: "Room ID",
            addLabel: "添加 Direct Room",
        },
    },
    sync_timeout_ms: {
        type: "number",
        default: 30000,
        min: 1000,
        max: 120000,
        label: "Sync 长轮询超时（毫秒）",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["sync"] },
        },
    },
    sync_retry_min_ms: {
        type: "number",
        default: 1000,
        min: 100,
        max: 60000,
        label: "重试最小退避（毫秒）",
        description: "接收循环默认无限重试；失败后从该值指数退避",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["sync"] },
        },
    },
    sync_retry_max_ms: {
        type: "number",
        default: 60000,
        min: 100,
        max: 600000,
        label: "重试最大退避（毫秒）",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["sync"] },
        },
    },
    initial_sync_limit: {
        type: "number",
        default: 20,
        min: 0,
        max: 1000,
        label: "首次同步每房间消息数",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["sync"] },
        },
    },
    lazy_load_members: {
        type: "boolean",
        default: true,
        label: "懒加载房间成员",
        description: "减少大型房间首次 /sync 的状态体积",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["sync"] },
        },
    },
    sync_presence: {
        type: "string",
        label: "同步在线状态",
        choices: [
            { value: "online", label: "Online" },
            { value: "unavailable", label: "Unavailable" },
            { value: "offline", label: "Offline" },
        ],
        description: "可选；作为 /sync set_presence 发送给 homeserver",
        ui: {
            section: "advanced",
            visibleWhen: { path: "receive_mode", oneOf: ["sync"] },
        },
    },
};

AdapterRegistry.registerSchema("matrix", matrixSchema);

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            matrix: MatrixConfig;
        }
    }
}

AdapterRegistry.register("matrix", MatrixAdapter, {
    name: "matrix",
    displayName: "Matrix",
    description: "Matrix Client-Server API 与 Application Service 适配器",
    icon: "https://matrix.org/favicon.ico",
    homepage: "https://spec.matrix.org/latest/",
    author: "凉菜",
    capabilities: matrixCapabilities,
});
