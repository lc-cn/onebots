import { EventEmitter } from "node:events";
import { emitAllAwaited, ReliableEventIngress, sha256Json, ValidationError } from "onebots";
import { GoogleChatAuth, type GoogleChatTokenVerifier } from "./auth.js";
import { GoogleChatError } from "./errors.js";
import {
    interactionIdentity,
    parseCloudEvent,
    parseInteractionEvent,
    parseManualEvent,
    parsePubSubEnvelope,
    parseSpace,
} from "./event-validation.js";
import { GoogleChatTransport } from "./transport.js";
import type {
    GoogleChatCallOptions,
    GoogleChatClientEvents,
    GoogleChatCloudEvent,
    GoogleChatConfig,
    GoogleChatEventEnvelope,
    GoogleChatHttpRequest,
    GoogleChatHttpResponse,
    GoogleChatIngestResult,
    GoogleChatInteractionEvent,
    GoogleChatMessage,
    GoogleChatMediaResponse,
    GoogleChatSpace,
    GoogleChatUser,
    GoogleChatVerificationMode,
} from "./types.js";
import { assertGoogleChatConfig, isRecord } from "./validation.js";

const JSON_HEADERS = Object.freeze({ "content-type": "application/json" });

export interface GoogleChatClientDependencies {
    fetcher?: typeof fetch;
    verifier?: GoogleChatTokenVerifier;
    reportError?(error: Error): void;
    /** 为交互事件生成同步文本、卡片或 dialog 响应。 */
    interactionResponse?(
        event: GoogleChatInteractionEvent,
    ): Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
}

/** 交互 HTTP、Pub/Sub push 与 manual 事件共用的 Google Chat Client。 */
export class GoogleChatClient extends EventEmitter<GoogleChatClientEvents> {
    private readonly ingress = new ReliableEventIngress<string>();
    private readonly auth: GoogleChatAuth;
    private readonly verifier: GoogleChatTokenVerifier;
    private readonly transport: GoogleChatTransport;
    private readonly spaces = new Map<string, GoogleChatSpace>();
    private readonly users = new Map<string, GoogleChatUser>();
    private readonly messages = new Map<string, GoogleChatMessage>();
    private startTask?: Promise<void>;
    private started = false;
    private generation = 0;

    constructor(
        readonly config: GoogleChatConfig,
        private readonly dependencies: GoogleChatClientDependencies = {},
    ) {
        super();
        assertGoogleChatConfig(config);
        this.auth = new GoogleChatAuth(config, dependencies.fetcher);
        this.verifier = dependencies.verifier || this.auth;
        this.transport = new GoogleChatTransport(config, this.auth, dependencies.fetcher);
    }

    get receiveMode(): "interaction-http" | "pubsub-push" | "manual" {
        return this.config.receive_mode || "interaction-http";
    }

    get principalName(): string {
        return (
            this.config.principal_name ||
            ((this.config.auth_mode || "service-account") === "access-token"
                ? "users/me"
                : "users/app")
        );
    }

    async start(): Promise<void> {
        if (this.started) return;
        if (this.startTask) return this.startTask;
        const generation = ++this.generation;
        const task = this.startInternal(generation);
        this.startTask = task;
        try {
            await task;
        } finally {
            if (this.startTask === task) this.startTask = undefined;
        }
    }

    private async startInternal(generation: number): Promise<void> {
        await this.auth.accessToken();
        if (generation !== this.generation)
            throw new GoogleChatError("Google Chat Client 启动已取消", {
                code: "GOOGLE_CHAT_START_CANCELLED",
            });
        await emitAllAwaited(this, "ready");
        if (generation !== this.generation)
            throw new GoogleChatError("Google Chat Client 启动已取消", {
                code: "GOOGLE_CHAT_START_CANCELLED",
            });
        this.started = true;
    }

    async stop(): Promise<void> {
        this.generation += 1;
        this.started = false;
        await emitAllAwaited(this, "stop");
    }

    call(method: string, path: string, options?: GoogleChatCallOptions): Promise<unknown> {
        return this.transport.call(method, path, options);
    }

    /** 下载 Chat 上传附件的原始字节；与 JSON REST 调用分离以保持返回类型闭合。 */
    downloadMedia(resourceName: string, signal?: AbortSignal): Promise<GoogleChatMediaResponse> {
        return this.transport.downloadMedia(resourceName, signal);
    }

    getCachedSpace(name: string): GoogleChatSpace | undefined {
        return this.spaces.get(name);
    }

    getCachedUser(name: string): GoogleChatUser | undefined {
        return this.users.get(name);
    }

    getCachedMessage(name: string): GoogleChatMessage | undefined {
        return this.messages.get(name);
    }

    async ingest(rawEvent: unknown): Promise<GoogleChatIngestResult[]> {
        return this.deliver(parseManualEvent(rawEvent));
    }

    async acceptHttp(request: Request): Promise<Response> {
        let body: unknown;
        try {
            const text = await request.text();
            body = text ? JSON.parse(text) : {};
        } catch {
            return toResponse(errorResponse(400, "INVALID_ARGUMENT", "请求体不是有效 JSON"));
        }
        return toResponse(
            await this.ingestHttp({
                method: request.method,
                url: request.url,
                headers: { authorization: request.headers.get("authorization") || undefined },
                body,
            }),
        );
    }

    async ingestHttp(request: GoogleChatHttpRequest): Promise<GoogleChatHttpResponse> {
        if (request.method.toUpperCase() !== "POST")
            return errorResponse(405, "METHOD_NOT_ALLOWED", "Google Chat endpoint 仅接受 POST");
        if (!isRecord(request.body))
            return errorResponse(400, "INVALID_ARGUMENT", "请求体必须是对象");
        try {
            if (this.receiveMode === "manual") {
                throw new GoogleChatError("manual 模式仅接受 ingest(rawEvent)", {
                    code: "GOOGLE_CHAT_MANUAL_ONLY",
                    status: 409,
                });
            }
            this.assertRequestPath(request.url);
            const bearer = findHeader(request.headers, "authorization")?.match(
                /^Bearer\s+(.+)$/iu,
            )?.[1];
            if (!bearer)
                throw new GoogleChatError("请求缺少 Google Bearer token", {
                    code: "UNAUTHENTICATED",
                    status: 401,
                });
            const mode = this.verificationMode();
            await this.verifier.verify(
                bearer,
                mode,
                this.config.verification_audience || "",
                mode === "pubsub" ? this.config.pubsub_service_account_email : undefined,
            );
            let responseBody: Record<string, unknown> = {};
            if (this.receiveMode === "pubsub-push") {
                const pubsub = parsePubSubEnvelope(request.body);
                const events = parseCloudEvent(pubsub.event).map(event => ({
                    source: "workspace-event" as const,
                    event,
                    raw_event: request.body,
                    delivery_id: `${pubsub.envelope.message.messageId}:${event.id}`,
                }));
                await this.deliver(events);
            } else {
                const event = parseInteractionEvent(request.body);
                await this.deliver([
                    {
                        source: "interaction",
                        event,
                        raw_event: request.body,
                        delivery_id: interactionIdentity(event),
                    },
                ]);
                const response = await this.dependencies.interactionResponse?.(event);
                if (response !== undefined && !isRecord(response)) {
                    throw GoogleChatError.invalid("interactionResponse 必须返回对象或 undefined");
                }
                responseBody = response || {};
            }
            return { status: 200, headers: JSON_HEADERS, body: responseBody };
        } catch (error) {
            const wrapped =
                error instanceof ValidationError
                    ? new GoogleChatError(error.message, {
                          code: "INVALID_ARGUMENT",
                          status: 400,
                          cause: error,
                      })
                    : GoogleChatError.wrap(error);
            this.reportError(wrapped);
            return errorResponse(
                wrapped.status || 500,
                wrapped.code || "INTERNAL",
                wrapped.message,
            );
        }
    }

    private async deliver(envelopes: GoogleChatEventEnvelope[]): Promise<GoogleChatIngestResult[]> {
        const results: GoogleChatIngestResult[] = [];
        for (const envelope of envelopes) {
            await this.enrichContext(envelope);
            const eventType = envelope.event.type;
            if (this.config.event_types?.length && !this.config.event_types.includes(eventType)) {
                results.push({ accepted: false, duplicate: false, envelope });
                continue;
            }
            const key = envelope.delivery_id || sha256Json(envelope);
            const accepted = await this.ingress.deliver(key, () =>
                emitAllAwaited(this, "event", envelope),
            );
            results.push({ accepted, duplicate: !accepted, envelope });
        }
        return results;
    }

    private async enrichContext(envelope: GoogleChatEventEnvelope): Promise<void> {
        const event = envelope.event;
        const cloud = event.specversion === "1.0" ? (event as GoogleChatCloudEvent) : undefined;
        const interaction = cloud ? undefined : (event as GoogleChatInteractionEvent);
        const data = cloud?.data;
        const message = (interaction?.message || data?.message) as GoogleChatMessage | undefined;
        const user = (interaction?.user || message?.sender) as GoogleChatUser | undefined;
        const explicitSpace = (interaction?.space || message?.space || data?.space) as
            | GoogleChatSpace
            | undefined;
        if (message?.name) remember(this.messages, message.name, message);
        if (user?.name) remember(this.users, user.name, user);
        if (explicitSpace?.name) {
            const cached = this.spaces.get(explicitSpace.name);
            if (!cached || explicitSpace.spaceType) {
                remember(this.spaces, explicitSpace.name, explicitSpace);
            }
        }
        const spaceName =
            explicitSpace?.name || message?.name?.split("/messages/")[0] || resourceSpace(data);
        if (!spaceName) return;
        let space = this.spaces.get(spaceName);
        if (!message) {
            envelope.space = space || explicitSpace;
            return;
        }
        if (!space?.spaceType && !space?.type) {
            const response = await this.call("GET", `/v1/${spaceName}`);
            const resolved = parseSpace(response, "spaces.get response");
            if (resolved.name !== spaceName) {
                throw GoogleChatError.invalid("spaces.get 未返回匹配的 Space resource");
            }
            space = resolved;
            remember(this.spaces, spaceName, space);
        }
        envelope.space = space;
    }

    private verificationMode(): GoogleChatVerificationMode {
        return (
            this.config.verification_mode ||
            (this.receiveMode === "pubsub-push" ? "pubsub" : "endpoint-url")
        );
    }

    private assertRequestPath(urlValue: string): void {
        const expected = this.config.http_path;
        if (!expected) return;
        let pathname: string;
        try {
            pathname =
                new URL(urlValue, "http://onebots.local").pathname.replace(/\/+$/u, "") || "/";
        } catch (error) {
            throw GoogleChatError.invalid("Google Chat HTTP 请求 URL 无效", {
                cause: String(error),
            });
        }
        const normalized = expected.replace(/\/+$/u, "") || "/";
        if (pathname !== normalized) {
            throw new GoogleChatError("Google Chat HTTP 请求路径与配置不匹配", {
                code: "GOOGLE_CHAT_PATH_MISMATCH",
                status: 404,
                details: { expected: normalized, received: pathname },
            });
        }
    }

    private reportError(error: Error): void {
        this.dependencies.reportError?.(error);
        if (this.listenerCount("error")) this.emit("error", error);
    }
}

function resourceSpace(data: Record<string, unknown> | undefined): string | undefined {
    if (!data) return undefined;
    for (const value of Object.values(data)) {
        if (!isRecord(value) || typeof value.name !== "string") continue;
        const match = value.name.match(/^(spaces\/[^/]+)/u);
        if (match) return match[1];
    }
    return undefined;
}

function remember<TKey, TValue>(map: Map<TKey, TValue>, key: TKey, value: TValue): void {
    map.delete(key);
    map.set(key, value);
    if (map.size > 10_000) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
    }
}

function findHeader(headers: GoogleChatHttpRequest["headers"], name: string): string | undefined {
    return Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name)?.[1];
}

function errorResponse(status: number, code: string, message: string): GoogleChatHttpResponse {
    return { status, headers: JSON_HEADERS, body: { error: { code, message } } };
}

function toResponse(response: GoogleChatHttpResponse): Response {
    return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: response.headers,
    });
}
