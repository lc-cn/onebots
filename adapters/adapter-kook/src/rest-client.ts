import { ErrorCategory, isSafeAbsoluteApiPath } from "onebots";
import { KookApiError, KookError } from "./errors.js";
import type { KookApiEnvelope, KookApiRequestOptions, KookConfig } from "./types.js";

const DEFAULT_API_BASE = "https://www.kookapp.cn/api";

export type KookHttpTransport = (url: string, init: RequestInit) => Promise<Response>;

export interface KookBinaryResult {
    data: Uint8Array;
    contentType: string;
}

/** KOOK REST 鉴权、安全 URL、限流与错误解析的单一边界。 */
export class KookRestClient {
    private readonly baseUrl: string;
    private readonly routeQueues = new Map<string, Promise<void>>();
    private readonly routeBuckets = new Map<string, string>();
    private readonly resetAt = new Map<string, number>();
    private globalResetAt = 0;

    constructor(
        private readonly config: Pick<KookConfig, "token" | "api_base_url" | "max_retries">,
        private readonly transport: KookHttpTransport = fetch,
    ) {
        this.baseUrl = normaliseApiBase(config.api_base_url);
    }

    call<T>(path: string, options: KookApiRequestOptions = {}): Promise<T> {
        assertApiPath(path);
        const method = options.method || "GET";
        const routeKey = `${method}:${path}`;
        return this.schedule(routeKey, () => this.perform<T>(routeKey, path, options));
    }

    async upload(data: Uint8Array, filename: string, contentType?: string): Promise<string> {
        const result = await this.multipart<{ url: string }>(
            "/v3/asset/create",
            {},
            { field: "file", data, filename, contentType },
        );
        if (!result.url) {
            throw KookError.resource("KOOK 素材上传响应缺少 URL", "KOOK_ASSET_URL_MISSING", result);
        }
        return result.url;
    }

    multipart<T>(
        path: string,
        fields: Readonly<Record<string, string | number | boolean | undefined>>,
        file: { field: string; data: Uint8Array; filename: string; contentType?: string },
    ): Promise<T> {
        assertApiPath(path);
        const form = new FormData();
        for (const [key, value] of Object.entries(fields)) {
            if (value !== undefined) form.append(key, String(value));
        }
        const bytes = new Uint8Array(file.data);
        form.append(
            file.field,
            new Blob([bytes.buffer], { type: file.contentType }),
            file.filename,
        );
        const routeKey = `POST:${path}`;
        return this.schedule(routeKey, () =>
            this.requestEnvelope<T>(routeKey, path, `${this.baseUrl}${path}`, {
                method: "POST",
                body: form,
            }),
        );
    }

    download(
        path: string,
        query: Readonly<Record<string, string | number | boolean | undefined>> = {},
        signal?: AbortSignal,
    ): Promise<KookBinaryResult> {
        assertApiPath(path);
        const url = new URL(`${this.baseUrl}${path}`);
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        const routeKey = `GET:${path}`;
        return this.schedule(routeKey, () =>
            this.requestBinary(routeKey, path, url.toString(), signal),
        );
    }

    private schedule<T>(routeKey: string, task: () => Promise<T>): Promise<T> {
        return this.enqueue(`route:${routeKey}`, () => {
            const bucket = this.routeBuckets.get(routeKey);
            return bucket ? this.enqueue(`bucket:${bucket}`, task) : task();
        });
    }

    private async perform<T>(
        routeKey: string,
        path: string,
        options: KookApiRequestOptions,
    ): Promise<T> {
        const url = new URL(`${this.baseUrl}${path}`);
        for (const [key, value] of Object.entries(options.query || {})) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        return this.requestEnvelope<T>(routeKey, path, url.toString(), {
            method: options.method || "GET",
            signal: options.signal,
            body: options.body ? JSON.stringify(options.body) : undefined,
            headers: options.body ? { "Content-Type": "application/json" } : undefined,
        });
    }

    private async requestEnvelope<T>(
        routeKey: string,
        path: string,
        url: string,
        init: RequestInit,
    ): Promise<T> {
        const retries = this.config.max_retries ?? 3;
        for (let attempt = 0; ; attempt += 1) {
            await this.wait(routeKey, init.signal ?? undefined);
            let response: Response;
            try {
                response = await this.transport(url, {
                    ...init,
                    headers: {
                        Authorization: `Bot ${this.config.token}`,
                        Accept: "application/json",
                        ...init.headers,
                    },
                });
            } catch (error) {
                throw KookError.wrap(error, "KOOK_REST_NETWORK_ERROR", {
                    method: init.method,
                    path,
                });
            }
            const text = await response.text();
            const envelope = parseEnvelope<T>(text, response.status, path);
            this.updateLimits(routeKey, response);
            if (response.status === 429 && attempt < retries) continue;
            if (!response.ok || envelope.code !== 0) {
                const error = new KookApiError(
                    envelope.message || response.statusText || "KOOK API 调用失败",
                    response.status,
                    envelope.code,
                    path,
                    response.status === 429 ? retryDelay(response) / 1_000 : undefined,
                    envelope,
                );
                throw error;
            }
            return envelope.data;
        }
    }

    private async requestBinary(
        routeKey: string,
        path: string,
        url: string,
        signal?: AbortSignal,
    ): Promise<KookBinaryResult> {
        const retries = this.config.max_retries ?? 3;
        for (let attempt = 0; ; attempt += 1) {
            await this.wait(routeKey, signal);
            let response: Response;
            try {
                response = await this.transport(url, {
                    method: "GET",
                    signal,
                    headers: {
                        Authorization: `Bot ${this.config.token}`,
                        Accept: "image/*,application/octet-stream",
                    },
                });
            } catch (error) {
                throw KookError.wrap(error, "KOOK_REST_NETWORK_ERROR", { method: "GET", path });
            }
            this.updateLimits(routeKey, response);
            if (response.status === 429 && attempt < retries) {
                await response.arrayBuffer();
                continue;
            }
            if (!response.ok) {
                const details = await response.text();
                throw new KookApiError(
                    `KOOK 二进制 API 请求失败（HTTP ${response.status}）`,
                    response.status,
                    undefined,
                    path,
                    response.status === 429 ? retryDelay(response) / 1_000 : undefined,
                    details,
                );
            }
            return {
                data: new Uint8Array(await response.arrayBuffer()),
                contentType: response.headers.get("content-type") || "application/octet-stream",
            };
        }
    }

    private async enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
        const previous = this.routeQueues.get(key) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolve => {
            release = resolve;
        });
        this.routeQueues.set(key, current);
        await previous;
        try {
            return await task();
        } finally {
            release();
            if (this.routeQueues.get(key) === current) this.routeQueues.delete(key);
        }
    }

    private async wait(routeKey: string, signal?: AbortSignal): Promise<void> {
        const key = this.routeBuckets.get(routeKey) ?? routeKey;
        const deadline = Math.max(this.globalResetAt, this.resetAt.get(key) ?? 0);
        if (deadline > Date.now()) await abortableDelay(deadline - Date.now(), signal);
    }

    private updateLimits(routeKey: string, response: Response): void {
        const bucket = response.headers.get("x-rate-limit-bucket");
        if (bucket) this.routeBuckets.set(routeKey, bucket);
        const key = bucket ?? this.routeBuckets.get(routeKey) ?? routeKey;
        const deadline = Date.now() + retryDelay(response);
        if (response.status === 429 || response.headers.get("x-rate-limit-remaining") === "0") {
            if (response.headers.has("x-rate-limit-global")) this.globalResetAt = deadline;
            else this.resetAt.set(key, deadline);
        }
    }
}

function normaliseApiBase(value?: string): string {
    const raw = value || DEFAULT_API_BASE;
    let url: URL;
    try {
        url = new URL(raw);
    } catch (error) {
        throw KookError.configuration("KOOK api_base_url 无效", "KOOK_API_BASE_INVALID", {
            value: raw,
            cause: error instanceof Error ? error.message : String(error),
        });
    }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw KookError.configuration(
            "KOOK api_base_url 必须是无凭据、查询参数和片段的 HTTPS 地址",
            "KOOK_API_BASE_INVALID",
        );
    }
    return url.toString().replace(/\/$/, "");
}

function assertApiPath(path: string): void {
    if (!path.startsWith("/v3/") || !isSafeAbsoluteApiPath(path)) {
        throw KookError.invalid(
            "KOOK API path 必须是 /v3/ 下的安全绝对路径",
            "KOOK_API_PATH_INVALID",
            { path },
        );
    }
}

function parseEnvelope<T>(text: string, status: number, path: string): KookApiEnvelope<T> {
    try {
        return JSON.parse(text) as KookApiEnvelope<T>;
    } catch (error) {
        throw new KookError("KOOK API 返回了无效 JSON", {
            code: "KOOK_API_INVALID_JSON",
            status,
            path,
            details: text,
            cause: error,
        });
    }
}

function retryDelay(response: Response): number {
    const raw = response.headers.get("x-rate-limit-reset") || response.headers.get("retry-after");
    const seconds = raw ? Number(raw) : 1;
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : 1_000;
}

function abortableDelay(delay: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortedError());
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortedError());
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, delay);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

function abortedError(): KookError {
    return new KookError("KOOK REST 请求已取消", {
        code: "KOOK_REQUEST_ABORTED",
        category: ErrorCategory.RUNTIME,
    });
}
