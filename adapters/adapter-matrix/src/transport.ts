import { MatrixError } from "./errors.js";
import type { MatrixCallOptions, MatrixConfig } from "./types.js";
import { isRecord, parseHomeserverUrl } from "./validation.js";

export class MatrixTransport {
    readonly homeserverUrl: string;

    constructor(
        private readonly config: MatrixConfig,
        private readonly fetcher: typeof fetch = fetch,
    ) {
        this.homeserverUrl = parseHomeserverUrl(config.homeserver_url)
            .toString()
            .replace(/\/$/u, "");
    }

    async call(method: string, path: string, options: MatrixCallOptions = {}): Promise<unknown> {
        const url = this.buildUrl(path, options);
        const headers = new Headers({ accept: "application/json" });
        const token = this.resolveToken(options.token || "access");
        if (token) headers.set("authorization", `Bearer ${token}`);
        let body: BodyInit | undefined;
        if (options.body !== undefined) {
            headers.set("content-type", "application/json");
            body = JSON.stringify(options.body);
        }
        return this.execute(url, {
            method: method.toUpperCase(),
            headers,
            body,
            signal: options.signal,
        });
    }

    async upload(
        data: Blob | Uint8Array,
        filename?: string,
        contentType?: string,
        signal?: AbortSignal,
    ): Promise<unknown> {
        const tokenKind = this.config.access_token ? "access" : "appservice";
        const url = this.buildUrl("/_matrix/media/v3/upload", {
            query: { filename },
            token: tokenKind,
        });
        const headers = new Headers({
            accept: "application/json",
            authorization: `Bearer ${this.resolveToken(tokenKind)}`,
        });
        if (contentType) headers.set("content-type", contentType);
        const body =
            data instanceof Uint8Array
                ? new Blob([new Uint8Array(data)], { type: contentType })
                : data;
        return this.execute(url, { method: "POST", headers, body, signal });
    }

    private buildUrl(path: string, options: MatrixCallOptions): URL {
        if (!path.startsWith("/") || path.startsWith("//")) {
            throw MatrixError.invalid("Matrix call path 必须是相对 homeserver 的绝对 pathname");
        }
        const url = new URL(`${this.homeserverUrl}${path}`);
        for (const [key, value] of Object.entries(options.query || {})) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        if ((options.token || "access") === "appservice" && this.config.user_id) {
            url.searchParams.set("user_id", this.config.user_id);
            if (this.config.device_id) url.searchParams.set("device_id", this.config.device_id);
        }
        return url;
    }

    private resolveToken(kind: NonNullable<MatrixCallOptions["token"]>): string {
        if (kind === "none") return "";
        const token =
            kind === "appservice"
                ? this.config.as_token
                : this.config.access_token || this.config.as_token;
        if (!token) throw MatrixError.invalid(`Matrix ${kind} token 未配置`);
        return token;
    }

    private async execute(url: URL, init: RequestInit): Promise<unknown> {
        let response: Response;
        try {
            response = await this.fetcher(url, init);
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw MatrixError.network(`Matrix 请求失败: ${init.method} ${url.pathname}`, error);
        }
        const raw = await response.text();
        let payload: unknown = {};
        if (raw) {
            try {
                payload = JSON.parse(raw);
            } catch (error) {
                throw new MatrixError("Matrix 返回了非 JSON 响应", {
                    code: "MATRIX_INVALID_RESPONSE",
                    status: response.status,
                    details: { method: init.method, path: url.pathname },
                    cause: error,
                });
            }
        }
        if (!response.ok) {
            const record = isRecord(payload) ? payload : {};
            const retryAfterMs =
                typeof record.retry_after_ms === "number" ? record.retry_after_ms : undefined;
            throw new MatrixError(
                typeof record.error === "string" ? record.error : `Matrix HTTP ${response.status}`,
                {
                    code: typeof record.errcode === "string" ? record.errcode : "MATRIX_HTTP_ERROR",
                    status: response.status,
                    retryAfterMs,
                    details: record,
                },
            );
        }
        if (!isRecord(payload) && !Array.isArray(payload)) {
            throw new MatrixError("Matrix JSON 响应必须是对象或数组", {
                code: "MATRIX_INVALID_RESPONSE",
                status: response.status,
            });
        }
        return payload;
    }
}
