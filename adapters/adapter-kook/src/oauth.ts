import { ErrorCategory, isSafeAbsoluteApiPath } from "onebots";
import { KookApiError, KookError } from "./errors.js";
import { assertKookOAuthConfig } from "./config.js";
import type {
    KookApiEnvelope,
    KookConfig,
    KookGuild,
    KookListResponse,
    KookOAuthEnabledConfig,
    KookOAuthScope,
    KookOAuthToken,
    KookUser,
} from "./types.js";
import type { KookHttpTransport } from "./rest-client.js";

const DEFAULT_API_BASE = "https://www.kookapp.cn/api";
const DEFAULT_AUTHORIZATION_URL = "https://www.kookapp.cn/app/oauth2/authorize";
const OAUTH_SCOPES = new Set<KookOAuthScope>(["get_user_info", "get_user_guilds"]);

/** KOOK 用户 OAuth 与机器人 REST 凭据隔离的请求边界。 */
export class KookOAuthClient {
    private readonly config?: KookOAuthEnabledConfig;
    private readonly apiBase: string;
    private readonly authorizationUrl: string;
    private readonly tokenUrl: string;

    constructor(
        config: Pick<KookConfig, "api_base_url" | "oauth">,
        private readonly transport: KookHttpTransport = fetch,
    ) {
        assertKookOAuthConfig(config.oauth);
        this.config = config.oauth?.enabled === false ? undefined : config.oauth;
        this.apiBase = normalizeEndpointUrl(
            config.api_base_url || DEFAULT_API_BASE,
            "api_base_url",
        );
        this.authorizationUrl = normalizeEndpointUrl(
            this.config?.authorization_url || DEFAULT_AUTHORIZATION_URL,
            "oauth.authorization_url",
        );
        this.tokenUrl = normalizeEndpointUrl(
            this.config?.token_url || `${this.apiBase}/oauth2/token`,
            "oauth.token_url",
        );
    }

    buildAuthorizationUrl(scopes: readonly KookOAuthScope[], state: string): string {
        const config = this.requireConfig();
        const url = new URL(this.authorizationUrl);
        url.searchParams.set("client_id", config.client_id);
        url.searchParams.set("redirect_uri", config.redirect_uri);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", normalizeScopes(scopes));
        url.searchParams.set("state", requiredValue(state, "state"));
        return url.toString();
    }

    async exchangeCode(code: string): Promise<KookOAuthToken> {
        const config = this.requireConfig();
        const body = new URLSearchParams({
            grant_type: "authorization_code",
            client_id: config.client_id,
            client_secret: config.client_secret,
            code: requiredValue(code, "code"),
            redirect_uri: config.redirect_uri,
        });
        const result = await this.requestJson(this.tokenUrl, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
        });
        if (!isOAuthToken(result)) {
            throw new KookError("KOOK OAuth 令牌响应结构无效", {
                code: "KOOK_OAUTH_RESPONSE_INVALID",
                category: ErrorCategory.PROTOCOL,
                path: new URL(this.tokenUrl).pathname,
                details: result,
            });
        }
        return result;
    }

    getUserInfo(accessToken: string): Promise<KookUser> {
        return this.call(accessToken, "/v3/user/me");
    }

    listUserGuilds(
        accessToken: string,
        query: Readonly<Record<string, string | number | boolean | undefined>> = {},
    ): Promise<KookListResponse<KookGuild>> {
        return this.call(accessToken, "/v3/guild/list", query);
    }

    async call<T>(
        accessToken: string,
        path: string,
        query: Readonly<Record<string, string | number | boolean | undefined>> = {},
    ): Promise<T> {
        assertOAuthPath(path);
        const url = new URL(`${this.apiBase}${path}`);
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        const result = await this.requestJson(url.toString(), {
            method: "GET",
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${requiredValue(accessToken, "access_token")}`,
            },
        });
        const envelope = parseEnvelope<T>(result, path);
        if (envelope.code !== 0) {
            throw new KookApiError(
                envelope.message || "KOOK OAuth API 调用失败",
                200,
                envelope.code,
                path,
                undefined,
                envelope,
            );
        }
        return envelope.data;
    }

    private async requestJson(url: string, init: RequestInit): Promise<unknown> {
        let response: Response;
        try {
            response = await this.transport(url, init);
        } catch (error) {
            throw KookError.wrap(error, "KOOK_OAUTH_NETWORK_ERROR", {
                method: init.method,
                path: new URL(url).pathname,
            });
        }
        const text = await response.text();
        let result: unknown;
        try {
            result = JSON.parse(text) as unknown;
        } catch (error) {
            throw new KookError("KOOK OAuth API 返回了无效 JSON", {
                code: "KOOK_OAUTH_JSON_INVALID",
                category: ErrorCategory.PROTOCOL,
                status: response.status,
                path: new URL(url).pathname,
                details: text,
                cause: error,
            });
        }
        if (!response.ok) {
            throw new KookError(`KOOK OAuth API 请求失败（HTTP ${response.status}）`, {
                code: "KOOK_OAUTH_HTTP_ERROR",
                status: response.status,
                path: new URL(url).pathname,
                details: result,
            });
        }
        return result;
    }

    private requireConfig(): KookOAuthEnabledConfig {
        if (!this.config) {
            throw KookError.configuration(
                "调用 KOOK OAuth 授权或换码前必须启用并配置 oauth",
                "KOOK_OAUTH_NOT_CONFIGURED",
            );
        }
        return this.config;
    }
}

function normalizeEndpointUrl(value: string, field: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch (error) {
        throw KookError.configuration(`KOOK ${field} 无效`, "KOOK_OAUTH_URL_INVALID", {
            field,
            value,
            cause: error instanceof Error ? error.message : String(error),
        });
    }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw KookError.configuration(
            `KOOK ${field} 必须是无凭据、查询参数和片段的 HTTPS URL`,
            "KOOK_OAUTH_URL_INVALID",
            { field, value },
        );
    }
    return url.toString().replace(/\/$/u, "");
}

function requiredValue(value: string, field: string): string {
    if (!value.trim()) {
        throw KookError.invalid(`KOOK OAuth 参数 ${field} 不能为空`, "KOOK_OAUTH_PARAM_REQUIRED", {
            field,
        });
    }
    return value;
}

function normalizeScopes(scopes: readonly KookOAuthScope[]): string {
    if (!scopes.length || scopes.some(scope => !OAUTH_SCOPES.has(scope))) {
        throw KookError.invalid(
            "KOOK OAuth scope 仅支持 get_user_info、get_user_guilds",
            "KOOK_OAUTH_SCOPE_INVALID",
            { scopes },
        );
    }
    return [...new Set(scopes)].join(" ");
}

function assertOAuthPath(path: string): void {
    if (!path.startsWith("/v3/") || !isSafeAbsoluteApiPath(path)) {
        throw KookError.invalid(
            "KOOK OAuth API path 必须是 /v3/ 下的安全绝对路径",
            "KOOK_OAUTH_PATH_INVALID",
            { path },
        );
    }
}

function parseEnvelope<T>(value: unknown, path: string): KookApiEnvelope<T> {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        typeof (value as Partial<KookApiEnvelope<T>>).code !== "number" ||
        !("data" in value)
    ) {
        throw new KookError("KOOK OAuth API 响应结构无效", {
            code: "KOOK_OAUTH_RESPONSE_INVALID",
            category: ErrorCategory.PROTOCOL,
            path,
            details: value,
        });
    }
    return value as KookApiEnvelope<T>;
}

function isOAuthToken(value: unknown): value is KookOAuthToken {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const token = value as Partial<KookOAuthToken>;
    return (
        typeof token.access_token === "string" &&
        token.access_token.length > 0 &&
        Number.isSafeInteger(token.expires_in) &&
        (token.expires_in ?? 0) > 0 &&
        token.token_type === "Bearer" &&
        typeof token.scope === "string"
    );
}
