import { ProtocolError } from "imhelper";
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
        const normalizedAction = action.replace(/^\/+/, "");
        if (this.#config.call) {
            try {
                const result = (await this.#config.call(
                    normalizedAction,
                    params,
                )) as MilkyV1Response<T>;
                return this.#validate(result, normalizedAction);
            } catch (error) {
                if (error instanceof ProtocolError) throw error;
                throw new ProtocolError({
                    protocol: "milky-v1",
                    operation: normalizedAction,
                    kind: "protocol",
                    message: `Milky 调用失败：${normalizedAction}`,
                    cause: error,
                });
            }
        }

        const resolved = this.#config.resolveActionUrl
            ? this.#config.resolveActionUrl(normalizedAction, this.#config.apiBaseUrl)
            : defaultActionUrl(action, this.#config.apiBaseUrl);
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.#config.accessToken) {
            headers.Authorization = `Bearer ${this.#config.accessToken}`;
        }
        const fetchImplementation = this.#config.fetch ?? globalThis.fetch;
        let response: Response;
        try {
            response = await fetchImplementation(String(resolved), {
                method: "POST",
                headers,
                body: JSON.stringify(params),
            });
        } catch (error) {
            throw new ProtocolError({
                protocol: "milky-v1",
                operation: normalizedAction,
                kind: "transport",
                message: `Milky 请求失败：${normalizedAction}`,
                cause: error,
            });
        }
        if (!response.ok) {
            throw new ProtocolError({
                protocol: "milky-v1",
                operation: normalizedAction,
                kind: "transport",
                message: `Milky HTTP 请求失败，状态码：${response.status}`,
                httpStatus: response.status,
            });
        }
        let result: MilkyV1Response<T>;
        try {
            result = (await response.json()) as MilkyV1Response<T>;
        } catch (error) {
            throw new ProtocolError({
                protocol: "milky-v1",
                operation: normalizedAction,
                kind: "protocol",
                message: `Milky 响应解析失败：${normalizedAction}`,
                cause: error,
            });
        }
        return this.#validate(result, normalizedAction);
    }

    #validate<T>(result: MilkyV1Response<T>, operation: string): MilkyV1Response<T> {
        if (
            result.status === "failed" ||
            (typeof result.retcode === "number" && result.retcode !== 0)
        ) {
            throw new ProtocolError({
                protocol: "milky-v1",
                operation,
                kind: "protocol",
                message: result.message ?? `Milky 协议调用失败：${operation}`,
                code: result.retcode,
                response: result,
            });
        }
        return result;
    }
}
