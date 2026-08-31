import { createHmac, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { emitAllAwaited, ReliableEventIngress, ValidationError } from "@onebots/core";
import { MetaError } from "./errors.js";
import type {
    MetaHttpRequest,
    MetaHttpResponse,
    MetaIngestResult,
    MetaWebhookClientEvents,
    MetaWebhookCodec,
    MetaWebhookConfig,
    MetaWebhookDelivery,
} from "./types.js";

const JSON_HEADERS = Object.freeze({ "content-type": "application/json; charset=utf-8" });
const TEXT_HEADERS = Object.freeze({ "content-type": "text/plain; charset=utf-8" });
const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface MetaWebhookDependencies {
    reportError?(error: Error): void;
}

/** Meta webhook handshake、原始体签名与可靠事件提交的共享实现。 */
export class MetaWebhookClient<TEvent, TRawEnvelope> extends EventEmitter<
    MetaWebhookClientEvents<TEvent, TRawEnvelope>
> {
    private readonly ingress = new ReliableEventIngress<string>();
    private started = false;
    private generation = 0;
    private startPromise?: Promise<void>;
    private stopPromise?: Promise<void>;

    constructor(
        readonly config: MetaWebhookConfig,
        private readonly codec: MetaWebhookCodec<TEvent, TRawEnvelope>,
        private readonly dependencies: MetaWebhookDependencies = {},
    ) {
        super();
        assertWebhookConfig(config);
    }

    get receiveMode(): "webhook" | "manual" {
        return this.config.receiveMode || "webhook";
    }

    get isStarted(): boolean {
        return this.started;
    }

    async start(): Promise<void> {
        if (this.stopPromise) {
            await this.stopPromise;
            return this.start();
        }
        if (this.started) return;
        if (this.startPromise) return this.startPromise;
        const generation = ++this.generation;
        const operation = (async () => {
            await emitAllAwaited(this, "ready");
            if (generation === this.generation) this.started = true;
        })();
        this.startPromise = operation;
        try {
            await operation;
        } finally {
            if (this.startPromise === operation) this.startPromise = undefined;
        }
    }

    async stop(): Promise<void> {
        if (this.stopPromise) return this.stopPromise;
        ++this.generation;
        const pendingStart = this.startPromise;
        const operation = (async () => {
            // start() 的调用方仍会收到启动错误；stop() 只负责确保最终处于停止状态。
            await pendingStart?.catch(() => undefined);
            if (!this.started) return;
            this.started = false;
            await emitAllAwaited(this, "stop");
        })();
        this.stopPromise = operation;
        try {
            await operation;
        } finally {
            if (this.stopPromise === operation) this.stopPromise = undefined;
        }
    }

    async ingest(value: unknown): Promise<MetaIngestResult<TEvent, TRawEnvelope>[]> {
        const envelope = this.codec.parse(value);
        return this.deliver(this.codec.expand(envelope));
    }

    async acceptHttp(request: Request): Promise<Response> {
        try {
            const rawBody =
                request.method.toUpperCase() === "POST"
                    ? await readRequestBody(
                          request,
                          this.config.maxBodyBytes || DEFAULT_MAX_BODY_BYTES,
                      )
                    : undefined;
            return toResponse(
                await this.ingestHttp({
                    method: request.method,
                    url: request.url,
                    headers: {
                        "x-hub-signature-256":
                            request.headers.get("x-hub-signature-256") || undefined,
                    },
                    rawBody,
                }),
            );
        } catch (error) {
            const wrapped = normalizeError(error);
            this.reportError(wrapped);
            return toResponse(errorResponse(wrapped.status || 500, wrapped.code, wrapped.message));
        }
    }

    async ingestHttp(request: MetaHttpRequest): Promise<MetaHttpResponse> {
        try {
            this.assertRequestPath(request.url);
            const method = request.method.toUpperCase();
            if (method === "GET") return this.verifySubscription(request.url);
            if (method !== "POST") {
                return errorResponse(405, "METHOD_NOT_ALLOWED", "Meta webhook 仅接受 GET 与 POST");
            }
            if (this.receiveMode === "manual") {
                throw new MetaError("manual 模式仅接受 ingest(rawEvent)", {
                    code: "META_MANUAL_ONLY",
                    status: 409,
                });
            }
            const rawBody = request.rawBody;
            if (!rawBody) throw MetaError.invalid("签名校验需要精确 rawBody");
            const maxBytes = this.config.maxBodyBytes || DEFAULT_MAX_BODY_BYTES;
            if (rawBody.byteLength > maxBytes) {
                throw new MetaError("Webhook body 过大", {
                    code: "META_BODY_TOO_LARGE",
                    status: 413,
                });
            }
            verifyMetaSignature(
                rawBody,
                findHeader(request.headers, "x-hub-signature-256"),
                this.config.appSecret || "",
            );
            let parsed: unknown;
            try {
                parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
            } catch (error) {
                throw MetaError.invalid("Webhook body 不是有效 UTF-8 JSON", {
                    cause: String(error),
                });
            }
            await this.ingest(parsed);
            return { status: 200, headers: TEXT_HEADERS, body: "EVENT_RECEIVED" };
        } catch (error) {
            const wrapped = normalizeError(error);
            this.reportError(wrapped);
            return errorResponse(wrapped.status || 500, wrapped.code, wrapped.message);
        }
    }

    private verifySubscription(urlValue: string): MetaHttpResponse {
        if (this.receiveMode === "manual") {
            throw new MetaError("manual 模式没有 webhook verification endpoint", {
                code: "META_MANUAL_ONLY",
                status: 409,
            });
        }
        const url = new URL(urlValue, "http://onebots.local");
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        if (mode !== "subscribe" || token !== this.config.verifyToken || !challenge) {
            throw new MetaError("Meta webhook verification 参数不匹配", {
                code: "META_WEBHOOK_VERIFICATION_FAILED",
                status: 403,
            });
        }
        return { status: 200, headers: TEXT_HEADERS, body: challenge };
    }

    private async deliver(
        deliveries: MetaWebhookDelivery<TEvent, TRawEnvelope>[],
    ): Promise<MetaIngestResult<TEvent, TRawEnvelope>[]> {
        const results: MetaIngestResult<TEvent, TRawEnvelope>[] = [];
        for (const delivery of deliveries) {
            if (!delivery.id) throw MetaError.invalid("Meta delivery id 不能为空");
            const accepted = await this.ingress.deliver(delivery.id, () =>
                emitAllAwaited(this, "event", delivery),
            );
            results.push({ accepted, duplicate: !accepted, delivery });
        }
        return results;
    }

    private assertRequestPath(urlValue: string): void {
        if (!this.config.httpPath) return;
        let url: URL;
        try {
            url = new URL(urlValue, "http://onebots.local");
        } catch (error) {
            throw MetaError.invalid("Meta webhook URL 无效", { cause: String(error) });
        }
        const actual = url.pathname.replace(/\/+$/u, "") || "/";
        const expected = this.config.httpPath.replace(/\/+$/u, "") || "/";
        if (actual !== expected) {
            throw new MetaError("Meta webhook 请求路径与配置不匹配", {
                code: "META_PATH_MISMATCH",
                status: 404,
                details: { expected, actual },
            });
        }
    }

    private reportError(error: Error): void {
        this.dependencies.reportError?.(error);
        if (this.listenerCount("error")) this.emit("error", error);
    }
}

async function readRequestBody(request: Request, maxBytes: number): Promise<Uint8Array> {
    const lengthHeader = request.headers.get("content-length");
    if (lengthHeader !== null) {
        const declaredLength = Number(lengthHeader);
        if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
            throw MetaError.invalid("Content-Length 必须是非负安全整数");
        }
        if (declaredLength > maxBytes) throw bodyTooLarge();
    }
    if (!request.body) return new Uint8Array();
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel("Meta webhook body exceeds configured limit");
                throw bodyTooLarge();
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

function bodyTooLarge(): MetaError {
    return new MetaError("Webhook body 过大", {
        code: "META_BODY_TOO_LARGE",
        status: 413,
    });
}

function normalizeError(error: unknown): MetaError {
    return error instanceof ValidationError
        ? new MetaError(error.message, {
              code: "INVALID_ARGUMENT",
              status: 400,
              cause: error,
          })
        : MetaError.wrap(error);
}

export function verifyMetaSignature(
    rawBody: Uint8Array,
    signature: string | undefined,
    appSecret: string,
): void {
    if (!appSecret) throw MetaError.invalid("Meta app secret 未配置");
    const match = signature?.match(/^sha256=([a-f0-9]{64})$/u);
    if (!match) {
        throw new MetaError("缺少有效 X-Hub-Signature-256", {
            code: "META_INVALID_SIGNATURE",
            status: 401,
        });
    }
    const expected = createHmac("sha256", appSecret).update(rawBody).digest();
    const actual = Buffer.from(match[1], "hex");
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
        throw new MetaError("X-Hub-Signature-256 不匹配", {
            code: "META_INVALID_SIGNATURE",
            status: 401,
        });
    }
}

function assertWebhookConfig(config: MetaWebhookConfig): void {
    const mode = config.receiveMode || "webhook";
    if (mode !== "webhook" && mode !== "manual") throw MetaError.invalid("receiveMode 无效");
    if (mode === "webhook" && (!config.verifyToken || !config.appSecret)) {
        throw MetaError.invalid("webhook 模式必须配置 verifyToken 与 appSecret");
    }
    if (config.httpPath && !/^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/u.test(config.httpPath)) {
        throw MetaError.invalid("httpPath 必须是安全绝对 pathname");
    }
    const max = config.maxBodyBytes;
    if (max !== undefined && (!Number.isSafeInteger(max) || max <= 0 || max > 50 * 1024 * 1024)) {
        throw MetaError.invalid("maxBodyBytes 必须是 1 到 50 MiB 的安全整数");
    }
}

function findHeader(headers: MetaHttpRequest["headers"], name: string): string | undefined {
    return Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name)?.[1];
}

function errorResponse(status: number, code: string, message: string): MetaHttpResponse {
    return { status, headers: JSON_HEADERS, body: { error: { code, message } } };
}

function toResponse(response: MetaHttpResponse): Response {
    return new Response(
        typeof response.body === "string" ? response.body : JSON.stringify(response.body),
        { status: response.status, headers: response.headers },
    );
}
