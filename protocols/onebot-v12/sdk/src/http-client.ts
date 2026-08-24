import { ProtocolError } from "imhelper";
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
            try {
                const result = (await this.#config.call(
                    normalizedAction,
                    params,
                )) as OneBotV12Response<T>;
                return this.#validate(result, normalizedAction);
            } catch (error) {
                if (error instanceof ProtocolError) throw error;
                throw new ProtocolError({
                    protocol: "onebot-v12",
                    operation: normalizedAction,
                    kind: "protocol",
                    message: `OneBot V12 调用失败：${normalizedAction}`,
                    cause: error,
                });
            }
        }
        const resolved = this.#config.resolveActionUrl
            ? this.#config.resolveActionUrl(normalizedAction, this.#config.apiBaseUrl)
            : new URL(normalizedAction, `${this.#config.apiBaseUrl.replace(/\/+$/, "")}/`);
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.#config.accessToken) {
            headers.Authorization = `Bearer ${this.#config.accessToken}`;
        }
        let response: Response;
        try {
            response = await (this.#config.fetch ?? globalThis.fetch)(String(resolved), {
                method: "POST",
                headers,
                body: JSON.stringify(params),
            });
        } catch (error) {
            throw new ProtocolError({
                protocol: "onebot-v12",
                operation: normalizedAction,
                kind: "transport",
                message: `OneBot V12 请求失败：${normalizedAction}`,
                cause: error,
            });
        }
        if (!response.ok) {
            throw new ProtocolError({
                protocol: "onebot-v12",
                operation: normalizedAction,
                kind: "transport",
                message: `OneBot V12 HTTP 请求失败，状态码：${response.status}`,
                httpStatus: response.status,
            });
        }
        let result: OneBotV12Response<T>;
        try {
            result = (await response.json()) as OneBotV12Response<T>;
        } catch (error) {
            throw new ProtocolError({
                protocol: "onebot-v12",
                operation: normalizedAction,
                kind: "protocol",
                message: `OneBot V12 响应解析失败：${normalizedAction}`,
                cause: error,
            });
        }
        return this.#validate(result, normalizedAction);
    }

    #validate<T>(result: OneBotV12Response<T>, operation: string): OneBotV12Response<T> {
        if (
            result.status === "failed" ||
            (typeof result.retcode === "number" && result.retcode !== 0)
        ) {
            throw new ProtocolError({
                protocol: "onebot-v12",
                operation,
                kind: "protocol",
                message: result.message ?? `OneBot V12 协议调用失败：${operation}`,
                code: result.retcode,
                response: result,
            });
        }
        return result;
    }
}
