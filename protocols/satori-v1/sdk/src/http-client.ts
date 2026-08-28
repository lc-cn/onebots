import { ProtocolError } from "imhelper";
import type { SatoriActionUrlResolver, SatoriCall } from "./types.js";

export interface HttpClientConfig {
    apiBaseUrl: string;
    accessToken?: string;
    platform: string;
    userId: string;
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
        const operation = `${resource}.${method}`;
        if (this.#config.call) {
            try {
                return (await this.#config.call(resource, method, params)) as T;
            } catch (error) {
                if (error instanceof ProtocolError) throw error;
                throw new ProtocolError({
                    protocol: "satori-v1",
                    operation,
                    kind: "protocol",
                    message: `Satori 调用失败：${operation}`,
                    cause: error,
                });
            }
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
        let response: Response;
        try {
            response = await (this.#config.fetch ?? globalThis.fetch)(String(resolved), {
                method: "POST",
                headers,
                body: JSON.stringify(params),
            });
        } catch (error) {
            throw new ProtocolError({
                protocol: "satori-v1",
                operation,
                kind: "transport",
                message: `Satori 请求失败：${operation}`,
                cause: error,
            });
        }
        if (!response.ok) {
            throw new ProtocolError({
                protocol: "satori-v1",
                operation,
                kind: "transport",
                message: `Satori HTTP 请求失败，状态码：${response.status}`,
                httpStatus: response.status,
            });
        }
        let body: unknown;
        try {
            body = (await response.json()) as unknown;
        } catch (error) {
            throw new ProtocolError({
                protocol: "satori-v1",
                operation,
                kind: "protocol",
                message: `Satori 响应解析失败：${operation}`,
                cause: error,
            });
        }
        return body as T;
    }

    post<T = unknown>(action: string, params?: Record<string, unknown>): Promise<T> {
        const [resource, ...methodParts] = action.replace(/^\/+/, "").split(".");
        const method = methodParts.join(".");
        if (!resource || !method) {
            throw new ProtocolError({
                protocol: "satori-v1",
                operation: action,
                kind: "validation",
                message: `Satori action 必须使用 resource.method 格式：${action}`,
            });
        }
        return this.call<T>(resource, method, params);
    }
}
