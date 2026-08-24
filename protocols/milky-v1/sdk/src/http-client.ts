import type { MilkyActionUrlResolver, MilkyCall, MilkyV1Response } from "./types.js";

export interface HttpClientConfig {
    apiBaseUrl: string;
    accessToken?: string;
    resolveActionUrl?: MilkyActionUrlResolver;
    call?: MilkyCall;
    fetch?: typeof globalThis.fetch;
}

function defaultActionUrl(action: string, apiBaseUrl: string): URL {
    const normalizedAction = action.replace(/^\/+/, "");
    return new URL(`api/${normalizedAction}`, `${apiBaseUrl.replace(/\/+$/, "")}/`);
}

/** Milky `/api/{action}` HTTP 客户端。 */
export class HttpClient {
    readonly #config: HttpClientConfig;

    constructor(config: HttpClientConfig) {
        this.#config = config;
    }

    async post<T = unknown>(
        action: string,
        params: Record<string, unknown> = {},
    ): Promise<MilkyV1Response<T>> {
        if (this.#config.call) {
            return this.#config.call(action.replace(/^\/+/, ""), params) as Promise<
                MilkyV1Response<T>
            >;
        }

        const resolved = this.#config.resolveActionUrl
            ? this.#config.resolveActionUrl(action.replace(/^\/+/, ""), this.#config.apiBaseUrl)
            : defaultActionUrl(action, this.#config.apiBaseUrl);
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.#config.accessToken) {
            headers.Authorization = `Bearer ${this.#config.accessToken}`;
        }
        const fetchImplementation = this.#config.fetch ?? globalThis.fetch;
        const response = await fetchImplementation(String(resolved), {
            method: "POST",
            headers,
            body: JSON.stringify(params),
        });
        if (!response.ok) {
            throw new Error(`Milky HTTP 请求失败，状态码：${response.status}`);
        }
        return response.json() as Promise<MilkyV1Response<T>>;
    }
}
