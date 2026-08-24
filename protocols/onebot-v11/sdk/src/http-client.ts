import type { OneBotV11ActionUrlResolver, OneBotV11Call, OneBotV11Response } from "./types.js";

export interface HttpClientConfig {
    apiBaseUrl: string;
    accessToken?: string;
    resolveActionUrl?: OneBotV11ActionUrlResolver;
    call?: OneBotV11Call;
    fetch?: typeof globalThis.fetch;
}

function defaultActionUrl(action: string, apiBaseUrl: string): URL {
    return new URL(action.replace(/^\/+/, ""), `${apiBaseUrl.replace(/\/+$/, "")}/`);
}

export class HttpClient {
    readonly #config: HttpClientConfig;

    constructor(config: HttpClientConfig) {
        this.#config = config;
    }

    async post<T = unknown>(
        action: string,
        params: Record<string, unknown> = {},
    ): Promise<OneBotV11Response<T>> {
        const normalizedAction = action.replace(/^\/+/, "");
        if (this.#config.call) {
            return this.#config.call(normalizedAction, params) as Promise<OneBotV11Response<T>>;
        }
        const resolved = this.#config.resolveActionUrl
            ? this.#config.resolveActionUrl(normalizedAction, this.#config.apiBaseUrl)
            : defaultActionUrl(normalizedAction, this.#config.apiBaseUrl);
        const url = new URL(String(resolved));
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.#config.accessToken) {
            url.searchParams.set("access_token", this.#config.accessToken);
            headers.Authorization = `Bearer ${this.#config.accessToken}`;
        }
        const response = await (this.#config.fetch ?? globalThis.fetch)(url.toString(), {
            method: "POST",
            headers,
            body: JSON.stringify(params),
        });
        if (!response.ok) {
            throw new Error(`OneBot V11 HTTP 请求失败，状态码：${response.status}`);
        }
        return response.json() as Promise<OneBotV11Response<T>>;
    }
}
