/**
 * Discord REST API 轻量封装
 * Node.js 使用原生 https 模块，Cloudflare Workers 使用 fetch
 */

const DISCORD_API_BASE = "https://discord.com/api/v10";
import type { DiscordUpload } from "../media.js";
import type { ProxyConfig } from "../config-types.js";
import { DiscordError } from "../errors.js";
import { buildDiscordMultipart } from "./multipart.js";
import { DefaultDiscordHttpTransport, type DiscordHttpTransport } from "./rest-transport.js";
import { DiscordRateLimitCoordinator, discordRouteKey } from "./rest-rate-limit.js";
import type {
    CreateMessageBody,
    EditMessageBody,
    DiscordApiMessage,
    DiscordApiChannel,
    DiscordApiGuild,
    DiscordApiUser,
    DiscordApiGuildMember,
    GatewayQueryOptions,
    GatewayMemberQueryOptions,
} from "../types.js";

export interface RESTOptions {
    token: string;
    proxy?: ProxyConfig;
    transport?: DiscordHttpTransport;
    apiBaseUrl?: string;
    maxRateLimitRetries?: number;
}

export interface RequestOptions {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    headers?: Record<string, string>;
    query?: Record<
        string,
        string | number | boolean | undefined | readonly (string | number | boolean | undefined)[]
    >;
    reason?: string;
    signal?: AbortSignal;
}

/**
 * 轻量版 Discord REST 客户端
 */
export class DiscordREST {
    private readonly token: string;
    private readonly apiBaseUrl: string;
    private readonly rateLimits: DiscordRateLimitCoordinator;

    constructor(options: RESTOptions) {
        if (!options.token?.trim()) {
            throw DiscordError.configuration("Discord token 不能为空", "DISCORD_TOKEN_REQUIRED");
        }
        this.token = options.token;
        const transport = options.transport ?? new DefaultDiscordHttpTransport(options.proxy);
        this.apiBaseUrl = resolveApiBaseUrl(options.apiBaseUrl);
        const maxRateLimitRetries = options.maxRateLimitRetries ?? 5;
        if (!Number.isSafeInteger(maxRateLimitRetries) || maxRateLimitRetries < 0) {
            throw DiscordError.configuration(
                "Discord maxRateLimitRetries 必须为非负整数",
                "DISCORD_RATE_LIMIT_RETRIES_INVALID",
            );
        }
        this.rateLimits = new DiscordRateLimitCoordinator(transport, maxRateLimitRetries);
    }

    /**
     * 发送请求
     */
    async request<T = unknown>(endpoint: string, options: RequestOptions = {}): Promise<T> {
        assertDiscordEndpoint(endpoint);
        const { method = "GET", body, headers = {}, query } = options;
        let url = `${this.apiBaseUrl}${endpoint}`;
        if (query) {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(query)) {
                if (Array.isArray(value)) {
                    for (const item of value)
                        if (item !== undefined) params.append(key, String(item));
                } else if (value !== undefined) {
                    params.append(key, String(value));
                }
            }
            if (params.size) url += `?${params.toString()}`;
        }

        const requestHeaders: Record<string, string> = {
            "Authorization": `Bot ${this.token}`,
            "Content-Type": "application/json",
            "User-Agent": "OneBots Discord Lite (https://github.com/lc-cn/onebots)",
            ...(options.reason ? { "X-Audit-Log-Reason": encodeURIComponent(options.reason) } : {}),
            ...headers,
        };
        if (options.reason && options.reason.length > 512) {
            throw DiscordError.invalid(
                "Discord 审计日志原因不能超过 512 个字符",
                "DISCORD_AUDIT_REASON_INVALID",
            );
        }
        const routeKey = discordRouteKey(method, endpoint);
        return this.rateLimits.request<T>({
            routeKey,
            endpoint,
            url,
            request: {
                method,
                headers: requestHeaders,
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: options.signal,
            },
        });
    }

    /** 按 Discord 官方 files[n] + payload_json 约定发送附件。 */
    async requestMultipart<T = unknown>(
        endpoint: string,
        payload: CreateMessageBody,
        files: DiscordUpload[],
    ): Promise<T> {
        assertDiscordEndpoint(endpoint);
        if (!files.length) return this.request<T>(endpoint, { method: "POST", body: payload });
        const multipart = buildDiscordMultipart(payload, files);
        const headers = {
            "Authorization": `Bot ${this.token}`,
            "Content-Type": multipart.contentType,
            "Content-Length": String(multipart.body.byteLength),
            "User-Agent": "OneBots Discord Lite (https://github.com/lc-cn/onebots)",
        };
        const routeKey = discordRouteKey("POST", endpoint);
        return this.rateLimits.request<T>({
            routeKey,
            endpoint,
            url: `${this.apiBaseUrl}${endpoint}`,
            request: {
                method: "POST",
                headers,
                body: multipart.body,
            },
        });
    }

    // ============================================
    // 用户相关
    // ============================================

    /** 获取当前用户 */
    async getCurrentUser(): Promise<DiscordApiUser> {
        return this.request<DiscordApiUser>("/users/@me");
    }

    /** 获取用户 */
    async getUser(userId: string): Promise<DiscordApiUser> {
        return this.request<DiscordApiUser>(`/users/${snowflake(userId, "userId")}`);
    }

    // ============================================
    // 频道相关
    // ============================================

    /** 获取频道 */
    async getChannel(channelId: string): Promise<DiscordApiChannel> {
        return this.request<DiscordApiChannel>(`/channels/${snowflake(channelId, "channelId")}`);
    }

    /** 发送消息 */
    async createMessage(
        channelId: string,
        content: string | CreateMessageBody,
        files: DiscordUpload[] = [],
    ): Promise<DiscordApiMessage> {
        channelId = snowflake(channelId, "channelId");
        const body = typeof content === "string" ? { content } : content;
        if (files.length) {
            return this.requestMultipart<DiscordApiMessage>(
                `/channels/${channelId}/messages`,
                body,
                files,
            );
        }
        return this.request<DiscordApiMessage>(`/channels/${channelId}/messages`, {
            method: "POST",
            body,
        });
    }

    /** 编辑消息 */
    async editMessage(
        channelId: string,
        messageId: string,
        content: string | EditMessageBody,
    ): Promise<DiscordApiMessage> {
        channelId = snowflake(channelId, "channelId");
        messageId = snowflake(messageId, "messageId");
        const body = typeof content === "string" ? { content } : content;
        return this.request<DiscordApiMessage>(`/channels/${channelId}/messages/${messageId}`, {
            method: "PATCH",
            body,
        });
    }

    /** 删除消息 */
    async deleteMessage(channelId: string, messageId: string): Promise<void> {
        channelId = snowflake(channelId, "channelId");
        messageId = snowflake(messageId, "messageId");
        return this.request<void>(`/channels/${channelId}/messages/${messageId}`, {
            method: "DELETE",
        });
    }

    /** 获取消息 */
    async getMessage(channelId: string, messageId: string): Promise<DiscordApiMessage> {
        channelId = snowflake(channelId, "channelId");
        messageId = snowflake(messageId, "messageId");
        return this.request<DiscordApiMessage>(`/channels/${channelId}/messages/${messageId}`);
    }

    /** 获取消息历史 */
    async getMessages(
        channelId: string,
        options?: GatewayQueryOptions,
    ): Promise<DiscordApiMessage[]> {
        channelId = snowflake(channelId, "channelId");
        return this.request<DiscordApiMessage[]>(`/channels/${channelId}/messages`, {
            query: options as Record<string, string>,
        });
    }

    // ============================================
    // 服务器相关
    // ============================================

    /** 获取服务器 */
    async getGuild(guildId: string): Promise<DiscordApiGuild> {
        return this.request<DiscordApiGuild>(`/guilds/${snowflake(guildId, "guildId")}`);
    }

    /** 获取服务器列表 */
    async getGuilds(options?: {
        limit?: number;
        before?: string;
        after?: string;
        with_counts?: boolean;
    }): Promise<DiscordApiGuild[]> {
        return this.request<DiscordApiGuild[]>("/users/@me/guilds", { query: options });
    }

    /** 获取服务器成员 */
    async getGuildMember(guildId: string, userId: string): Promise<DiscordApiGuildMember> {
        guildId = snowflake(guildId, "guildId");
        userId = snowflake(userId, "userId");
        return this.request<DiscordApiGuildMember>(`/guilds/${guildId}/members/${userId}`);
    }

    /** 获取服务器成员列表 */
    async getGuildMembers(
        guildId: string,
        options?: GatewayMemberQueryOptions,
    ): Promise<DiscordApiGuildMember[]> {
        guildId = snowflake(guildId, "guildId");
        return this.request<DiscordApiGuildMember[]>(`/guilds/${guildId}/members`, {
            query: options as Record<string, string>,
        });
    }

    /** 踢出成员 */
    async removeGuildMember(guildId: string, userId: string, reason?: string): Promise<void> {
        guildId = snowflake(guildId, "guildId");
        userId = snowflake(userId, "userId");
        return this.request<void>(`/guilds/${guildId}/members/${userId}`, {
            method: "DELETE",
            reason,
        });
    }

    /** 封禁成员 */
    async banGuildMember(
        guildId: string,
        userId: string,
        options?: { delete_message_seconds?: number; reason?: string },
    ): Promise<void> {
        guildId = snowflake(guildId, "guildId");
        userId = snowflake(userId, "userId");
        return this.request<void>(`/guilds/${guildId}/bans/${userId}`, {
            method: "PUT",
            body: { delete_message_seconds: options?.delete_message_seconds },
            reason: options?.reason,
        });
    }

    // ============================================
    // Interactions 相关
    // ============================================

    /** 回复 Interaction */
    async createInteractionResponse(
        interactionId: string,
        interactionToken: string,
        response: { type: number; data?: unknown },
    ): Promise<void> {
        interactionId = snowflake(interactionId, "interactionId");
        interactionToken = pathToken(interactionToken, "interactionToken");
        return this.request<void>(`/interactions/${interactionId}/${interactionToken}/callback`, {
            method: "POST",
            body: response,
        });
    }

    /** 获取原始 Interaction 回复 */
    async getOriginalInteractionResponse(
        applicationId: string,
        interactionToken: string,
    ): Promise<DiscordApiMessage> {
        applicationId = snowflake(applicationId, "applicationId");
        interactionToken = pathToken(interactionToken, "interactionToken");
        return this.request<DiscordApiMessage>(
            `/webhooks/${applicationId}/${interactionToken}/messages/@original`,
        );
    }

    /** 编辑原始 Interaction 回复 */
    async editOriginalInteractionResponse(
        applicationId: string,
        interactionToken: string,
        content: EditMessageBody,
    ): Promise<DiscordApiMessage> {
        applicationId = snowflake(applicationId, "applicationId");
        interactionToken = pathToken(interactionToken, "interactionToken");
        return this.request<DiscordApiMessage>(
            `/webhooks/${applicationId}/${interactionToken}/messages/@original`,
            {
                method: "PATCH",
                body: content,
            },
        );
    }

    /** 创建后续消息 */
    async createFollowupMessage(
        applicationId: string,
        interactionToken: string,
        content: CreateMessageBody,
    ): Promise<DiscordApiMessage> {
        applicationId = snowflake(applicationId, "applicationId");
        interactionToken = pathToken(interactionToken, "interactionToken");
        return this.request<DiscordApiMessage>(`/webhooks/${applicationId}/${interactionToken}`, {
            method: "POST",
            body: content,
        });
    }

    // ============================================
    // Gateway 相关
    // ============================================

    /** 获取 Gateway URL */
    async getGateway(): Promise<{ url: string }> {
        return this.request<{ url: string }>("/gateway");
    }

    /** 获取 Gateway Bot URL（带分片信息） */
    async getGatewayBot(): Promise<{
        url: string;
        shards: number;
        session_start_limit: {
            total: number;
            remaining: number;
            reset_after: number;
            max_concurrency: number;
        };
    }> {
        return this.request("/gateway/bot");
    }
}

/** 只允许访问固定 Discord API 根下的相对资源路径。 */
export function assertDiscordEndpoint(
    endpoint: unknown,
    label = "Discord endpoint",
): asserts endpoint is string {
    if (
        typeof endpoint !== "string" ||
        !endpoint.startsWith("/") ||
        endpoint.startsWith("//") ||
        containsUnsafePathSegment(endpoint) ||
        endpoint.includes("?") ||
        endpoint.includes("#") ||
        endpoint.includes("\\")
    ) {
        throw DiscordError.invalid(
            `${label} 必须是 API 根下的安全绝对路径`,
            "DISCORD_ENDPOINT_INVALID",
        );
    }
}

function resolveApiBaseUrl(value = DISCORD_API_BASE): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw DiscordError.configuration(
            "Discord apiBaseUrl 必须为不含凭据、query 和 fragment 的 HTTPS URL",
            "DISCORD_API_BASE_URL_INVALID",
        );
    }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw DiscordError.configuration(
            "Discord apiBaseUrl 必须为不含凭据、query 和 fragment 的 HTTPS URL",
            "DISCORD_API_BASE_URL_INVALID",
        );
    }
    return url.toString().replace(/\/$/, "");
}

function containsUnsafePathSegment(endpoint: string): boolean {
    try {
        return endpoint
            .split("/")
            .slice(1)
            .some(segment => {
                const decoded = decodeURIComponent(segment);
                return decoded === "." || decoded === ".." || /[\\/]/.test(decoded);
            });
    } catch {
        // 百分号编码无效本身即为不安全路径。
        return true;
    }
}

function snowflake(value: string, label: string): string {
    if (!/^\d{1,20}$/.test(value)) {
        throw DiscordError.invalid(
            `Discord ${label} 必须为 Snowflake`,
            "DISCORD_SNOWFLAKE_INVALID",
        );
    }
    return value;
}

function pathToken(value: string, label: string): string {
    if (!value || /[\\/?#]/.test(value) || decodeURIComponentSafely(value) !== value) {
        throw DiscordError.invalid(
            `Discord ${label} 不是安全路径参数`,
            "DISCORD_PATH_TOKEN_INVALID",
        );
    }
    return value;
}

function decodeURIComponentSafely(value: string): string | undefined {
    try {
        return decodeURIComponent(value);
    } catch {
        // 非法百分号编码不是安全 token。
        return undefined;
    }
}
