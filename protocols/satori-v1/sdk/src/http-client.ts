import type { SatoriActionUrlResolver, SatoriCall } from "./types.js";

export interface HttpClientConfig {
    apiBaseUrl: string;
    accessToken?: string;
    platform: string;
    userId: string;
    unwrapLegacyResponse?: boolean;
    resolveActionUrl?: SatoriActionUrlResolver;
    call?: SatoriCall;
    fetch?: typeof globalThis.fetch;
}

export class HttpClient {
    readonly #config: HttpClientConfig;

    constructor(config: HttpClientConfig) {
        this.#config = config;
    }

    async call<T = unknown>(
        resource: string,
        method: string,
        params: Record<string, unknown> = {},
    ): Promise<T> {
        if (this.#config.call) {
            return this.#config.call(resource, method, params) as Promise<T>;
        }
        const resolved = this.#config.resolveActionUrl
            ? this.#config.resolveActionUrl(resource, method, this.#config.apiBaseUrl)
            : new URL(`${resource}.${method}`, `${this.#config.apiBaseUrl.replace(/\/+$/, "")}/`);
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.#config.accessToken) {
            headers.Authorization = `Bearer ${this.#config.accessToken}`;
        }
        headers["Satori-Platform"] = this.#config.platform;
        headers["Satori-User-ID"] = this.#config.userId;
        const response = await (this.#config.fetch ?? globalThis.fetch)(String(resolved), {
            method: "POST",
            headers,
            body: JSON.stringify(params),
        });
        if (!response.ok) {
            throw new Error(`Satori HTTP 请求失败，状态码：${response.status}`);
        }
        const body = (await response.json()) as unknown;
        if (!this.#config.unwrapLegacyResponse) return body as T;
        if (typeof body === "object" && body !== null && "data" in body) {
            return (body as { data: T }).data;
        }
        const message =
            typeof body === "object" && body !== null && "message" in body
                ? String((body as { message: unknown }).message)
                : "未知错误";
        throw new Error(`Satori API 调用失败：${message}`);
    }

    post<T = unknown>(action: string, params?: Record<string, unknown>): Promise<T> {
        const [resource, ...methodParts] = action.replace(/^\/+/, "").split(".");
        const method = methodParts.join(".");
        if (!resource || !method) {
            throw new TypeError(`Satori action 必须使用 resource.method 格式：${action}`);
        }
        return this.call<T>(resource, method, params);
    }
}
