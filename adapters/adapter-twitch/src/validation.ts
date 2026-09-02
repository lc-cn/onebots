import { TwitchError } from "./errors.js";
import type {
    TwitchChannel,
    TwitchChatter,
    TwitchChatMessageResponse,
    TwitchEventSubMessage,
    TwitchEventSubMetadata,
    TwitchEventSubSession,
    TwitchEventSubSubscription,
    TwitchStream,
    TwitchUser,
} from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseEventSubMessage(value: unknown): TwitchEventSubMessage {
    const root = record(value, "EventSub envelope");
    rejectUnknown(root, ["metadata", "payload"], "EventSub envelope");
    const metadata = parseMetadata(root.metadata);
    const payload = record(root.payload, "EventSub payload");
    const session = payload.session === undefined ? undefined : parseSession(payload.session);
    const subscription =
        payload.subscription === undefined
            ? undefined
            : parseEventSubSubscription(payload.subscription);
    const event = payload.event === undefined ? undefined : record(payload.event, "EventSub event");
    const events =
        payload.events === undefined ? undefined : recordArray(payload.events, "EventSub events");
    const challenge =
        payload.challenge === undefined
            ? undefined
            : string(payload.challenge, "payload.challenge");
    assertPayloadForType(metadata.message_type, {
        session,
        subscription,
        event,
        events,
        challenge,
    });
    return { metadata, payload: { session, subscription, event, events, challenge } };
}

export function parseUser(value: unknown): TwitchUser {
    const data = record(value, "Twitch user");
    return {
        id: string(data.id, "user.id"),
        login: string(data.login, "user.login"),
        display_name: string(data.display_name, "user.display_name"),
        type: optionalString(data.type) || "",
        broadcaster_type: optionalString(data.broadcaster_type) || "",
        description: optionalString(data.description) || "",
        profile_image_url: httpUrl(data.profile_image_url, "user.profile_image_url"),
        offline_image_url: optionalHttpUrl(data.offline_image_url, "user.offline_image_url") || "",
        view_count: optionalNumber(data.view_count, "user.view_count"),
        email: optionalString(data.email),
        created_at: timestamp(data.created_at, "user.created_at"),
    };
}

export function parseChannel(value: unknown): TwitchChannel {
    const data = record(value, "Twitch channel");
    return {
        broadcaster_id: string(data.broadcaster_id, "channel.broadcaster_id"),
        broadcaster_login: string(data.broadcaster_login, "channel.broadcaster_login"),
        broadcaster_name: string(data.broadcaster_name, "channel.broadcaster_name"),
        broadcaster_language: optionalString(data.broadcaster_language) || "",
        game_id: optionalString(data.game_id) || "",
        game_name: optionalString(data.game_name) || "",
        title: optionalString(data.title) || "",
        delay: optionalNumber(data.delay, "channel.delay") || 0,
        tags: optionalStrings(data.tags, "channel.tags"),
        content_classification_labels: optionalStrings(
            data.content_classification_labels,
            "channel.content_classification_labels",
        ),
        is_branded_content: optionalBoolean(data.is_branded_content, "channel.is_branded_content"),
    };
}

export function parseStream(value: unknown): TwitchStream {
    const data = record(value, "Twitch stream");
    const type = optionalString(data.type) || "";
    if (type !== "" && type !== "live") throw TwitchError.protocol("stream.type 无效", { type });
    return {
        id: string(data.id, "stream.id"),
        user_id: string(data.user_id, "stream.user_id"),
        user_login: string(data.user_login, "stream.user_login"),
        user_name: string(data.user_name, "stream.user_name"),
        game_id: optionalString(data.game_id) || "",
        game_name: optionalString(data.game_name) || "",
        type,
        title: optionalString(data.title) || "",
        viewer_count: number(data.viewer_count, "stream.viewer_count"),
        started_at: timestamp(data.started_at, "stream.started_at"),
        language: optionalString(data.language) || "",
        thumbnail_url: optionalHttpUrl(data.thumbnail_url, "stream.thumbnail_url") || "",
        tag_ids: optionalStrings(data.tag_ids, "stream.tag_ids"),
        tags: optionalStrings(data.tags, "stream.tags"),
        is_mature: optionalBoolean(data.is_mature, "stream.is_mature") || false,
    };
}

export function parseChatMessageResponse(value: unknown): TwitchChatMessageResponse {
    const data = record(value, "Send Chat Message response");
    const drop = data.drop_reason;
    return {
        message_id: string(data.message_id, "chat.message_id"),
        is_sent: boolean(data.is_sent, "chat.is_sent"),
        drop_reason:
            drop === undefined || drop === null
                ? undefined
                : {
                      code: string(record(drop, "chat.drop_reason").code, "drop_reason.code"),
                      message: string(
                          record(drop, "chat.drop_reason").message,
                          "drop_reason.message",
                      ),
                  },
    };
}

export function parseChatter(value: unknown): TwitchChatter {
    const data = record(value, "Twitch chatter");
    return {
        user_id: string(data.user_id, "chatter.user_id"),
        user_login: string(data.user_login, "chatter.user_login"),
        user_name: string(data.user_name, "chatter.user_name"),
    };
}

export function parseDataArray<T>(
    value: unknown,
    parser: (item: unknown) => T,
    context: string,
): T[] {
    const root = record(value, context);
    if (!Array.isArray(root.data)) throw TwitchError.protocol(`${context}.data 必须是数组`);
    return root.data.map(parser);
}

function parseMetadata(value: unknown): TwitchEventSubMetadata {
    const data = record(value, "EventSub metadata");
    const messageType = string(data.message_type, "metadata.message_type");
    if (
        ![
            "session_welcome",
            "session_keepalive",
            "notification",
            "session_reconnect",
            "revocation",
            "webhook_callback_verification",
        ].includes(messageType)
    ) {
        throw TwitchError.protocol(`未知 EventSub message_type: ${messageType}`);
    }
    return {
        message_id: string(data.message_id, "metadata.message_id"),
        message_type: messageType as TwitchEventSubMetadata["message_type"],
        message_timestamp: timestamp(data.message_timestamp, "metadata.message_timestamp"),
        subscription_type: optionalString(data.subscription_type),
        subscription_version: optionalString(data.subscription_version),
    };
}

function parseSession(value: unknown): TwitchEventSubSession {
    const data = record(value, "EventSub session");
    const timeout = data.keepalive_timeout_seconds;
    return {
        id: string(data.id, "session.id"),
        status: string(data.status, "session.status"),
        connected_at: timestamp(data.connected_at, "session.connected_at"),
        keepalive_timeout_seconds:
            timeout === null ? null : number(timeout, "session.keepalive_timeout_seconds"),
        reconnect_url:
            data.reconnect_url === null
                ? null
                : optionalWsUrl(data.reconnect_url, "session.reconnect_url"),
    };
}

export function parseEventSubSubscription(value: unknown): TwitchEventSubSubscription {
    const data = record(value, "EventSub subscription");
    return {
        id: string(data.id, "subscription.id"),
        status: string(data.status, "subscription.status"),
        type: string(data.type, "subscription.type"),
        version: string(data.version, "subscription.version"),
        cost: number(data.cost, "subscription.cost"),
        condition: stringRecord(data.condition, "subscription.condition"),
        transport: record(data.transport, "subscription.transport"),
        created_at: timestamp(data.created_at, "subscription.created_at"),
    };
}

function assertPayloadForType(
    type: TwitchEventSubMetadata["message_type"],
    payload: {
        session?: TwitchEventSubSession;
        subscription?: TwitchEventSubSubscription;
        event?: Record<string, unknown>;
        events?: Record<string, unknown>[];
        challenge?: string;
    },
): void {
    if (
        ["session_welcome", "session_keepalive", "session_reconnect"].includes(type) &&
        !payload.session
    ) {
        throw TwitchError.protocol(`${type} 缺少 payload.session`);
    }
    if (
        type === "notification" &&
        (!payload.subscription || (!payload.event && !payload.events?.length))
    ) {
        throw TwitchError.protocol("notification 缺少 subscription、event 或 events");
    }
    if (type === "revocation" && !payload.subscription)
        throw TwitchError.protocol("revocation 缺少 subscription");
    if (type === "webhook_callback_verification" && (!payload.subscription || !payload.challenge)) {
        throw TwitchError.protocol("webhook_callback_verification 缺少 subscription 或 challenge");
    }
}

function recordArray(value: unknown, field: string): Record<string, unknown>[] {
    if (!Array.isArray(value) || !value.length) {
        throw TwitchError.protocol(`${field} 必须是非空对象数组`);
    }
    return value.map((item, index) => record(item, `${field}[${index}]`));
}

function record(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) throw TwitchError.protocol(`${field} 必须是对象`);
    return value;
}

function string(value: unknown, field: string): string {
    if (typeof value !== "string" || !value)
        throw TwitchError.protocol(`${field} 必须是非空字符串`);
    return value;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function number(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value))
        throw TwitchError.protocol(`${field} 必须是有限数字`);
    return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
    return value === undefined ? undefined : number(value, field);
}

function boolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") throw TwitchError.protocol(`${field} 必须是布尔值`);
    return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
    return value === undefined ? undefined : boolean(value, field);
}

function timestamp(value: unknown, field: string): string {
    const text = string(value, field);
    if (!Number.isFinite(Date.parse(text)))
        throw TwitchError.protocol(`${field} 必须是 RFC3339 时间`);
    return text;
}

function httpUrl(value: unknown, field: string): string {
    const text = string(value, field);
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:")
        throw TwitchError.protocol(`${field} 必须是 HTTP URL`);
    return text;
}

function optionalHttpUrl(value: unknown, field: string): string | undefined {
    return value === undefined || value === "" ? undefined : httpUrl(value, field);
}

function optionalWsUrl(value: unknown, field: string): string | null {
    if (value === null) return null;
    const text = string(value, field);
    const url = new URL(text);
    if (url.protocol !== "wss:" && url.protocol !== "ws:")
        throw TwitchError.protocol(`${field} 必须是 WebSocket URL`);
    return text;
}

function optionalStrings(value: unknown, field: string): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some(item => typeof item !== "string"))
        throw TwitchError.protocol(`${field} 必须是字符串数组`);
    return [...value] as string[];
}

function stringRecord(value: unknown, field: string): Record<string, string> {
    const data = record(value, field);
    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(data)) result[key] = string(item, `${field}.${key}`);
    return result;
}

function rejectUnknown(
    value: Record<string, unknown>,
    allowed: readonly string[],
    field: string,
): void {
    const unknown = Object.keys(value).find(key => !allowed.includes(key));
    if (unknown) throw TwitchError.protocol(`${field} 包含未知顶层字段 ${unknown}`);
}
