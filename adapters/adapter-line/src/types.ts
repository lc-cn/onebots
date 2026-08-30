import type { messagingApi, webhook } from "@line/bot-sdk";

/** LINE Messaging API 账号配置。 */
export interface LineConfig {
    account_id: string;
    channel_access_token: string;
    channel_secret?: string;
    /** Webhook 由 OneBots 接收，或由已有 Host/消息队列手动 ingest。 */
    receive_mode?: "webhook" | "manual";
    /** 可选的 LINE destination user ID，用于拒绝投递到其他机器人的请求。 */
    destination?: string;
    /** 仅用于官方兼容实现或测试环境，生产环境应保留官方 HTTPS 地址。 */
    api_base_url?: string;
    /** 大文件与富菜单图片 API 地址。 */
    data_api_base_url?: string;
    /** 是否忽略 webhookEventId 重复投递，默认开启。 */
    deduplicate_webhooks?: boolean;
    /** 进程内最多保留的已处理 webhookEventId 数量。 */
    webhook_deduplication_limit?: number;
}

export interface LineIngestResult {
    accepted: number;
    duplicate: number;
    events: WebhookEvent[];
}

/** 已有 HTTP Host 交给 LINE 客户端的最小请求结构。 */
export interface LineHttpRequest {
    method: string;
    body?: string | Buffer;
    signature?: string;
}

/** 与具体 Web 框架无关的 LINE Webhook 响应。 */
export interface LineHttpResponse {
    status: number;
    headers: Readonly<Record<string, string>>;
    body: Record<string, unknown>;
    ingest?: LineIngestResult;
}

/** Koa 风格 Host 的最小桥接契约。 */
export interface LineHttpContext {
    method: string;
    request: { rawBody?: unknown };
    get(name: string): string;
    set(name: string, value: string): void;
    status: number;
    body?: unknown;
}

export type WebhookRequest = webhook.CallbackRequest;
export type WebhookEvent = webhook.Event;
export type EventSource = webhook.Source;
export type MessageEvent = webhook.MessageEvent;
export type FollowEvent = webhook.FollowEvent;
export type UnfollowEvent = webhook.UnfollowEvent;
export type JoinEvent = webhook.JoinEvent;
export type LeaveEvent = webhook.LeaveEvent;
export type MemberJoinedEvent = webhook.MemberJoinedEvent;
export type MemberLeftEvent = webhook.MemberLeftEvent;
export type PostbackEvent = webhook.PostbackEvent;
export type UnsendEvent = webhook.UnsendEvent;
export type MessageEditedEvent = webhook.MessageEditedEvent;
export type Message = webhook.MessageContent;
export type TextMessage = webhook.TextMessageContent;
export type ImageMessage = webhook.ImageMessageContent;
export type VideoMessage = webhook.VideoMessageContent;
export type AudioMessage = webhook.AudioMessageContent;
export type FileMessage = webhook.FileMessageContent;
export type LocationMessage = webhook.LocationMessageContent;
export type StickerMessage = webhook.StickerMessageContent;

export type SendMessage = messagingApi.Message;
export type SendMessageResponse = messagingApi.PushMessageResponse;
export type UserProfile = messagingApi.UserProfileResponse;
export type GroupSummary = messagingApi.GroupSummaryResponse;
export type GroupMemberProfile = messagingApi.GroupUserProfileResponse;
export type GroupMemberCount = messagingApi.GroupMemberCountResponse;

/** 从事件中积累的聊天上下文，用于补足 LINE 不提供的聊天列表。 */
export interface LineChatContext {
    id: string;
    type: "group" | "room";
    name?: string;
    updated_at: number;
}
