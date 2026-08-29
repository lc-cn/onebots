import { DiscordError } from "../errors.js";
import type {
    DiscordHttpRequest,
    DiscordHttpResponse,
    DiscordHttpTransport,
} from "./rest-transport.js";

export interface DiscordScheduledRequest {
    routeKey: string;
    endpoint: string;
    url: string;
    request: DiscordHttpRequest;
}

/** Discord route bucket 与 global 429 共用的串行调度器。 */
export class DiscordRateLimitCoordinator {
    private readonly routeQueues = new Map<string, Promise<void>>();
    private readonly bucketResetAt = new Map<string, number>();
    private readonly routeBuckets = new Map<string, string>();
    private globalResetAt = 0;

    constructor(
        private readonly transport: DiscordHttpTransport,
        private readonly maxRetries: number,
    ) {}

    request<T>(options: DiscordScheduledRequest): Promise<T> {
        // 路由队列始终存在，避免首次响应刚建立 bucket 映射时，新旧队列并发穿透。
        return this.enqueue(`route:${options.routeKey}`, () => {
            const bucket = this.routeBuckets.get(options.routeKey);
            return bucket
                ? this.enqueue(`bucket:${bucket}`, () => this.perform<T>(options))
                : this.perform<T>(options);
        });
    }

    private async perform<T>(options: DiscordScheduledRequest): Promise<T> {
        const { routeKey, endpoint, url, request } = options;
        for (let attempt = 0; ; attempt += 1) {
            await this.wait(routeKey, request.signal);
            let response: DiscordHttpResponse;
            try {
                response = await this.transport.request(url, request);
            } catch (error) {
                throw DiscordError.wrap(error, "DISCORD_REST_NETWORK_ERROR", {
                    method: request.method,
                    endpoint,
                });
            }
            const parsed = parseDiscordBody(response.body);
            this.update(routeKey, response, parsed);
            if (response.status === 429 && attempt < this.maxRetries) continue;
            if (response.status >= 200 && response.status < 300) return parsed as T;
            throw discordResponseError(request.method, endpoint, response, parsed);
        }
    }

    private async enqueue<T>(routeKey: string, task: () => Promise<T>): Promise<T> {
        const previous = this.routeQueues.get(routeKey) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolve => {
            release = resolve;
        });
        this.routeQueues.set(routeKey, current);
        await previous;
        try {
            return await task();
        } finally {
            release();
            if (this.routeQueues.get(routeKey) === current) this.routeQueues.delete(routeKey);
        }
    }

    private async wait(routeKey: string, signal?: AbortSignal): Promise<void> {
        const bucketKey = this.routeBuckets.get(routeKey) ?? routeKey;
        const resetAt = Math.max(this.globalResetAt, this.bucketResetAt.get(bucketKey) ?? 0);
        if (resetAt > Date.now()) await abortableDelay(resetAt - Date.now(), signal);
    }

    private update(routeKey: string, response: DiscordHttpResponse, body: unknown): void {
        const bucket = response.headers["x-ratelimit-bucket"];
        if (bucket) this.routeBuckets.set(routeKey, bucket);
        const bucketKey = bucket ?? this.routeBuckets.get(routeKey) ?? routeKey;
        const retryAfter = discordRetryAfter(response, body);
        if (response.status === 429) {
            const resetAt = Date.now() + retryAfter * 1_000;
            if (objectValue(body).global === true) this.globalResetAt = resetAt;
            else this.bucketResetAt.set(bucketKey, resetAt);
            return;
        }
        if (response.headers["x-ratelimit-remaining"] === "0") {
            const resetAfter = positiveNumber(response.headers["x-ratelimit-reset-after"]);
            if (resetAfter !== undefined) {
                this.bucketResetAt.set(bucketKey, Date.now() + resetAfter * 1_000);
            }
        }
    }
}

export function discordRouteKey(method: string, endpoint: string): string {
    const segments = endpoint.split("/");
    for (let index = 1; index < segments.length; index += 1) {
        const value = segments[index]!;
        const parent = segments[index - 1];
        const isMajor = ["channels", "guilds", "webhooks"].includes(parent ?? "");
        if (/^\d{16,20}$/.test(value) && !isMajor) segments[index] = ":id";
        if (index >= 2 && segments[index - 2] === "webhooks") segments[index] = ":token";
        if (index >= 2 && segments[index - 2] === "interactions") segments[index] = ":token";
    }
    return `${method}:${segments.join("/")}`;
}

function parseDiscordBody(body: string): unknown {
    if (!body) return undefined;
    try {
        return JSON.parse(body);
    } catch {
        // Discord 204、代理错误页等响应可能不是 JSON，原文会进入结构化错误 details。
        return body;
    }
}

function discordRetryAfter(response: DiscordHttpResponse, body: unknown): number {
    return (
        positiveNumber(objectValue(body).retry_after) ??
        positiveNumber(response.headers["retry-after"]) ??
        1
    );
}

function discordResponseError(
    method: string,
    endpoint: string,
    response: DiscordHttpResponse,
    body: unknown,
): DiscordError {
    const data = objectValue(body);
    const message =
        typeof data.message === "string" && data.message
            ? data.message
            : `Discord API 请求失败（HTTP ${response.status}）`;
    return new DiscordError(message, {
        code: response.status === 429 ? "DISCORD_RATE_LIMITED" : "DISCORD_API_ERROR",
        method,
        endpoint,
        status: response.status,
        discordCode: typeof data.code === "number" ? data.code : undefined,
        retryAfter: response.status === 429 ? discordRetryAfter(response, body) : undefined,
        global: data.global === true,
        requestId: response.headers["x-request-id"] ?? response.headers["cf-ray"],
        details: body,
    });
}

function objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function positiveNumber(value: unknown): number | undefined {
    const number = typeof value === "string" ? Number(value) : value;
    return typeof number === "number" && Number.isFinite(number) && number >= 0
        ? number
        : undefined;
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

function abortedError(): DiscordError {
    return new DiscordError("Discord REST 请求已取消", { code: "DISCORD_REQUEST_ABORTED" });
}
