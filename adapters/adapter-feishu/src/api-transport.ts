import { isSafeAbsoluteApiPath } from "onebots";
import { FeishuError } from "./errors.js";
import { isFeishuApiEnvelope } from "./guards.js";
import {
    buildFeishuApiUrl,
    normalizeFeishuEndpoint,
    serializeFeishuRequestBody,
} from "./http-input.js";
import {
    FeishuEndpoint,
    type FeishuAPIResponse,
    type FeishuApiEnvelope,
    type FeishuApiRequestOptions,
    type FeishuConfig,
    type FeishuTokenResponse,
} from "./types.js";

/** 飞书开放平台的凭证缓存、HTTP 编码、响应校验与单次鉴权重试边界。 */
export class FeishuApiTransport {
    readonly endpoint: string;
    private tenantAccessToken = "";
    private tokenExpireTime = 0;
    private tokenRequest?: Promise<string>;

    constructor(private readonly config: FeishuConfig) {
        this.endpoint = normalizeFeishuEndpoint(config.endpoint || FeishuEndpoint.FEISHU);
    }

    async call<T extends FeishuApiEnvelope = FeishuAPIResponse>(
        path: string,
        options: FeishuApiRequestOptions = {},
    ): Promise<T> {
        if (!isSafeAbsoluteApiPath(path)) {
            throw new FeishuError("飞书 API path 必须为安全绝对路径", {
                code: "FEISHU_UNSAFE_API_PATH",
                details: path,
            });
        }
        return this.request<T>(path, options);
    }

    async getTenantAccessToken(): Promise<string> {
        if (this.tenantAccessToken && Date.now() < this.tokenExpireTime) {
            return this.tenantAccessToken;
        }
        if (this.tokenRequest) return this.tokenRequest;
        const request = this.loadTenantAccessToken();
        this.tokenRequest = request;
        try {
            return await request;
        } finally {
            if (this.tokenRequest === request) this.tokenRequest = undefined;
        }
    }

    invalidateTenantAccessToken(token: string): void {
        if (this.tenantAccessToken === token) this.clearTenantAccessToken();
    }

    private async request<T extends FeishuApiEnvelope = FeishuAPIResponse>(
        path: string,
        options: FeishuApiRequestOptions = {},
        retryAuth = true,
    ): Promise<T> {
        const { method = "GET", headers = {}, body, params, skipAuth = false } = options;
        const url = buildFeishuApiUrl(this.endpoint, path, params);
        const requestHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            ...headers,
        };
        const requestBody = serializeFeishuRequestBody(body, `${method} ${path}`);
        const requestToken = skipAuth ? undefined : await this.getTenantAccessToken();
        if (requestToken) requestHeaders.Authorization = `Bearer ${requestToken}`;

        let response: Response;
        try {
            response = await fetch(url, { method, headers: requestHeaders, body: requestBody });
        } catch (error) {
            throw FeishuError.wrap(error, "FEISHU_NETWORK_ERROR", `${method} ${path}`);
        }
        let text: string;
        try {
            text = await response.text();
        } catch (error) {
            throw FeishuError.wrap(error, "FEISHU_NETWORK_ERROR", `${method} ${path}`);
        }
        let result: unknown;
        try {
            result = text ? JSON.parse(text) : {};
        } catch (error) {
            throw new FeishuError(`飞书 API ${method} ${path} 返回了无效 JSON`, {
                code: "FEISHU_INVALID_RESPONSE",
                operation: `${method} ${path}`,
                status: response.status,
                cause: error,
            });
        }
        if (!isFeishuApiEnvelope(result)) {
            throw new FeishuError(`飞书 API ${method} ${path} 返回结构无效`, {
                code: "FEISHU_INVALID_RESPONSE",
                operation: `${method} ${path}`,
                status: response.status,
                details: result,
            });
        }
        if (result.code === 99991663 && requestToken && retryAuth) {
            this.invalidateTenantAccessToken(requestToken);
            return this.request<T>(path, options, false);
        }
        if (!response.ok) {
            throw new FeishuError(
                `飞书 API ${method} ${path} 失败 (${response.status}): ${result.msg}`,
                {
                    code: "FEISHU_HTTP_ERROR",
                    operation: `${method} ${path}`,
                    status: response.status,
                    platformCode: result.code,
                    details: result,
                },
            );
        }
        if (result.code !== 0) {
            throw new FeishuError(`飞书 API ${method} ${path} 失败: ${result.msg}`, {
                code: "FEISHU_API_ERROR",
                operation: `${method} ${path}`,
                platformCode: result.code,
                details: result,
            });
        }
        return result as unknown as T;
    }

    private async loadTenantAccessToken(): Promise<string> {
        const data = await this.request<FeishuTokenResponse>(
            "/auth/v3/tenant_access_token/internal",
            {
                method: "POST",
                body: {
                    app_id: this.config.app_id,
                    app_secret: this.config.app_secret,
                },
                skipAuth: true,
            },
        );
        if (!data.tenant_access_token) {
            throw new FeishuError("获取租户访问令牌失败: 响应缺少 tenant_access_token", {
                code: "FEISHU_TOKEN_MISSING",
                details: data,
            });
        }
        if (!Number.isFinite(data.expire) || data.expire <= 0) {
            throw new FeishuError("获取租户访问令牌失败: expire 无效", {
                code: "FEISHU_TOKEN_EXPIRE_INVALID",
                details: data,
            });
        }
        this.tenantAccessToken = data.tenant_access_token;
        this.tokenExpireTime = Date.now() + Math.max(data.expire - 60, 1) * 1000;
        return this.tenantAccessToken;
    }

    private clearTenantAccessToken(): void {
        this.tenantAccessToken = "";
        this.tokenExpireTime = 0;
    }
}
