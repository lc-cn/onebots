import { assertTwitchApiPath, parseTwitchApiBaseUrl } from "./configuration.js";
import { TwitchError } from "./errors.js";
import type {
    TwitchApiResponse,
    TwitchCallOptions,
    TwitchConfig,
    TwitchHttpMethod,
} from "./types.js";

export interface TwitchRestTransport {
    call<T = unknown>(
        method: TwitchHttpMethod,
        path: string,
        options?: TwitchCallOptions,
    ): Promise<T>;
}

/** 有界 Helix REST transport；统一 Client-Id/Bearer、query 数组、限流与结构化错误。 */
export class FetchTwitchRestTransport implements TwitchRestTransport {
    private readonly baseUrl: URL;
    private readonly fetcher: typeof fetch;
    private readonly maxBytes: number;

    constructor(
        private readonly config: TwitchConfig,
        fetcher: typeof fetch = fetch,
    ) {
        this.baseUrl = parseTwitchApiBaseUrl(config.api_base_url);
        this.fetcher = fetcher;
        this.maxBytes = config.max_response_bytes || 10_485_760;
    }

    async call<T = unknown>(
        method: TwitchHttpMethod,
        path: string,
        options: TwitchCallOptions = {},
    ): Promise<T> {
        const url = new URL(assertTwitchApiPath(path), this.baseUrl);
        appendQuery(url, options.query);
        const headers = new Headers(options.headers);
        headers.set("Authorization", `Bearer ${this.config.access_token.replace(/^oauth:/u, "")}`);
        headers.set("Client-Id", this.config.client_id);
        headers.set("Accept", "application/json");
        let body: BodyInit | undefined;
        if (options.body !== undefined) {
            headers.set("Content-Type", "application/json");
            body = JSON.stringify(options.body);
        }
        let response: Response;
        try {
            response = await this.fetcher(url, { method, headers, body, signal: options.signal });
        } catch (error) {
            throw TwitchError.wrap(
                error,
                `Twitch ${method} ${url.pathname} 网络请求失败`,
                "TWITCH_NETWORK_ERROR",
            );
        }
        const raw = await readBounded(response, this.maxBytes);
        const payload = parsePayload(raw, response.headers.get("content-type"));
        if (!response.ok) throw apiError(response, payload, method, url.pathname);
        return payload as T;
    }
}

export async function collectTwitchPages<T>(
    transport: TwitchRestTransport,
    path: string,
    query: Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>,
    parser: (value: unknown) => T[],
    signal?: AbortSignal,
): Promise<T[]> {
    const result: T[] = [];
    let cursor: string | undefined;
    do {
        const response = await transport.call<TwitchApiResponse>("GET", path, {
            query: { ...query, first: 100, after: cursor },
            signal,
        });
        result.push(...parser(response));
        cursor = response.pagination?.cursor;
    } while (cursor);
    return result;
}

function appendQuery(url: URL, query: TwitchCallOptions["query"]): void {
    for (const [key, value] of Object.entries(query || {})) {
        if (value === undefined) continue;
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) url.searchParams.append(key, String(item));
    }
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes)
        throw new TwitchError("Twitch 响应超过大小上限", {
            code: "TWITCH_RESPONSE_TOO_LARGE",
            status: response.status,
        });
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new TwitchError("Twitch 响应超过大小上限", {
                    code: "TWITCH_RESPONSE_TOO_LARGE",
                    status: response.status,
                });
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}

function parsePayload(raw: Uint8Array, contentType: string | null): unknown {
    if (!raw.byteLength) return undefined;
    const text = new TextDecoder().decode(raw);
    if (contentType?.includes("json")) {
        try {
            return JSON.parse(text) as unknown;
        } catch (error) {
            throw TwitchError.wrap(error, "Twitch 返回了无效 JSON", "TWITCH_INVALID_RESPONSE");
        }
    }
    return text;
}

function apiError(response: Response, payload: unknown, method: string, path: string): TwitchError {
    const data =
        typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
    const message =
        typeof data.message === "string"
            ? data.message
            : `${method} ${path} 返回 HTTP ${response.status}`;
    const resetSeconds = numericHeader(response.headers, "ratelimit-reset");
    return new TwitchError(message, {
        code:
            typeof data.error === "string"
                ? `TWITCH_${data.error.toUpperCase().replaceAll(/[^A-Z0-9]+/gu, "_")}`
                : "TWITCH_API_ERROR",
        status: response.status,
        requestId: response.headers.get("rpl") || response.headers.get("x-request-id") || undefined,
        retryAfterMs: retryAfterMs(response.headers),
        rateLimitResetAt: resetSeconds === undefined ? undefined : resetSeconds * 1_000,
        details: payload,
    });
}

function retryAfterMs(headers: Headers): number | undefined {
    const value = headers.get("retry-after");
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function numericHeader(headers: Headers, name: string): number | undefined {
    const value = Number(headers.get(name));
    return Number.isFinite(value) ? value : undefined;
}
