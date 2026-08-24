import { ProtocolError } from "imhelper";
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
            try {
                const result = (await this.#config.call(
                    normalizedAction,
                    params,
                )) as OneBotV11Response<T>;
                return this.#validate(result, normalizedAction);
            } catch (error) {
                if (error instanceof ProtocolError) throw error;
                throw new ProtocolError({
                    protocol: "onebot-v11",
                    operation: normalizedAction,
                    kind: "protocol",
                    message: `OneBot V11 调用失败：${normalizedAction}`,
                    cause: error,
                });
            }
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
        let response: Response;
        try {
            response = await (this.#config.fetch ?? globalThis.fetch)(url.toString(), {
                method: "POST",
                headers,
                body: JSON.stringify(params),
            });
        } catch (error) {
            throw new ProtocolError({
                protocol: "onebot-v11",
                operation: normalizedAction,
                kind: "transport",
                message: `OneBot V11 请求失败：${normalizedAction}`,
                cause: error,
            });
        }
        if (!response.ok) {
            throw new ProtocolError({
                protocol: "onebot-v11",
                operation: normalizedAction,
                kind: "transport",
                message: `OneBot V11 HTTP 请求失败，状态码：${response.status}`,
                httpStatus: response.status,
            });
        }
        let result: OneBotV11Response<T>;
        try {
            result = (await response.json()) as OneBotV11Response<T>;
        } catch (error) {
            throw new ProtocolError({
                protocol: "onebot-v11",
                operation: normalizedAction,
                kind: "protocol",
                message: `OneBot V11 响应解析失败：${normalizedAction}`,
                cause: error,
            });
        }
        return this.#validate(result, normalizedAction);
    }

    #validate<T>(result: OneBotV11Response<T>, operation: string): OneBotV11Response<T> {
        if (
            result.status === "failed" ||
            (typeof result.retcode === "number" && result.retcode !== 0)
        ) {
            throw new ProtocolError({
                protocol: "onebot-v11",
                operation,
                kind: "protocol",
                message: result.message ?? `OneBot V11 协议调用失败：${operation}`,
                code: result.retcode,
                response: result,
            });
        }
        return result;
    }
}
