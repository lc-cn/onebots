import { AdapterRegistry, type Schema } from "onebots";

export { LineAdapter } from "./adapter.js";
export { LineBot, type LineEventRepository } from "./bot.js";
export { lineCapabilities } from "./capabilities.js";
export { LineApiError, type LineApiErrorOptions } from "./errors.js";
export { chunkLineMessages, compileLineMessages } from "./messages.js";
export { projectLineEvent, projectMessageContent } from "./events.js";
export type {
    LineConfig,
    LineChatContext,
    WebhookRequest,
    WebhookEvent,
    EventSource,
    MessageEvent,
    FollowEvent,
    UnfollowEvent,
    JoinEvent,
    LeaveEvent,
    MemberJoinedEvent,
    MemberLeftEvent,
    PostbackEvent,
    UnsendEvent,
    MessageEditedEvent,
    Message,
    TextMessage,
    ImageMessage,
    VideoMessage,
    AudioMessage,
    FileMessage,
    LocationMessage,
    StickerMessage,
    SendMessage,
    SendMessageResponse,
    UserProfile,
    GroupSummary,
    GroupMemberProfile,
    GroupMemberCount,
} from "./types.js";

const lineSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "OneBots 内部区分 LINE Official Account 的稳定标识",
    },
    channel_access_token: {
        type: "string",
        required: true,
        label: "Channel Access Token",
        description: "LINE Developers Console 的 Messaging API Channel Access Token",
        ui: { section: "credentials" },
    },
    channel_secret: {
        type: "string",
        required: true,
        label: "Channel Secret",
        description: "仅用于对原始 Webhook 请求体做 HMAC-SHA256 验签",
        ui: { section: "credentials" },
    },
    deduplicate_webhooks: {
        type: "boolean",
        default: true,
        label: "过滤重复 Webhook",
        description: "按 webhookEventId 持久化过滤 LINE 重投递造成的重复事件",
        ui: { section: "delivery" },
    },
    webhook_deduplication_limit: {
        type: "number",
        default: 10000,
        label: "去重缓存上限",
        description: "进程内保留的最近 webhookEventId 数量，最低 100",
        ui: { section: "advanced" },
    },
    api_base_url: {
        type: "string",
        default: "https://api.line.me",
        label: "Messaging API Base URL",
        description: "仅官方兼容实现、私有代理或测试环境需要覆盖，必须使用 HTTPS",
        ui: { section: "advanced" },
    },
    data_api_base_url: {
        type: "string",
        default: "https://api-data.line.me",
        label: "Data API Base URL",
        description: "媒体内容与 Rich Menu 图片接口地址，必须使用 HTTPS",
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("line", lineSchema);
