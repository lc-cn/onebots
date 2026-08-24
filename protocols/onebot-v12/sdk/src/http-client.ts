import type { OneBotV12ActionUrlResolver, OneBotV12Call, OneBotV12Response } from "./types.js";

export interface HttpClientConfig {
    apiBaseUrl: string;
    accessToken?: string;
    resolveActionUrl?: OneBotV12ActionUrlResolver;
    call?: OneBotV12Call;
    fetch?: typeof globalThis.fetch;
}

export class HttpClient {
    readonly #config: HttpClientConfig;

    constructor(config: HttpClientConfig) {
        this.#config = config;
    }

    async post<T = unknown>(
        action: string,
        params: Record<string, unknown> = {},
    ): Promise<OneBotV12Response<T>> {
        const normalizedAction = action.replace(/^\/+/, "");
        if (this.#config.call) {
            return this.#config.call(normalizedAction, params) as Promise<OneBotV12Response<T>>;
        }
        const resolved = this.#config.resolveActionUrl
            ? this.#config.resolveActionUrl(normalizedAction, this.#config.apiBaseUrl)
            : new URL(normalizedAction, `${this.#config.apiBaseUrl.replace(/\/+$/, "")}/`);
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.#config.accessToken) {
            headers.Authorization = `Bearer ${this.#config.accessToken}`;
        }
        const response = await (this.#config.fetch ?? globalThis.fetch)(String(resolved), {
            method: "POST",
            headers,
            body: JSON.stringify(params),
        });
        if (!response.ok) {
            throw new Error(`OneBot V12 HTTP 请求失败，状态码：${response.status}`);
        }
        return response.json() as Promise<OneBotV12Response<T>>;
    }
}
