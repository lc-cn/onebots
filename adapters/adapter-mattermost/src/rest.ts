import { MattermostError } from "./errors.js";
import { assertMattermostApiPath, parseMattermostServerUrl } from "./configuration.js";
import type { MattermostCallOptions, MattermostConfig, MattermostHttpMethod } from "./types.js";
import { isRecord } from "./validation.js";

export interface MattermostRestTransport {
    call(
        method: MattermostHttpMethod,
        path: string,
        options?: MattermostCallOptions,
    ): Promise<unknown>;
}

/** 受控的 REST v4 传输；只接受站点内相对路径并统一解析平台错误。 */
export class FetchMattermostRestTransport implements MattermostRestTransport {
    private readonly apiBase: URL;
    private readonly maxResponseBytes: number;

    constructor(
        private readonly config: MattermostConfig,
        private readonly fetcher: typeof fetch = fetch,
    ) {
        const server = parseMattermostServerUrl(config.server_url);
        server.pathname = `${server.pathname}/api/v4/`.replace(/\/{2,}/gu, "/");
        this.apiBase = server;
        this.maxResponseBytes = config.max_response_bytes || 10 * 1024 * 1024;
    }

    async call(
        method: MattermostHttpMethod,
        path: string,
        options: MattermostCallOptions = {},
    ): Promise<unknown> {
        if (options.body !== undefined && options.form) {
            throw MattermostError.invalid("Mattermost REST 调用不能同时提供 body 与 form");
        }
        const url = new URL(assertMattermostApiPath(path), this.apiBase);
        for (const [key, value] of Object.entries(options.query || {})) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        const headers = new Headers(options.headers);
        headers.set("authorization", `Bearer ${this.config.access_token}`);
        headers.set("accept", "application/json");
        let body: BodyInit | undefined;
        if (options.form) {
            body = options.form;
        } else if (options.body !== undefined) {
            headers.set("content-type", "application/json");
            body = JSON.stringify(options.body);
        }
        let response: Response;
        try {
            response = await this.fetcher(url, { method, headers, body, signal: options.signal });
        } catch (error) {
            throw MattermostError.network(`Mattermost ${method} ${path} 网络请求失败`, error);
        }
        const payload = await readBoundedPayload(response, this.maxResponseBytes);
        if (!response.ok) throw mattermostHttpError(response, payload, method, path);
        if (response.status === 204 || payload === "") return undefined;
        if (typeof payload === "string") {
            throw new MattermostError("Mattermost 成功响应不是有效 JSON", {
                code: "MATTERMOST_INVALID_RESPONSE",
                status: response.status,
                details: { method, path },
            });
        }
        return payload;
    }
}

async function readBoundedPayload(response: Response, maxBytes: number): Promise<unknown> {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new MattermostError("Mattermost 响应超过配置上限", {
            code: "MATTERMOST_RESPONSE_TOO_LARGE",
            status: response.status,
            details: { declared, maxBytes },
        });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
        throw new MattermostError("Mattermost 响应超过配置上限", {
            code: "MATTERMOST_RESPONSE_TOO_LARGE",
            status: response.status,
            details: { actual: bytes.byteLength, maxBytes },
        });
    }
    const text = new TextDecoder().decode(bytes);
    if (!text) return "";
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function mattermostHttpError(
    response: Response,
    payload: unknown,
    method: string,
    path: string,
): MattermostError {
    const record = isRecord(payload) ? payload : {};
    const retryAfterMs = parseRetryAfter(response.headers);
    return new MattermostError(
        typeof record.message === "string"
            ? record.message
            : `Mattermost ${method} ${path} 返回 HTTP ${response.status}`,
        {
            code: typeof record.id === "string" && record.id ? record.id : "MATTERMOST_HTTP_ERROR",
            status: response.status,
            requestId:
                typeof record.request_id === "string"
                    ? record.request_id
                    : response.headers.get("x-request-id") || undefined,
            detailedError:
                typeof record.detailed_error === "string" ? record.detailed_error : undefined,
            retryAfterMs,
            details: { method, path, status_code: record.status_code },
        },
    );
}

function parseRetryAfter(headers: Headers): number | undefined {
    const retryAfter = headers.get("retry-after");
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
        const date = Date.parse(retryAfter);
        if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    }
    const reset = Number(headers.get("x-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1_000 - Date.now());
    return undefined;
}
