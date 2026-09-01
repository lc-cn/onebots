import { ErrorCategory } from "onebots";
import { requireDingTalkApiPath } from "./api-path.js";
import { DingTalkApiError, DingTalkError } from "./errors.js";
import { extractApiError, parseResponse } from "./inbound.js";
import type {
    DingTalkApiRequestOptions,
    DingTalkConfig,
    DingTalkTokenResponse,
    DingTalkWebhookMessage,
    DingTalkWebhookResponse,
} from "./types.js";

const MODERN_API_BASE = "https://api.dingtalk.com";
const LEGACY_API_BASE = "https://oapi.dingtalk.com";

/** 集中管理钉钉开放平台鉴权、请求与错误归一化。 */
export class DingTalkApiClient {
    private accessToken = "";
    private tokenExpireTime = 0;
    private accessTokenPromise?: Promise<string>;

    constructor(private readonly config: DingTalkConfig) {}

    hasCredentials(): boolean {
        return Boolean(this.config.app_key && this.config.app_secret);
    }

    async getAccessToken(signal?: AbortSignal): Promise<string> {
        signal?.throwIfAborted();
        if (!this.hasCredentials()) {
            throw DingTalkError.config(
                "钉钉开放平台 API 需要 app_key 和 app_secret",
                "DINGTALK_API_CREDENTIALS_REQUIRED",
            );
        }
        if (this.accessToken && Date.now() < this.tokenExpireTime) return this.accessToken;
        if (signal) return this.refreshAccessToken(signal);
        const refresh = (this.accessTokenPromise ||= this.refreshAccessToken());
        try {
            return await refresh;
        } finally {
            if (this.accessTokenPromise === refresh) this.accessTokenPromise = undefined;
        }
    }

    async call<T = unknown>(path: string, options: DingTalkApiRequestOptions = {}): Promise<T> {
        return this.request<T>(requireDingTalkApiPath(path), options);
    }

    async postWebhook(
        url: string,
        message: DingTalkWebhookMessage,
        authenticated: boolean,
    ): Promise<DingTalkWebhookResponse> {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (authenticated) {
            headers["x-acs-dingtalk-access-token"] = await this.getAccessToken();
        }
        let response: Response;
        let text: string;
        try {
            response = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(message),
            });
            text = await response.text();
        } catch (error) {
            throw DingTalkError.wrap(
                error,
                "DINGTALK_WEBHOOK_NETWORK_ERROR",
                ErrorCategory.NETWORK,
                { url },
            );
        }
        const data = parseResponse(text, "session webhook") as DingTalkWebhookResponse;
        if (!response.ok || data.errcode) {
            throw new DingTalkApiError(data.errmsg || response.statusText, {
                status: response.status,
                platformCode: data.errcode,
                path: "session webhook",
                details: data,
            });
        }
        return data;
    }

    private async refreshAccessToken(signal?: AbortSignal): Promise<string> {
        const data = await this.request<DingTalkTokenResponse>("/v1.0/oauth2/accessToken", {
            method: "POST",
            auth: "none",
            body: { appKey: this.config.app_key, appSecret: this.config.app_secret },
            signal,
        });
        const token = data.accessToken || data.access_token;
        if (!token) {
            throw new DingTalkApiError("获取钉钉访问令牌失败", {
                status: 200,
                platformCode: data.errcode,
                path: "/v1.0/oauth2/accessToken",
                details: data,
            });
        }
        signal?.throwIfAborted();
        this.accessToken = token;
        this.tokenExpireTime =
            Date.now() + ((data.expireIn || data.expires_in || 7200) - 60) * 1000;
        return token;
    }

    private async request<T>(path: string, options: DingTalkApiRequestOptions): Promise<T> {
        const auth = options.auth || (path.startsWith("/v1.0/") ? "modern" : "legacy");
        const url = new URL(`${auth === "legacy" ? LEGACY_API_BASE : MODERN_API_BASE}${path}`);
        for (const [key, value] of Object.entries(options.query || {})) {
            url.searchParams.set(key, String(value));
        }
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...options.headers,
        };
        if (auth !== "none") {
            const token = await this.getAccessToken(options.signal);
            options.signal?.throwIfAborted();
            if (auth === "modern") headers["x-acs-dingtalk-access-token"] = token;
            else url.searchParams.set("access_token", token);
        }
        let response: Response;
        let text: string;
        try {
            response = await fetch(url, {
                method: options.method || "GET",
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
                signal: options.signal,
            });
            text = await response.text();
            options.signal?.throwIfAborted();
        } catch (error) {
            throw DingTalkError.wrap(error, "DINGTALK_NETWORK_ERROR", ErrorCategory.NETWORK, {
                path,
            });
        }
        const data = parseResponse(text, path);
        const apiError = extractApiError(data);
        if (!response.ok || apiError) {
            throw new DingTalkApiError(
                apiError?.message || response.statusText || "钉钉 API 调用失败",
                {
                    status: response.status,
                    platformCode: apiError?.code,
                    requestId: apiError?.requestId,
                    path,
                    details: data,
                },
            );
        }
        return data as T;
    }
}
