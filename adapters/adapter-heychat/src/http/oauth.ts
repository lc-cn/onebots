import { ErrorCategory } from "onebots";
import { HeychatApiError } from "../errors.js";
import type {
    HeychatConfig,
    HeychatOAuthEnabledConfig,
    HeychatOAuthToken,
    HeychatOAuthUserInfo,
    HeychatVoiceDurationQuery,
    HeychatVoiceDurationResult,
} from "../types.js";
import { normalizeHeychatBaseUrl } from "./url.js";

const DEFAULT_RESOURCE_BASE = "https://api.xiaoheihe.cn";

export interface HeychatOAuthTransport {
    request<T>(
        url: URL,
        method: "GET" | "POST",
        body: Buffer | undefined,
        headers: Record<string, string>,
        includeBotToken?: boolean,
    ): Promise<T>;
}

/**
 * 用户 OAuth 与机器人 REST 使用不同凭据和内容类型。
 * 独立客户端避免 client_secret 意外进入普通 API 请求。
 */
export class HeychatOAuthClient {
    private readonly config?: HeychatOAuthEnabledConfig;
    private readonly apiBase: string;
    private readonly resourceBase: string;

    constructor(
        config: HeychatConfig,
        defaultApiBase: string,
        private readonly transport: HeychatOAuthTransport,
    ) {
        this.config = config.oauth?.enabled === false ? undefined : config.oauth;
        this.apiBase = normalizeHeychatBaseUrl(
            this.config?.api_base_url || defaultApiBase,
            "oauth.api_base_url",
        );
        this.resourceBase = normalizeHeychatBaseUrl(
            this.config?.resource_base_url || DEFAULT_RESOURCE_BASE,
            "oauth.resource_base_url",
        );
    }

    buildAuthorizationUrl(scopes: readonly string[]): string {
        const config = this.requireConfig();
        const url = new URL(`${this.apiBase}/account/bot_oauth`);
        url.searchParams.set("client_id", config.client_id);
        url.searchParams.set("redirect_uri", config.redirect_uri);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", normalizeScopes(scopes));
        return url.toString();
    }

    exchangeCode(code: string): Promise<HeychatOAuthToken> {
        return this.requestToken({
            grant_type: "authorization_code",
            code: requiredValue(code, "code"),
            redirect_uri: this.requireConfig().redirect_uri,
        });
    }

    refreshToken(refreshToken: string): Promise<HeychatOAuthToken> {
        return this.requestToken({
            grant_type: "refresh_token",
            refresh_token: requiredValue(refreshToken, "refresh_token"),
        });
    }

    getUserInfo(
        accessToken: string | undefined,
        query?: Readonly<Record<string, string | undefined>>,
    ): Promise<HeychatOAuthUserInfo> {
        return this.requestResource("/chatroom/api/account/info", accessToken, query);
    }

    requestUserInfo(userId: string, scopes: readonly string[]): Promise<HeychatOAuthUserInfo> {
        const config = this.requireConfig();
        return this.requestResource(
            "/chatroom/api/account/info",
            undefined,
            {
                user_id: requiredValue(userId, "user_id"),
                client_id: config.client_id,
                redirect_uri: config.redirect_uri,
                scope: normalizeScopes(scopes),
            },
            this.apiBase,
        );
    }

    async getVoiceDuration(
        accessToken: string,
        query: HeychatVoiceDurationQuery,
    ): Promise<HeychatVoiceDurationResult> {
        validateDurationRange(query);
        return await this.requestResource("/chatroom/api/duration/chat", accessToken, query);
    }

    private async requestToken(
        params: Readonly<Record<string, string>>,
    ): Promise<HeychatOAuthToken> {
        const config = this.requireConfig();
        const body = new URLSearchParams({
            ...params,
            client_id: config.client_id,
            client_secret: config.client_secret,
        });
        const url = new URL(`${this.apiBase}/chatroom/api/token`);
        const result = await this.transport.request<unknown>(
            url,
            "POST",
            Buffer.from(body.toString()),
            {
                accept: "application/json, text/plain, */*",
                "content-type": "application/x-www-form-urlencoded",
            },
            false,
        );
        if (!isOAuthToken(result)) {
            throw new HeychatApiError("黑盒语音 OAuth 令牌响应结构无效", {
                code: "HEYCHAT_INVALID_OAUTH_RESPONSE",
                category: ErrorCategory.PROTOCOL,
                path: url.pathname,
                details: result,
            });
        }
        return result;
    }

    private requestResource<T>(
        path: "/chatroom/api/account/info" | "/chatroom/api/duration/chat",
        accessToken: string | undefined,
        query?: object,
        base = this.resourceBase,
    ): Promise<T> {
        const url = new URL(`${base}${path}`);
        for (const [key, value] of Object.entries(query || {})) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        return this.transport.request(url, "GET", undefined, {
            accept: "application/json, text/plain, */*",
            ...(accessToken
                ? { authorization: `Bearer ${requiredValue(accessToken, "access_token")}` }
                : {}),
        });
    }

    private requireConfig(): HeychatOAuthEnabledConfig {
        if (!this.config) {
            throw HeychatApiError.invalid(
                "调用 OAuth 授权或令牌动作前必须配置 oauth.client_id、client_secret 与 redirect_uri",
                "HEYCHAT_OAUTH_NOT_CONFIGURED",
            );
        }
        return this.config;
    }
}

function requiredValue(value: string, name: string): string {
    if (!value.trim()) {
        throw HeychatApiError.invalid(`${name} 不能为空`, "HEYCHAT_INVALID_ACTION_PARAMS");
    }
    return value;
}

function normalizeScopes(scopes: readonly string[]): string {
    const values = scopes.map(scope => scope.trim()).filter(Boolean);
    if (!values.length || values.length !== scopes.length) {
        throw HeychatApiError.invalid(
            "scope 必须包含至少一个非空权限",
            "HEYCHAT_INVALID_ACTION_PARAMS",
        );
    }
    return [...new Set(values)].join(" ");
}

function validateDurationRange(query: HeychatVoiceDurationQuery): void {
    const { begin_time: begin, end_time: end } = query;
    for (const [name, value] of Object.entries({ begin_time: begin, end_time: end })) {
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
            throw HeychatApiError.invalid(
                `${name} 必须是非负秒级时间戳`,
                "HEYCHAT_INVALID_ACTION_PARAMS",
            );
        }
    }
    if (begin !== undefined && end !== undefined && (end < begin || end - begin > 30 * 86400)) {
        throw HeychatApiError.invalid(
            "begin_time 到 end_time 必须正序且不超过 30 天",
            "HEYCHAT_INVALID_ACTION_PARAMS",
        );
    }
}

function isOAuthToken(value: unknown): value is HeychatOAuthToken {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const token = value as Partial<HeychatOAuthToken>;
    return (
        typeof token.access_token === "string" &&
        token.access_token.length > 0 &&
        Number.isSafeInteger(token.expires_in) &&
        (token.expires_in ?? 0) > 0 &&
        typeof token.refresh_token === "string" &&
        token.refresh_token.length > 0 &&
        typeof token.scope === "string" &&
        token.token_type === "Bearer"
    );
}
