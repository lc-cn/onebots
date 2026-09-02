import { EventEmitter } from "node:events";
import { assertTwitchApiPath } from "./configuration.js";
import { TwitchError } from "./errors.js";
import { FetchTwitchRestTransport, type TwitchRestTransport } from "./rest.js";
import type {
    TwitchApiResponse,
    TwitchCallOptions,
    TwitchChannel,
    TwitchChatter,
    TwitchChatMessageResponse,
    TwitchClientEvents,
    TwitchConfig,
    TwitchEventSubSubscription,
    TwitchHttpMethod,
    TwitchStream,
    TwitchUser,
} from "./types.js";
import {
    parseChannel,
    parseChatter,
    parseChatMessageResponse,
    parseDataArray,
    parseEventSubSubscription,
    parseStream,
    parseUser,
} from "./validation.js";

export interface TwitchApiDependencies {
    fetcher?: typeof fetch;
    rest?: TwitchRestTransport;
}

/** Twitch Helix 资源域：公开 call() 与常用强类型 API 共用同一鉴权、边界和错误模型。 */
export class TwitchApiClient extends EventEmitter<TwitchClientEvents> {
    private readonly rest: TwitchRestTransport;
    private currentUser?: TwitchUser;

    constructor(
        readonly config: TwitchConfig,
        dependencies: TwitchApiDependencies = {},
    ) {
        super();
        this.rest = dependencies.rest || new FetchTwitchRestTransport(config, dependencies.fetcher);
    }

    get me(): TwitchUser | undefined {
        return this.currentUser ? structuredClone(this.currentUser) : undefined;
    }

    call(
        method: TwitchHttpMethod,
        path: string,
        options: TwitchCallOptions = {},
    ): Promise<unknown> {
        return this.rest.call(method, assertTwitchApiPath(path), options);
    }

    async getMe(signal?: AbortSignal): Promise<TwitchUser> {
        const response = await this.call("GET", "users", {
            signal,
        });
        const user = parseDataArray(response, parseUser, "Get Users response")[0];
        if (!user)
            throw new TwitchError("Twitch access_token 未返回当前用户", {
                code: "TWITCH_USER_NOT_FOUND",
            });
        return user;
    }

    async getUsers(
        options: { ids?: readonly string[]; logins?: readonly string[] } = {},
    ): Promise<TwitchUser[]> {
        const ids = uniqueLimited(options.ids, "ids", 100);
        const logins = uniqueLimited(options.logins, "logins", 100);
        if (ids.length + logins.length > 100)
            throw TwitchError.invalid("Get Users 的 id + login 总数不能超过 100");
        return parseDataArray(
            await this.call("GET", "users", { query: { id: ids, login: logins } }),
            parseUser,
            "Get Users response",
        );
    }

    async getChannels(broadcasterIds: readonly string[]): Promise<TwitchChannel[]> {
        const ids = uniqueLimited(broadcasterIds, "broadcaster_ids", 100);
        if (!ids.length) throw TwitchError.invalid("broadcaster_ids 不能为空");
        return parseDataArray(
            await this.call("GET", "channels", { query: { broadcaster_id: ids } }),
            parseChannel,
            "Get Channel Information response",
        );
    }

    async getStreams(
        options: {
            userIds?: readonly string[];
            userLogins?: readonly string[];
            gameIds?: readonly string[];
            type?: "all" | "live";
            language?: readonly string[];
            first?: number;
            after?: string;
        } = {},
    ): Promise<TwitchApiResponse<TwitchStream>> {
        const response = (await this.call("GET", "streams", {
            query: {
                user_id: uniqueLimited(options.userIds, "user_ids", 100),
                user_login: uniqueLimited(options.userLogins, "user_logins", 100),
                game_id: uniqueLimited(options.gameIds, "game_ids", 100),
                type: options.type,
                language: uniqueLimited(options.language, "language", 100),
                first: bounded(options.first, "first", 1, 100),
                after: options.after,
            },
        })) as TwitchApiResponse;
        return { ...response, data: parseDataArray(response, parseStream, "Get Streams response") };
    }

    async getAllChatters(
        broadcasterId: string,
        moderatorId: string,
        signal?: AbortSignal,
    ): Promise<TwitchChatter[]> {
        const result: TwitchChatter[] = [];
        let after: string | undefined;
        do {
            const response = (await this.call("GET", "chat/chatters", {
                query: {
                    broadcaster_id: twitchId(broadcasterId, "broadcaster_id"),
                    moderator_id: twitchId(moderatorId, "moderator_id"),
                    first: 1000,
                    after,
                },
                signal,
            })) as TwitchApiResponse;
            result.push(...parseDataArray(response, parseChatter, "Get Chatters response"));
            after = response.pagination?.cursor;
        } while (after);
        return result;
    }

    async sendChatMessage(
        broadcasterId: string,
        message: string,
        options: { senderId?: string; replyParentMessageId?: string } = {},
    ): Promise<TwitchChatMessageResponse> {
        const response = await this.call("POST", "chat/messages", {
            body: {
                broadcaster_id: twitchId(broadcasterId, "broadcaster_id"),
                sender_id: twitchId(options.senderId || this.requireUserId(), "sender_id"),
                message: text(message, "message", 500),
                reply_parent_message_id: optionalText(
                    options.replyParentMessageId,
                    "reply_parent_message_id",
                    255,
                ),
            },
        });
        const result = parseDataArray(
            response,
            parseChatMessageResponse,
            "Send Chat Message response",
        )[0];
        if (!result) throw TwitchError.protocol("Send Chat Message 响应为空");
        if (!result.is_sent)
            throw new TwitchError(result.drop_reason?.message || "Twitch 拒绝发送聊天消息", {
                code: result.drop_reason?.code || "TWITCH_CHAT_MESSAGE_DROPPED",
                details: result,
            });
        return result;
    }

    sendWhisper(
        toUserId: string,
        message: string,
        fromUserId = this.requireUserId(),
    ): Promise<unknown> {
        return this.call("POST", "whispers", {
            query: {
                from_user_id: twitchId(fromUserId, "from_user_id"),
                to_user_id: twitchId(toUserId, "to_user_id"),
            },
            body: { message: text(message, "message", 500) },
        });
    }

    sendAnnouncement(
        broadcasterId: string,
        moderatorId: string,
        message: string,
        color?: "blue" | "green" | "orange" | "purple" | "primary",
    ): Promise<unknown> {
        return this.call("POST", "chat/announcements", {
            query: {
                broadcaster_id: twitchId(broadcasterId, "broadcaster_id"),
                moderator_id: twitchId(moderatorId, "moderator_id"),
            },
            body: { message: text(message, "message", 500), color },
        });
    }

    deleteChatMessage(
        broadcasterId: string,
        moderatorId: string,
        messageId?: string,
    ): Promise<unknown> {
        return this.call("DELETE", "moderation/chat", {
            query: {
                broadcaster_id: twitchId(broadcasterId, "broadcaster_id"),
                moderator_id: twitchId(moderatorId, "moderator_id"),
                message_id: optionalText(messageId, "message_id", 255),
            },
        });
    }

    banUser(
        broadcasterId: string,
        moderatorId: string,
        userId: string,
        options: { duration?: number; reason?: string } = {},
    ): Promise<unknown> {
        return this.call("POST", "moderation/bans", {
            query: {
                broadcaster_id: twitchId(broadcasterId, "broadcaster_id"),
                moderator_id: twitchId(moderatorId, "moderator_id"),
            },
            body: {
                data: {
                    user_id: twitchId(userId, "user_id"),
                    duration: bounded(options.duration, "duration", 1, 1_209_600),
                    reason: optionalText(options.reason, "reason", 500),
                },
            },
        });
    }

    unbanUser(broadcasterId: string, moderatorId: string, userId: string): Promise<unknown> {
        return this.call("DELETE", "moderation/bans", {
            query: {
                broadcaster_id: twitchId(broadcasterId, "broadcaster_id"),
                moderator_id: twitchId(moderatorId, "moderator_id"),
                user_id: twitchId(userId, "user_id"),
            },
        });
    }

    createEventSubSubscription(input: {
        type: string;
        version: string;
        condition: Record<string, string>;
        transport: Record<string, unknown>;
        is_batching_enabled?: true;
    }): Promise<unknown> {
        return this.call("POST", "eventsub/subscriptions", { body: input });
    }

    listEventSubSubscriptions(
        query: {
            status?: string;
            type?: string;
            userId?: string;
            after?: string;
        } = {},
    ): Promise<unknown> {
        const supplied = [query.status, query.type, query.userId].filter(Boolean);
        if (supplied.length > 1)
            throw TwitchError.invalid("EventSub list 的 status、type、user_id 只能提供一个");
        return this.call("GET", "eventsub/subscriptions", {
            query: {
                status: query.status,
                type: query.type,
                user_id: query.userId,
                after: query.after,
            },
        });
    }

    deleteEventSubSubscription(id: string): Promise<unknown> {
        return this.call("DELETE", "eventsub/subscriptions", {
            query: { id: text(id, "id", 255) },
        });
    }

    protected setCurrentUser(user: TwitchUser | undefined): void {
        this.currentUser = user;
    }

    protected requireUserId(): string {
        if (!this.currentUser)
            throw new TwitchError("Twitch Client 尚未完成身份验证", { code: "TWITCH_NOT_STARTED" });
        return this.currentUser.id;
    }
}

export function parseEventSubSubscriptions(value: unknown): TwitchEventSubSubscription[] {
    const root = value as TwitchApiResponse;
    if (!Array.isArray(root?.data))
        throw TwitchError.protocol("EventSub subscriptions.data 必须是数组");
    return root.data.map(parseEventSubSubscription);
}

function uniqueLimited(
    values: readonly string[] | undefined,
    field: string,
    max: number,
): string[] {
    const result = [...new Set((values || []).map(value => text(value, field, 255)))];
    if (result.length > max) throw TwitchError.invalid(`${field} 最多 ${max} 项`);
    return result;
}

function twitchId(value: string, field: string): string {
    if (!/^\d+$/u.test(value)) throw TwitchError.invalid(`${field} 必须是 Twitch 数字 ID`);
    return value;
}

function text(value: string, field: string, max: number): string {
    if (typeof value !== "string" || !value.trim() || value.length > max)
        throw TwitchError.invalid(`${field} 必须是 1 到 ${max} 个字符`);
    return value;
}

function optionalText(value: string | undefined, field: string, max: number): string | undefined {
    return value === undefined ? undefined : text(value, field, max);
}

function bounded(
    value: number | undefined,
    field: string,
    min: number,
    max: number,
): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isSafeInteger(value) || value < min || value > max)
        throw TwitchError.invalid(`${field} 必须是 ${min} 到 ${max} 的整数`);
    return value;
}
