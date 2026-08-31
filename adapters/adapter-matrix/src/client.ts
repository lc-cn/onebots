import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { emitAllAwaited, ReliableEventIngress, sha256Json, ValidationError } from "onebots";
import { abortableDelay, findHeader, isAbortError, trimMap } from "./client-runtime.js";
import { MatrixError } from "./errors.js";
import {
    matrixErrorResponse,
    matrixJsonResponse,
    toFetchResponse,
    verifyHomeserverToken,
} from "./http.js";
import { parseMatrixSync } from "./sync.js";
import { MatrixTransport } from "./transport.js";
import type {
    MatrixCallOptions,
    MatrixClientEvents,
    MatrixConfig,
    MatrixCreateRoomParams,
    MatrixCreateRoomResponse,
    MatrixEventEnvelope,
    MatrixEventContext,
    MatrixHttpRequest,
    MatrixHttpResponse,
    MatrixIdentity,
    MatrixIngestResult,
    MatrixRawEvent,
    MatrixRoomEventPage,
    MatrixSendResponse,
    MatrixTransactionResult,
    MatrixUploadResponse,
} from "./types.js";
import {
    assertMatrixConfig,
    isRecord,
    parseCreateRoomResponse,
    parseEventContext,
    parseIdentity,
    parseMatrixEnvelope,
    parseMatrixEvent,
    parseRoomEventPage,
    parseSendResponse,
    parseUploadResponse,
} from "./validation.js";

const DEFAULT_SYNC_TIMEOUT = 30_000;
const DEFAULT_RETRY_MIN = 1_000;
const DEFAULT_RETRY_MAX = 60_000;

export interface MatrixClientDependencies {
    fetcher?: typeof fetch;
    reportError?(error: Error): void;
}

/** Matrix 原生客户端；同步、AppService 与手动事件均汇入同一可靠入口。 */
export class MatrixClient extends EventEmitter<MatrixClientEvents> {
    private readonly transport: MatrixTransport;
    private readonly eventIngress = new ReliableEventIngress<string>();
    private readonly transactionIngress = new ReliableEventIngress<string>();
    private readonly directRooms: Set<string>;
    private readonly eventRooms = new Map<string, string>();
    private readonly reactionEvents = new Map<string, { event_id: string; key?: string }>();
    private readonly typingUsers = new Map<string, Set<string>>();
    private abortController?: AbortController;
    private syncTask?: Promise<void>;
    private startTask?: Promise<MatrixIdentity>;
    private identity?: MatrixIdentity;
    private generation = 0;

    constructor(
        readonly config: MatrixConfig,
        private readonly dependencies: MatrixClientDependencies = {},
    ) {
        super();
        assertMatrixConfig(config);
        this.transport = new MatrixTransport(config, dependencies.fetcher);
        this.directRooms = new Set(config.direct_room_ids || []);
    }

    get receiveMode(): "sync" | "appservice" | "manual" {
        return this.config.receive_mode || "sync";
    }

    get homeserverUrl(): string {
        return this.transport.homeserverUrl;
    }

    get userId(): string {
        return this.identity?.user_id || this.config.user_id;
    }

    async start(): Promise<MatrixIdentity> {
        if (this.startTask) return this.startTask;
        if (this.identity) return this.identity;
        const generation = ++this.generation;
        const task = this.startInternal(generation);
        this.startTask = task;
        try {
            return await task;
        } finally {
            if (this.startTask === task) this.startTask = undefined;
        }
    }

    private async startInternal(generation: number): Promise<MatrixIdentity> {
        const token = this.config.access_token ? "access" : "appservice";
        const identity = parseIdentity(
            await this.call("GET", "/_matrix/client/v3/account/whoami", { token }),
        );
        if (identity.user_id !== this.config.user_id) {
            throw new MatrixError("Matrix 凭据身份与配置 user_id 不一致", {
                code: "MATRIX_IDENTITY_MISMATCH",
                details: { expected: this.config.user_id, actual: identity.user_id },
            });
        }
        if (generation !== this.generation) {
            throw new MatrixError("Matrix Client 启动已取消", { code: "MATRIX_START_CANCELLED" });
        }
        this.identity = identity;
        try {
            await emitAllAwaited(this, "ready", identity);
        } catch (error) {
            this.identity = undefined;
            throw error;
        }
        if (generation !== this.generation) {
            this.identity = undefined;
            throw new MatrixError("Matrix Client 启动已取消", { code: "MATRIX_START_CANCELLED" });
        }
        if (this.receiveMode === "sync" && !this.syncTask) {
            this.abortController = new AbortController();
            this.syncTask = this.runSync(this.abortController.signal).finally(() => {
                this.syncTask = undefined;
                this.abortController = undefined;
            });
        }
        return identity;
    }

    async stop(): Promise<void> {
        this.generation += 1;
        this.abortController?.abort();
        try {
            await this.syncTask;
        } catch (error) {
            if (!isAbortError(error)) throw error;
        }
        this.identity = undefined;
        await emitAllAwaited(this, "stop");
    }

    call(method: string, path: string, options: MatrixCallOptions = {}): Promise<unknown> {
        const token = options.token || (this.config.access_token ? "access" : "appservice");
        return this.transport.call(method, path, { ...options, token });
    }

    /** 最底层事件入口；只在全部监听器成功后提交事件身份。 */
    async ingest(rawEvent: unknown): Promise<MatrixIngestResult> {
        const parsed = parseMatrixEnvelope(rawEvent);
        const envelope = this.enrichEventContext(parsed);
        if (envelope.room_id && envelope.event.event_id) {
            this.rememberEventRoom(envelope.event.event_id, envelope.room_id);
        }
        const key = envelope.event.event_id || sha256Json(envelope);
        if (!this.shouldDeliver(envelope.event)) {
            return { accepted: false, duplicate: false, envelope };
        }
        const accepted = await this.eventIngress.deliver(key, () =>
            emitAllAwaited(this, "event", envelope),
        );
        return { accepted, duplicate: !accepted, envelope };
    }

    /** 处理标准 AppService HTTP 请求并返回 Fetch Response。 */
    async acceptHttp(request: Request): Promise<Response> {
        let body: unknown;
        if (request.method !== "GET" && request.method !== "HEAD") {
            const text = await request.text();
            try {
                body = text ? JSON.parse(text) : {};
            } catch {
                return toFetchResponse(
                    matrixErrorResponse(400, "M_BAD_JSON", "请求体不是有效 JSON"),
                );
            }
        }
        const headers: Record<string, string | undefined> = {
            authorization: request.headers.get("authorization") || undefined,
        };
        return toFetchResponse(
            await this.ingestHttp({ method: request.method, url: request.url, headers, body }),
        );
    }

    /** 结构化 AppService Host 接口，Koa/Zhin/Serverless 可直接桥接。 */
    async ingestHttp(request: MatrixHttpRequest): Promise<MatrixHttpResponse> {
        let url: URL;
        try {
            url = new URL(request.url, "https://matrix-appservice.invalid");
        } catch {
            return matrixErrorResponse(400, "M_BAD_JSON", "AppService 请求 URL 无效");
        }
        const routeIndex = url.pathname.indexOf("/_matrix/app/v1/");
        if (routeIndex < 0)
            return matrixErrorResponse(404, "M_UNRECOGNIZED", "未知 AppService 路由");
        const route = url.pathname.slice(routeIndex);
        const transactionMatch = route.match(/^\/_matrix\/app\/v1\/transactions\/([^/]+)$/u);
        const userQuery = route.match(/^\/_matrix\/app\/v1\/users\/([^/]+)$/u);
        const roomQuery = route.match(/^\/_matrix\/app\/v1\/rooms\/([^/]+)$/u);
        const knownRoute =
            Boolean(transactionMatch || userQuery || roomQuery) || route === "/_matrix/app/v1/ping";
        if (!knownRoute) return matrixErrorResponse(404, "M_UNRECOGNIZED", "未知 AppService 路由");
        const expectedMethod = transactionMatch ? "PUT" : userQuery || roomQuery ? "GET" : "POST";
        if (request.method.toUpperCase() !== expectedMethod) {
            return matrixErrorResponse(405, "M_UNRECOGNIZED", "AppService 路由不支持该方法");
        }
        try {
            verifyHomeserverToken(
                findHeader(request.headers, "authorization"),
                url.searchParams.get("access_token") || undefined,
                this.config.hs_token || "",
            );
            if (userQuery || roomQuery) {
                return matrixErrorResponse(
                    404,
                    "M_NOT_FOUND",
                    "该 Matrix namespace 实体未由 OneBots 虚拟化",
                );
            }
            if (!isRecord(request.body)) {
                throw new MatrixError("AppService 请求体必须是对象", {
                    code: "M_BAD_JSON",
                    status: 400,
                });
            }
            if (!transactionMatch) return matrixJsonResponse(200, {});
            const transaction = await this.ingestTransaction(
                decodeURIComponent(transactionMatch[1]),
                request.body,
            );
            return { ...matrixJsonResponse(200, {}), transaction };
        } catch (error) {
            const wrapped =
                error instanceof ValidationError
                    ? new MatrixError(error.message, {
                          code: "M_BAD_JSON",
                          status: 400,
                          cause: error,
                      })
                    : MatrixError.wrap(error, "M_UNKNOWN");
            this.reportError(wrapped);
            return matrixErrorResponse(
                wrapped.status || 500,
                wrapped.code || "M_UNKNOWN",
                wrapped.message,
            );
        }
    }

    async sendEvent(
        roomId: string,
        eventType: string,
        content: Record<string, unknown>,
        transactionId = randomUUID(),
    ): Promise<MatrixSendResponse> {
        const response = parseSendResponse(
            await this.call(
                "PUT",
                `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(eventType)}/${encodeURIComponent(transactionId)}`,
                { body: content },
            ),
        );
        this.rememberEventRoom(response.event_id, roomId);
        return response;
    }

    async redact(roomId: string, eventId: string, reason?: string): Promise<MatrixSendResponse> {
        return parseSendResponse(
            await this.call(
                "PUT",
                `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${randomUUID()}`,
                { body: reason ? { reason } : {} },
            ),
        );
    }

    async getEvent(roomId: string, eventId: string): Promise<MatrixRawEvent> {
        return parseMatrixEvent(
            await this.call(
                "GET",
                `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
            ),
        );
    }

    async getMessages(
        roomId: string,
        options: { from?: string; limit?: number; direction?: "b" | "f" } = {},
    ): Promise<MatrixRoomEventPage> {
        return parseRoomEventPage(
            await this.call(
                "GET",
                `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`,
                {
                    query: {
                        dir: options.direction || "b",
                        from: options.from,
                        limit: options.limit,
                    },
                },
            ),
        );
    }

    async getEventContext(
        roomId: string,
        eventId: string,
        limit?: number,
    ): Promise<MatrixEventContext> {
        return parseEventContext(
            await this.call(
                "GET",
                `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/context/${encodeURIComponent(eventId)}`,
                { query: { limit } },
            ),
        );
    }

    async createRoom(params: MatrixCreateRoomParams): Promise<MatrixCreateRoomResponse> {
        return parseCreateRoomResponse(
            await this.call("POST", "/_matrix/client/v3/createRoom", { body: params }),
        );
    }

    async uploadMedia(
        data: Blob | Uint8Array,
        filename?: string,
        contentType?: string,
    ): Promise<MatrixUploadResponse> {
        return parseUploadResponse(await this.transport.upload(data, filename, contentType));
    }

    resolveEventRoom(eventId: string): string | undefined {
        return this.eventRooms.get(eventId);
    }

    private async ingestTransaction(
        transactionId: string,
        body: Record<string, unknown>,
    ): Promise<MatrixTransactionResult> {
        if (!Array.isArray(body.events)) throw MatrixError.invalid("AppService events 必须是数组");
        if (body.ephemeral !== undefined && !Array.isArray(body.ephemeral)) {
            throw MatrixError.invalid("AppService ephemeral 必须是数组");
        }
        const events: unknown[] = body.events;
        const ephemeral: unknown[] = Array.isArray(body.ephemeral) ? body.ephemeral : [];
        let accepted = 0;
        const delivered = await this.transactionIngress.deliver(transactionId, async () => {
            const entries = [
                ...events.map(event => ({ event, ephemeral: false })),
                ...ephemeral.map(event => ({ event, ephemeral: true })),
            ];
            for (const entry of entries) {
                const event = parseMatrixEvent(entry.event);
                const result = await this.ingest({
                    event,
                    room_id: event.room_id,
                    section: entry.ephemeral ? "ephemeral" : "appservice",
                    is_direct: event.room_id ? this.directRooms.has(event.room_id) : false,
                    transaction_id: transactionId,
                });
                if (result.accepted) accepted += 1;
            }
        });
        return { transaction_id: transactionId, accepted, duplicate: !delivered };
    }

    private async runSync(signal: AbortSignal): Promise<void> {
        let since: string | undefined;
        let attempt = 0;
        while (!signal.aborted) {
            try {
                const batch = parseMatrixSync(
                    await this.call("GET", "/_matrix/client/v3/sync", {
                        query: this.syncQuery(since),
                        signal,
                    }),
                    this.directRooms,
                );
                this.directRooms.clear();
                for (const room of batch.directRooms) this.directRooms.add(room);
                for (const envelope of batch.envelopes) await this.ingest(envelope);
                since = batch.nextBatch;
                attempt = 0;
            } catch (error) {
                if (isAbortError(error) || signal.aborted) return;
                const wrapped = MatrixError.wrap(error, "MATRIX_SYNC_ERROR");
                this.reportError(wrapped);
                attempt += 1;
                await abortableDelay(this.retryDelay(attempt, wrapped), signal);
            }
        }
    }

    private syncQuery(since: string | undefined): Record<string, string | number | undefined> {
        const types = this.config.event_types?.length ? this.config.event_types : undefined;
        const filter: Record<string, unknown> = {
            presence: { types },
            room: {
                timeline: {
                    limit: since ? undefined : (this.config.initial_sync_limit ?? 20),
                    types,
                },
                state: {
                    lazy_load_members: this.config.lazy_load_members !== false,
                    types,
                },
                ephemeral: { types },
                account_data: { types },
            },
            account_data: { types },
        };
        return {
            since,
            timeout: since ? this.config.sync_timeout_ms || DEFAULT_SYNC_TIMEOUT : 0,
            set_presence: this.config.sync_presence,
            filter: JSON.stringify(filter),
        };
    }

    private retryDelay(attempt: number, error: MatrixError): number {
        if (error.retryAfterMs !== undefined) return error.retryAfterMs;
        const min = this.config.sync_retry_min_ms || DEFAULT_RETRY_MIN;
        const max = this.config.sync_retry_max_ms || DEFAULT_RETRY_MAX;
        return Math.min(max, min * 2 ** Math.min(attempt - 1, 16));
    }

    private shouldDeliver(event: MatrixRawEvent): boolean {
        const types = this.config.event_types;
        return this.receiveMode !== "sync" || !types?.length || types.includes(event.type);
    }

    private rememberEventRoom(eventId: string, roomId: string): void {
        this.eventRooms.delete(eventId);
        this.eventRooms.set(eventId, roomId);
        if (this.eventRooms.size > 10_000) {
            const oldest = this.eventRooms.keys().next().value;
            if (oldest) this.eventRooms.delete(oldest);
        }
    }

    private enrichEventContext(envelope: MatrixEventEnvelope): MatrixEventEnvelope {
        const event = envelope.event;
        if (event.type === "m.typing" && envelope.room_id) {
            const previous = this.typingUsers.get(envelope.room_id) || new Set<string>();
            const current = new Set(
                Array.isArray(event.content.user_ids)
                    ? event.content.user_ids.filter(
                          (value): value is string => typeof value === "string",
                      )
                    : [],
            );
            const typing_delta = {
                started: [...current].filter(userId => !previous.has(userId)),
                stopped: [...previous].filter(userId => !current.has(userId)),
            };
            this.typingUsers.set(envelope.room_id, current);
            trimMap(this.typingUsers, 10_000);
            envelope = { ...envelope, typing_delta };
        }
        if (event.type === "m.reaction" && event.event_id) {
            const relation = isRecord(event.content["m.relates_to"])
                ? event.content["m.relates_to"]
                : undefined;
            const target = typeof relation?.event_id === "string" ? relation.event_id : undefined;
            if (target) {
                this.reactionEvents.set(event.event_id, {
                    event_id: target,
                    key: typeof relation?.key === "string" ? relation.key : undefined,
                });
                trimMap(this.reactionEvents, 10_000);
            }
        }
        if (event.type === "m.room.redaction" && event.redacts) {
            const reaction = this.reactionEvents.get(event.redacts);
            if (reaction) {
                this.reactionEvents.delete(event.redacts);
                return { ...envelope, redacted_reaction: reaction };
            }
        }
        return envelope;
    }

    private reportError(error: Error): void {
        this.dependencies.reportError?.(error);
        if (this.listenerCount("error")) this.emit("error", error);
    }
}
