import { AdapterRegistry, type Schema } from "onebots";

export { HeychatAdapter } from "./adapter.js";
export { HeychatBot, type HeychatBotEvents } from "./bot.js";
export {
    assertHeychatConfig,
    resolveHeychatReceiveMode,
    type HeychatReceiveMode,
} from "./config.js";
export {
    decodeHeychatEnvelope,
    HeychatEventIngress,
    isHeychatEnvelope,
    isHeychatControlPayload,
    type HeychatEventConsumer,
    type HeychatIngestResult,
} from "./ingress.js";
export { heychatCapabilities } from "./capabilities.js";
export { HeychatApiError, type HeychatApiErrorOptions } from "./errors.js";
export { projectHeychatEvent, type HeychatEventProjectionOptions } from "./events.js";
export { compileHeychatMessage } from "./messages.js";
export { normalizeBase64Source, prepareHeychatMediaSegments, uploadHeychatMedia } from "./media.js";
export {
    executeHeychatPlatformAction,
    HEYCHAT_PLATFORM_ACTIONS,
    type HeychatPlatformAction,
} from "./platform-actions.js";
export {
    calculateHeychatReconnectDelay,
    HeychatWsClient,
    type HeychatWsClientEvents,
} from "./ws/client.js";
export { HeychatHttpClient } from "./http/client.js";
export { HeychatOAuthClient, type HeychatOAuthTransport } from "./http/oauth.js";
export type {
    ProxyConfig,
    HeychatConfig,
    HeychatRoomBaseInfo,
    HeychatChannelBaseInfo,
    HeychatUserInfo,
    HeychatCommandOption,
    HeychatCommandInfo,
    HeychatUseCommandData,
    HeychatReactionData,
    HeychatRoomMemberData,
    HeychatCardClickData,
    HeychatWsEnvelope,
    HeychatChannelContext,
    HeychatImageInfo,
    HeychatOutboundMessage,
    HeychatSendMessageResult,
    HeychatRoomInfo,
    HeychatChannelInfo,
    HeychatRoomViewResult,
    HeychatApiResponse,
    HeychatApiRequestOptions,
    HeychatOAuthConfig,
    HeychatOAuthDisabledConfig,
    HeychatOAuthEnabledConfig,
    HeychatOAuthToken,
    HeychatOAuthUserInfo,
    HeychatVoiceDuration,
    HeychatVoiceDurationResult,
    HeychatVoiceDurationQuery,
} from "./types.js";

export const heychatSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内部区分黑盒语音机器人的稳定标识",
        ui: { section: "credentials" },
    },
    token: {
        type: "string",
        required: true,
        label: "Bot Token",
        sensitive: true,
        description: "黑盒语音机器人控制台签发的 Token",
        ui: { section: "credentials" },
    },
    receive_mode: {
        type: "string",
        default: "websocket",
        label: "事件接收方式",
        choices: [
            { value: "websocket", label: "内置正向 WebSocket" },
            { value: "manual", label: "手动接入已有连接" },
        ],
        description: "manual 不创建连接，由宿主调用 HeychatBot.ingest() 或 acceptWebSocket()",
        ui: { section: "transport" },
    },
    api_base_url: {
        type: "string",
        default: "https://chat.xiaoheihe.cn",
        label: "REST API Base URL",
        description: "仅官方兼容代理或测试环境需要覆盖",
        ui: { section: "advanced" },
    },
    upload_base_url: {
        type: "string",
        default: "https://chat-upload.xiaoheihe.cn",
        label: "媒体上传 Base URL",
        description: "官方媒体上传服务地址",
        ui: { section: "advanced" },
    },
    ws_url: {
        type: "string",
        default: "wss://chat.xiaoheihe.cn/chatroom/ws/connect",
        label: "WebSocket URL",
        description: "接收命令、回应、成员变更与卡片交互的官方正向长连接",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["websocket"] },
        },
    },
    chat_version: {
        type: "string",
        default: "1.30.0",
        label: "Chat API 版本",
        description: "随官方请求发送的 chat_version；通常无需修改",
        ui: { section: "advanced" },
    },
    voice_api_type: {
        type: "string",
        default: "trtc",
        label: "语音频道线路",
        description: "创建语音频道时使用的官方线路；可选 trtc 或 volc",
        choices: [
            { label: "TRTC（线路一）", value: "trtc" },
            { label: "Volc（线路二）", value: "volc" },
        ],
        ui: { section: "advanced" },
    },
    heartbeat_interval_ms: {
        type: "number",
        default: 30000,
        min: 5000,
        label: "心跳间隔（毫秒）",
        description: "最低 5000；连续一个周期未收到 pong 会重建连接",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["websocket"] },
        },
    },
    reconnect_initial_delay_ms: {
        type: "number",
        default: 1000,
        min: 100,
        label: "首次重连延迟（毫秒）",
        description: "长连接采用带抖动的无限指数退避",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["websocket"] },
        },
    },
    reconnect_max_delay_ms: {
        type: "number",
        default: 30000,
        min: 100,
        label: "最大重连延迟（毫秒）",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["websocket"] },
        },
    },
    request_timeout_ms: {
        type: "number",
        default: 30000,
        min: 1000,
        label: "网络请求超时（毫秒）",
        description: "同时限制 REST 请求与 WebSocket 握手等待时间",
        ui: { section: "advanced" },
    },
    proxy: {
        url: {
            type: "string",
            label: "代理地址",
            description: "HTTP(S) 与 WebSocket 共用的 HTTP/SOCKS 代理",
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
    oauth: {
        enabled: {
            type: "boolean",
            default: false,
            label: "启用用户 OAuth",
            description: "仅需读取用户资料或语音时长时开启",
            ui: { section: "advanced" },
        },
        client_id: {
            type: "string",
            required: true,
            label: "OAuth Client ID",
            description: "仅用户授权相关动作需要；在黑盒语音开发者后台获取",
            ui: {
                section: "advanced",
                visibleWhen: { path: "oauth.enabled", oneOf: [true] },
            },
        },
        client_secret: {
            type: "string",
            required: true,
            label: "OAuth Client Secret",
            sensitive: true,
            ui: {
                section: "advanced",
                visibleWhen: { path: "oauth.enabled", oneOf: [true] },
            },
        },
        redirect_uri: {
            type: "string",
            required: true,
            label: "OAuth 回调地址",
            description: "必须与开发者后台登记的回调地址一致",
            ui: {
                section: "advanced",
                visibleWhen: { path: "oauth.enabled", oneOf: [true] },
            },
        },
        api_base_url: {
            type: "string",
            label: "OAuth API Base URL",
            placeholder: "https://chat.xiaoheihe.cn",
            ui: {
                section: "advanced",
                visibleWhen: { path: "oauth.enabled", oneOf: [true] },
            },
        },
        resource_base_url: {
            type: "string",
            label: "OAuth Resource Base URL",
            placeholder: "https://api.xiaoheihe.cn",
            ui: {
                section: "advanced",
                visibleWhen: { path: "oauth.enabled", oneOf: [true] },
            },
        },
    },
};

AdapterRegistry.registerSchema("heychat", heychatSchema);
