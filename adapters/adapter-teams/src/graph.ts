import { isSafeAbsoluteApiPath } from "onebots";
import { TeamsApiError } from "./errors.js";
import {
    graphErrorCode,
    graphTokenAuthority,
    recordString,
    recordValue,
    requireHttpsConfigUrl,
    responsePayload,
} from "./bot-utils.js";
import type { TeamsConfig } from "./types.js";

export interface TeamsGraphRequestOptions {
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    query?: Record<string, string | number | boolean>;
    body?: Record<string, unknown>;
}

/** Graph app-only 鉴权与 HTTP 边界；复用 token，并在 401 后只刷新重试一次。 */
export class TeamsGraphClient {
    readonly baseUrl: string;
    private token?: { value: string; expiresAt: number };
    private tokenPromise?: Promise<string>;

    constructor(private readonly config: TeamsConfig) {
        this.baseUrl = requireHttpsConfigUrl(
            config.graph_base_url || "https://graph.microsoft.com/v1.0",
            "graph_base_url",
        ).replace(/\/$/u, "");
    }

    async call(path: string, options: TeamsGraphRequestOptions): Promise<unknown> {
        if (!isSafeAbsoluteApiPath(path)) {
            throw TeamsApiError.invalid(
                "Teams Graph path 必须是不含 query、fragment 或路径穿越的绝对 API 路径",
                "TEAMS_GRAPH_PATH_INVALID",
                { path },
            );
        }
        return this.request(path, options, true);
    }

    private async request(
        path: string,
        options: TeamsGraphRequestOptions,
        retryAuthentication: boolean,
    ): Promise<unknown> {
        const token = await this.getToken();
        const url = new URL(`${this.baseUrl}${path}`);
        for (const [key, value] of Object.entries(options.query || {})) {
            url.searchParams.set(key, String(value));
        }
        let response: Response;
        try {
            response = await fetch(url, {
                method: options.method,
                headers: {
                    authorization: `Bearer ${token}`,
                    ...(options.body ? { "content-type": "application/json" } : {}),
                },
                body: options.body ? JSON.stringify(options.body) : undefined,
            });
        } catch (error) {
            throw TeamsApiError.wrap(error, "TEAMS_GRAPH_NETWORK_ERROR", "graph.request");
        }
        if (response.status === 401 && retryAuthentication) {
            this.token = undefined;
            return this.request(path, options, false);
        }
        const payload = await responsePayload(response);
        if (!response.ok) {
            throw new TeamsApiError(`Microsoft Graph 请求失败: ${response.status}`, {
                code: "TEAMS_GRAPH_API_ERROR",
                operation: `${options.method} ${path}`,
                platformCode: graphErrorCode(payload),
                status: response.status,
                details: {
                    response: payload,
                    request_id: response.headers.get("request-id") || undefined,
                    retry_after: response.headers.get("retry-after") || undefined,
                },
            });
        }
        return payload;
    }

    private async getToken(): Promise<string> {
        if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
        if (this.tokenPromise) return this.tokenPromise;
        const request = this.requestToken();
        this.tokenPromise = request;
        try {
            return await request;
        } finally {
            if (this.tokenPromise === request) this.tokenPromise = undefined;
        }
    }

    private async requestToken(): Promise<string> {
        const tenantId = this.config.graph_tenant_id || this.config.tenant_id;
        if (!tenantId || ["botframework.com", "organizations", "common"].includes(tenantId)) {
            throw new TeamsApiError("Graph 应用凭据流必须配置具体 tenant_id，不能使用多租户别名", {
                code: "TEAMS_GRAPH_TENANT_REQUIRED",
            });
        }
        const authority = graphTokenAuthority(
            this.config.authority_endpoint || "https://login.microsoftonline.com",
            tenantId,
        );
        const scope = `${new URL(this.baseUrl).origin}/.default`;
        let response: Response;
        try {
            response = await fetch(`${authority}/oauth2/v2.0/token`, {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: this.config.app_id,
                    client_secret: this.config.app_password,
                    grant_type: "client_credentials",
                    scope,
                }),
            });
        } catch (error) {
            throw TeamsApiError.wrap(error, "TEAMS_GRAPH_AUTH_NETWORK_ERROR", "graph.auth");
        }
        const payload = await responsePayload(response);
        const accessToken = recordString(payload, "access_token");
        if (!response.ok || !accessToken) {
            throw new TeamsApiError("获取 Microsoft Graph access token 失败", {
                code: "TEAMS_GRAPH_AUTH_ERROR",
                operation: "graph.auth",
                platformCode: recordString(payload, "error"),
                status: response.status,
                details: payload,
            });
        }
        const expiresIn = Number(recordValue(payload, "expires_in")) || 3600;
        this.token = {
            value: accessToken,
            expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
        };
        return accessToken;
    }
}
