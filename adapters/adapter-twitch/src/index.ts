import { AdapterRegistry, type Schema } from "onebots";
import { TwitchAdapter } from "./adapter.js";
import { TWITCH_EVENTSUB_TYPES, twitchCapabilities } from "./capabilities.js";
import { getTwitchEventSubDefinition } from "./eventsub-catalog.js";
import type { TwitchConfig } from "./types.js";

export { TwitchAdapter };
export { validateTwitchToken, parseTokenInfo } from "./auth.js";
export { TwitchClient, type TwitchClientOptions } from "./client.js";
export {
    describeTwitchCapabilities,
    TWITCH_EVENTSUB_TYPES,
    twitchCapabilities,
} from "./capabilities.js";
export {
    assertHttpPath,
    assertTwitchApiPath,
    assertTwitchConfig,
    expandSubscriptions,
    normalizeSubscription,
    parseTwitchApiBaseUrl,
    parseTwitchEventSubUrl,
} from "./configuration.js";
export { TwitchError, type TwitchErrorOptions } from "./errors.js";
export { projectTwitchEvent, type TwitchProjectionContext } from "./events.js";
export { TwitchHttpHost } from "./http-host.js";
export { compileTwitchMessage, projectTwitchFragments } from "./messages.js";
export {
    executeTwitchPlatformAction,
    TWITCH_PLATFORM_ACTIONS,
    type TwitchPlatformAction,
} from "./platform-actions.js";
export { FetchTwitchRestTransport, type TwitchRestTransport } from "./rest.js";
export { TwitchEventSubTransport, type TwitchEventSubDependencies } from "./eventsub.js";
export {
    getTwitchEventSubDefinition,
    TWITCH_EVENTSUB_CATALOG,
    type TwitchEventSubConditionProfile,
    type TwitchEventSubDefinition,
} from "./eventsub-catalog.js";
export { TwitchWebhookHandler, type TwitchWebhookHandlerOptions } from "./webhook.js";
export type { CompiledTwitchMessage } from "./messages.js";
export type {
    TwitchApiResponse,
    TwitchCallOptions,
    TwitchChannel,
    TwitchChatter,
    TwitchChatMessageResponse,
    TwitchClientDependencies,
    TwitchClientEvents,
    TwitchConfig,
    TwitchDelivery,
    TwitchEventSubMessage,
    TwitchEventSubMetadata,
    TwitchEventSubSession,
    TwitchEventSubSubscription,
    TwitchHttpMethod,
    TwitchIngestResult,
    TwitchNormalizedSubscription,
    TwitchReceiveMode,
    TwitchSocketAttachOptions,
    TwitchStream,
    TwitchSubscriptionConfig,
    TwitchTokenInfo,
    TwitchUser,
} from "./types.js";

const chatConditions = TWITCH_EVENTSUB_TYPES.filter(
    type => getTwitchEventSubDefinition(type)?.condition === "chat",
);
const moderatorConditions = TWITCH_EVENTSUB_TYPES.filter(
    type => getTwitchEventSubDefinition(type)?.condition === "moderator",
);
const rewardConditions = TWITCH_EVENTSUB_TYPES.filter(type =>
    type.startsWith("channel.channel_points_custom_reward"),
);
const broadcasterConditions = TWITCH_EVENTSUB_TYPES.filter(type =>
    ["broadcaster", "chat", "moderator"].includes(
        getTwitchEventSubDefinition(type)?.condition || "",
    ),
);

export const twitchSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内区分 Twitch broadcaster/bot 的稳定标识",
        ui: { section: "credentials" },
    },
    client_id: {
        type: "string",
        required: true,
        label: "Twitch Client ID",
        description: "Twitch Developer Console 应用的 Client ID",
        ui: { section: "credentials" },
    },
    access_token: {
        type: "string",
        required: true,
        sensitive: true,
        label: "OAuth Access Token",
        description: "WebSocket 使用用户令牌；自动 Webhook 订阅使用应用令牌",
        ui: { section: "credentials" },
    },
    broadcaster_user_id: {
        type: "string",
        required: true,
        pattern: /^\d+$/u,
        label: "Broadcaster User ID",
        description: "绑定的 Twitch 频道数字 ID",
        ui: { section: "credentials" },
    },
    bot_user_id: {
        type: "string",
        pattern: /^\d+$/u,
        label: "Bot User ID",
        description: "WebSocket 用户令牌主体；留空则使用 OAuth validation 返回的 user_id",
        ui: { section: "credentials" },
    },
    moderator_user_id: {
        type: "string",
        pattern: /^\d+$/u,
        label: "Moderator User ID",
        description: "执行公告、删消息、封禁等 moderation API 的身份；默认使用 bot/broadcaster",
        ui: { section: "credentials" },
    },
    receive_mode: {
        type: "string",
        default: "websocket",
        label: "事件接收方式",
        choices: [
            { value: "websocket", label: "EventSub WebSocket（用户令牌）" },
            { value: "webhook", label: "EventSub Webhook（应用令牌）" },
            { value: "manual", label: "外部 Host / socket / ingest(rawEvent)" },
        ],
        description: "三种入口汇入同一 Client、过滤、去重和 canonical 投影",
        ui: { section: "transport" },
    },
    auto_subscribe: {
        type: "boolean",
        default: true,
        label: "自动创建 EventSub 订阅",
        description: "关闭后由外部系统管理订阅，OneBots 只消费事件",
        ui: {
            section: "transport",
            visibleWhen: { path: "receive_mode", oneOf: ["websocket", "webhook"] },
        },
    },
    subscriptions: {
        type: "array",
        default: [{ type: "channel.chat.message" }],
        label: "EventSub 订阅",
        description: "逐项选择官方事件；只显示该事件可能使用的 condition，无需手写 JSON",
        ui: {
            widget: "record-list",
            section: "filter",
            itemLabel: "EventSub 订阅",
            addLabel: "添加订阅",
            fields: [
                {
                    key: "type",
                    label: "事件类型",
                    choices: TWITCH_EVENTSUB_TYPES.map(value => ({ value, label: value })),
                    placeholder: "请选择 EventSub type",
                },
                {
                    key: "version",
                    label: "版本",
                    placeholder: "留空使用该类型的当前稳定版本",
                },
                {
                    key: "broadcaster_user_id",
                    label: "Broadcaster ID 覆盖",
                    placeholder: "留空使用账号配置",
                    visibleWhen: { path: "type", oneOf: [...broadcasterConditions] },
                },
                {
                    key: "user_id",
                    label: "User ID 覆盖",
                    placeholder: "留空使用 bot_user_id",
                    visibleWhen: {
                        path: "type",
                        oneOf: [...chatConditions, "user.update", "whisper.received"],
                    },
                },
                {
                    key: "moderator_user_id",
                    label: "Moderator ID 覆盖",
                    placeholder: "留空使用 moderator_user_id",
                    visibleWhen: { path: "type", oneOf: [...moderatorConditions] },
                },
                {
                    key: "from_broadcaster_user_id",
                    label: "Raid 来源 Broadcaster ID",
                    visibleWhen: { path: "type", oneOf: ["channel.raid"] },
                },
                {
                    key: "to_broadcaster_user_id",
                    label: "Raid 目标 Broadcaster ID",
                    placeholder: "留空使用账号 broadcaster",
                    visibleWhen: { path: "type", oneOf: ["channel.raid"] },
                },
                {
                    key: "reward_id",
                    label: "Reward ID（可选）",
                    visibleWhen: { path: "type", oneOf: [...rewardConditions] },
                },
                {
                    key: "organization_id",
                    label: "Organization ID",
                    visibleWhen: { path: "type", oneOf: ["drop.entitlement.grant"] },
                },
                {
                    key: "category_id",
                    label: "Category ID（可选）",
                    visibleWhen: { path: "type", oneOf: ["drop.entitlement.grant"] },
                },
                {
                    key: "campaign_id",
                    label: "Campaign ID（可选）",
                    visibleWhen: { path: "type", oneOf: ["drop.entitlement.grant"] },
                },
                {
                    key: "client_id",
                    label: "Client ID 覆盖",
                    visibleWhen: {
                        path: "type",
                        oneOf: [
                            "user.authorization.grant",
                            "user.authorization.revoke",
                            "conduit.shard.disabled",
                        ],
                    },
                },
                {
                    key: "conduit_id",
                    label: "Conduit ID",
                    visibleWhen: { path: "type", oneOf: ["conduit.shard.disabled"] },
                },
                {
                    key: "extension_client_id",
                    label: "Extension Client ID",
                    visibleWhen: {
                        path: "type",
                        oneOf: ["extension.bits_transaction.create"],
                    },
                },
            ],
        },
    },
    webhook_callback_url: {
        type: "string",
        label: "公网 Webhook Callback URL",
        placeholder: "https://bot.example.com/twitch/account/eventsub",
        description: "Twitch 必须能通过公网 HTTPS 443 访问；不跟随重定向",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    http_path: {
        type: "string",
        label: "本地 HTTP 挂载路径",
        placeholder: "/twitch/account/eventsub",
        description: "反向代理改写路径时单独设置；默认从 callback URL 推导",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    webhook_secret: {
        type: "string",
        sensitive: true,
        min: 10,
        max: 100,
        label: "Webhook HMAC Secret",
        description: "10–100 个 ASCII 字符，用于 HMAC-SHA256 验签",
        ui: {
            section: "credentials",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    keepalive_timeout_seconds: {
        type: "number",
        default: 30,
        min: 10,
        max: 600,
        label: "EventSub Keepalive（秒）",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["websocket"] },
        },
    },
    reconnect_initial_delay_ms: {
        type: "number",
        default: 1000,
        min: 100,
        max: 60000,
        label: "重连初始延迟（ms）",
        description: "异常断线后指数退避起点；默认无限重连",
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
        label: "连接握手超时（ms）",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["websocket"] },
        },
    },
    webhook_tolerance_seconds: {
        type: "number",
        default: 600,
        min: 10,
        max: 3600,
        label: "Webhook 重放时窗（秒）",
        ui: {
            section: "delivery",
            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
        },
    },
    max_response_bytes: {
        type: "number",
        default: 10485760,
        min: 1024,
        max: 52428800,
        label: "响应与 Webhook 上限（bytes）",
        description: "限制不可信网络响应和入站 body 的内存占用",
        ui: { section: "advanced" },
    },
    api_base_url: {
        type: "string",
        default: "https://api.twitch.tv/helix/",
        label: "Helix API Base URL",
        description: "通常无需修改；嵌入测试可注入本地回环服务",
        ui: { section: "advanced" },
    },
    eventsub_websocket_url: {
        type: "string",
        default: "wss://eventsub.wss.twitch.tv/ws",
        label: "EventSub WebSocket URL",
        ui: {
            section: "advanced",
            visibleWhen: { path: "receive_mode", oneOf: ["websocket"] },
        },
    },
};

AdapterRegistry.registerSchema("twitch", twitchSchema);

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            twitch: TwitchConfig;
        }
    }
}

AdapterRegistry.register("twitch", TwitchAdapter, {
    name: "twitch",
    displayName: "Twitch",
    description: "Twitch Helix、EventSub WebSocket/Webhook、已有 Host 与 manual ingress 适配器",
    icon: "https://assets.twitch.tv/assets/favicon-32-e29e246c157142c94346.png",
    homepage: "https://dev.twitch.tv/docs/",
    author: "凉菜",
    capabilities: twitchCapabilities,
});
