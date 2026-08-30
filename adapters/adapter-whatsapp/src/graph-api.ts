import { WhatsAppApiError } from "./errors.js";
import type { WhatsAppCallOptions, WhatsAppConfig } from "./types.js";

const DEFAULT_API_BASE_URL = "https://graph.facebook.com";

/** Graph API 传输边界：集中保护凭据域、版本路径以及 Meta 错误响应。 */
export class WhatsAppGraphApi {
    readonly apiVersion: string;
    readonly apiBaseUrl: string;

    constructor(
        config: Pick<WhatsAppConfig, "access_token" | "api_version" | "api_base_url">,
        private readonly fetcher: typeof fetch,
    ) {
        this.accessToken = config.access_token;
        this.apiVersion = requireApiVersion(config.api_version);
        this.apiBaseUrl = requireHttpsBase(config.api_base_url || DEFAULT_API_BASE_URL);
    }

    private readonly accessToken: string;

    async call<T = unknown>(options: WhatsAppCallOptions): Promise<T> {
        const url = this.resolveResource(options.resource, options.query);
        const headers = new Headers(options.headers);
        headers.set("Authorization", `Bearer ${this.accessToken}`);
        let body: BodyInit | undefined;
        if (options.body instanceof FormData || typeof options.body === "string") {
            body = options.body;
        } else if (options.body !== undefined) {
            headers.set("Content-Type", "application/json");
            body = JSON.stringify(options.body);
        }
        let response: Response;
        try {
            response = await this.fetcher(url, {
                method: options.method || "GET",
                headers,
                body,
                signal: options.signal,
            });
        } catch (error) {
            throw new WhatsAppApiError("WhatsApp Graph API 网络请求失败", {
                code: "WHATSAPP_NETWORK_ERROR",
                resource: options.resource,
                cause: error,
            });
        }
        const payload = await parseResponse(response);
        if (!response.ok) throw graphError(response, payload, options.resource);
        return payload as T;
    }

    async download(url: string, resource: string, signal?: AbortSignal): Promise<Buffer> {
        if (!isTrustedMediaUrl(url, this.apiBaseUrl)) {
            throw new WhatsAppApiError("WhatsApp 媒体 URL 不是受信任的 HTTPS 地址", {
                code: "WHATSAPP_INVALID_MEDIA_URL",
                resource,
                details: url,
            });
        }
        let response: Response;
        try {
            response = await this.fetcher(url, {
                headers: { Authorization: `Bearer ${this.accessToken}` },
                signal,
            });
        } catch (error) {
            throw new WhatsAppApiError("WhatsApp 媒体下载请求失败", {
                code: "WHATSAPP_MEDIA_NETWORK_ERROR",
                resource,
                cause: error,
            });
        }
        if (!response.ok) throw graphError(response, await parseResponse(response), resource);
        return Buffer.from(await response.arrayBuffer());
    }

    private resolveResource(
        resource: string,
        query?: Readonly<Record<string, string | number | boolean | undefined>>,
    ): URL {
        const normalized = resource.replace(/\/+$/gu, "");
        if (!isSafeGraphResource(resource, normalized)) {
            throw new WhatsAppApiError("WhatsApp Graph API resource 必须是安全的相对路径", {
                code: "WHATSAPP_INVALID_RESOURCE",
                resource,
            });
        }
        const url = new URL(`${this.apiVersion}/${normalized}`, `${this.apiBaseUrl}/`);
        for (const [name, value] of Object.entries(query || {})) {
            if (value !== undefined) url.searchParams.set(name, String(value));
        }
        return url;
    }
}

function isTrustedMediaUrl(value: string, apiBaseUrl: string): boolean {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase();
    const apiHostname = new URL(apiBaseUrl).hostname.toLowerCase();
    return (
        hostname === apiHostname ||
        hostname === "facebook.com" ||
        hostname.endsWith(".facebook.com") ||
        hostname === "fbcdn.net" ||
        hostname.endsWith(".fbcdn.net") ||
        hostname === "fbsbx.com" ||
        hostname.endsWith(".fbsbx.com")
    );
}

function isSafeGraphResource(resource: string, normalized: string): boolean {
    if (
        !normalized ||
        resource.startsWith("/") ||
        resource.includes("?") ||
        resource.includes("#") ||
        resource.includes("\\") ||
        /[\u0000-\u001f\u007f]/u.test(resource) ||
        /^(?:https?|ftp):\/\//iu.test(resource)
    ) {
        return false;
    }
    try {
        return normalized.split("/").every(segment => {
            const decoded = decodeURIComponent(segment);
            return (
                decoded.length > 0 &&
                decoded !== "." &&
                decoded !== ".." &&
                !decoded.includes("/") &&
                !decoded.includes("\\") &&
                !decoded.includes("?") &&
                !decoded.includes("#") &&
                !/[\u0000-\u001f\u007f]/u.test(decoded)
            );
        });
    } catch {
        return false;
    }
}

async function parseResponse(response: Response): Promise<unknown> {
    if (response.status === 204) return undefined;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        try {
            return await response.json();
        } catch (error) {
            throw new WhatsAppApiError("WhatsApp Graph API 返回了无效 JSON", {
                code: "WHATSAPP_INVALID_RESPONSE",
                status: response.status,
                cause: error,
            });
        }
    }
    return response.text();
}

function graphError(response: Response, payload: unknown, resource: string): WhatsAppApiError {
    const record = asRecord(payload);
    const error = asRecord(record?.error);
    const message = typeof error?.message === "string" ? error.message : response.statusText;
    const code = typeof error?.code === "number" ? `WHATSAPP_${error.code}` : "WHATSAPP_HTTP_ERROR";
    return new WhatsAppApiError(message || `WhatsApp Graph API 返回 ${response.status}`, {
        code,
        status: response.status,
        resource,
        details: payload,
    });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function requireApiVersion(value: string): string {
    if (!/^v\d+\.\d+$/u.test(value)) {
        throw new WhatsAppApiError("WhatsApp api_version 必须使用 v数字.数字 格式", {
            code: "WHATSAPP_INVALID_API_VERSION",
            details: value,
        });
    }
    return value;
}

function requireHttpsBase(value: string): string {
    if (!URL.canParse(value)) {
        throw new WhatsAppApiError("WhatsApp api_base_url 必须是有效 HTTPS URL", {
            code: "WHATSAPP_INVALID_API_BASE_URL",
            details: value,
        });
    }
    const url = new URL(value);
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.pathname !== "/" && url.pathname !== "")
    ) {
        throw new WhatsAppApiError("WhatsApp api_base_url 必须是无凭据和路径语义的 HTTPS Origin", {
            code: "WHATSAPP_INVALID_API_BASE_URL",
            details: value,
        });
    }
    return url.origin;
}
