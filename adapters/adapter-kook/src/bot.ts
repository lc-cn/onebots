import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { emitAllAwaited, FailureCollector, type Next, type RouterContext } from "onebots";
import type { KookBotEvents } from "./bot-events.js";
import { assertKookConfig } from "./config.js";
import { KookError } from "./errors.js";
import { KookGatewaySequence } from "./gateway-sequence.js";
import { KookMessageContextStore, type KookMessageContext } from "./message-context.js";
import { KookOAuthClient } from "./oauth.js";
import { KookRestClient, type KookBinaryResult } from "./rest-client.js";
import type {
    KookApiRequestOptions,
    KookConfig,
    KookEvent,
    KookMessageResult,
    KookGuild,
    KookListResponse,
    KookOAuthScope,
    KookOAuthToken,
    KookSendMessage,
    KookSignal,
    KookUser,
} from "./types.js";
import { parseEvent, parseHello, parseSignal } from "./utils.js";
import { KookWebhookReceiver, kookWebhookErrorStatus, type KookIngestResult } from "./webhook.js";

export type { KookBotEvents } from "./bot-events.js";

export type KookWebSocketFactory = (url: URL) => WebSocket;

const HELLO_TIMEOUT = 6_000;
const PONG_TIMEOUT = 6_000;
const MAX_RECONNECT_DELAY = 60_000;

/** KOOK 官方 REST、Gateway 与 Webhook 的统一底层客户端。 */
export class KookBot extends EventEmitter<KookBotEvents> {
    private socket?: WebSocket;
    private reconnectTimer?: NodeJS.Timeout;
    private pingTimer?: NodeJS.Timeout;
    private pongTimer?: NodeJS.Timeout;
    private generation = 0;
    private reconnectAttempt = 0;
    private stopped = true;
    private startPromise?: Promise<void>;
    private lifecycleAbort?: AbortController;
    private startSignal?: AbortSignal;
    private startSignalAbort?: () => void;
    private readonly gatewaySequence = new KookGatewaySequence();
    private gatewayDeliveryTail: Promise<void> = Promise.resolve();
    private gatewayDeliveryGeneration = 0;
    private sessionId = "";
    private me: KookUser | null = null;
    private readonly webhook: KookWebhookReceiver;
    private readonly rest: KookRestClient;
    private readonly oauth: KookOAuthClient;
    private readonly messageContexts = new KookMessageContextStore();

    constructor(
        readonly config: KookConfig,
        private readonly createSocket: KookWebSocketFactory = url => new WebSocket(url),
    ) {
        super();
        assertKookConfig(config);
        this.webhook = new KookWebhookReceiver(config);
        this.rest = new KookRestClient(config);
        this.oauth = new KookOAuthClient(config);
    }

    get receiveMode(): "gateway" | "webhook" | "manual" {
        return this.config.receive_mode || "gateway";
    }

    async start(signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        if (this.startPromise) return this.startPromise;
        if (!this.stopped) return;
        this.bindStartSignal(signal);
        this.stopped = false;
        const generation = ++this.generation;
        const controller = new AbortController();
        this.lifecycleAbort = controller;
        const startPromise = this.establish(generation, controller.signal).catch(error => {
            this.scheduleReconnect(generation);
            if (signal?.aborted) throw signal.reason;
            throw error;
        });
        this.startPromise = startPromise;
        try {
            await startPromise;
        } finally {
            if (this.startPromise === startPromise) this.startPromise = undefined;
        }
    }

    async stop(): Promise<void> {
        const wasActive = !this.stopped || Boolean(this.startPromise || this.socket);
        this.unbindStartSignal();
        this.stopped = true;
        this.generation++;
        this.startPromise = undefined;
        this.lifecycleAbort?.abort();
        this.lifecycleAbort = undefined;
        this.clearTimers();
        this.me = null;
        const socket = this.socket;
        this.socket = undefined;
        const failures = new FailureCollector();
        if (socket && socket.readyState < WebSocket.CLOSING) {
            await failures.capture(() => socket.close(1000, "OneBots stopped"));
        }
        await failures.capture(() => this.gatewayDeliveryTail);
        this.resetGatewaySession();
        if (wasActive) await failures.capture(() => emitAllAwaited(this, "stopped"));
        try {
            failures.throwIfAny("KOOK 客户端停止期间发生多个错误");
        } catch (error) {
            throw KookError.wrap(error, "KOOK_STOP_FAILED");
        }
    }

    getCachedMe(): KookUser | null {
        return this.me;
    }

    rememberMessageScene(
        messageId: string,
        scene: "channel" | "direct",
        targetId?: string,
        chatCode?: string,
    ): void {
        this.messageContexts.remember(messageId, { scene, targetId, chatCode });
    }

    getMessageScene(messageId: string): "channel" | "direct" | undefined {
        return this.getMessageContext(messageId)?.scene;
    }

    getMessageContext(messageId: string): KookMessageContext | undefined {
        return this.messageContexts.get(messageId);
    }

    private async establish(generation: number, signal: AbortSignal): Promise<void> {
        if (this.stopped || generation !== this.generation) return;
        signal.throwIfAborted();
        if (!this.me) {
            const me = await this.callApi<KookUser>("/v3/user/me", { signal });
            this.assertLifecycle(generation, signal);
            this.me = me;
        }
        if (this.receiveMode === "gateway") await this.connect(generation, signal);
        else {
            await emitAllAwaited(this, "ready");
            this.assertLifecycle(generation, signal);
        }
    }

    private async connect(generation: number, signal: AbortSignal): Promise<void> {
        if (this.stopped || generation !== this.generation) return;
        signal.throwIfAborted();
        this.clearSocketTimers();
        const gateway = await this.callApi<{ url: string }>("/v3/gateway/index", {
            query: { compress: 0 },
            signal,
        });
        this.assertLifecycle(generation, signal);
        const url = new URL(gateway.url);
        if (this.sessionId) {
            url.searchParams.set("resume", "1");
            url.searchParams.set("sn", String(this.gatewaySequence.sn));
            url.searchParams.set("session_id", this.sessionId);
        }
        const socket = this.createSocket(url);
        this.socket = socket;
        try {
            await this.waitForHello(socket, generation, signal);
            this.assertLifecycle(generation, signal);
            this.reconnectAttempt = 0;
            this.armPing(socket, generation);
            await emitAllAwaited(this, "ready");
            this.assertLifecycle(generation, signal);
        } catch (error) {
            if (this.socket === socket) this.socket = undefined;
            socket.removeAllListeners();
            if (socket.readyState < WebSocket.CLOSING) socket.close();
            this.scheduleReconnect(generation);
            throw error;
        }
    }

    private waitForHello(
        socket: WebSocket,
        generation: number,
        signal: AbortSignal,
    ): Promise<void> {
        signal.throwIfAborted();
        return new Promise((resolve, reject) => {
            let settled = false;
            const settle = (error?: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(helloTimer);
                signal.removeEventListener("abort", abort);
                if (error) reject(error);
                else resolve();
            };
            const abort = () =>
                settle(
                    signal.reason instanceof Error
                        ? signal.reason
                        : new KookError("KOOK Gateway 启动已取消", {
                              code: "KOOK_START_CANCELLED",
                          }),
                );
            const helloTimer = setTimeout(
                () =>
                    settle(
                        new KookError("等待 KOOK Gateway HELLO 超时", {
                            code: "KOOK_GATEWAY_HELLO_TIMEOUT",
                        }),
                    ),
                HELLO_TIMEOUT,
            );
            signal.addEventListener("abort", abort, { once: true });
            socket.on("message", raw => {
                try {
                    const signal = parseSignal(JSON.parse(raw.toString()) as unknown);
                    if (signal.s === 1) {
                        const hello = parseHello(signal.d);
                        if (hello.code !== 0) {
                            if ([40106, 40107, 40108].includes(hello.code)) {
                                this.resetGatewaySession();
                            }
                            settle(
                                new KookError(`KOOK Gateway HELLO 失败: ${hello.code}`, {
                                    code: "KOOK_GATEWAY_HELLO_FAILED",
                                    platformCode: hello.code,
                                }),
                            );
                            return;
                        }
                        this.sessionId = hello.session_id || "";
                        settle();
                    } else this.handleSignal(signal, socket, generation);
                } catch (error) {
                    this.reportError(error);
                    if (error instanceof KookError && error.code === "KOOK_EVENT_DELIVERY_FAILED") {
                        socket.terminate();
                    }
                }
            });
            socket.once("error", error => settle(error));
            socket.once("close", (code, reason) => {
                settle(
                    new KookError(`KOOK Gateway 在握手时关闭: ${code} ${reason.toString()}`, {
                        code: "KOOK_GATEWAY_HANDSHAKE_CLOSED",
                        details: { close_code: code, reason: reason.toString() },
                    }),
                );
                this.handleClose(socket, generation);
            });
            socket.once("open", () => this.emit("debug", "KOOK Gateway 已建立 TCP 连接"));
        });
    }

    private handleSignal(signal: KookSignal, socket: WebSocket, generation: number): void {
        if (signal.s === 0 && signal.d) {
            void this.enqueueGatewaySignal(signal).catch(error => {
                this.reportError(error);
                if (this.socket === socket) socket.terminate();
            });
            return;
        }
        if (signal.s === 3) {
            if (this.pongTimer) clearTimeout(this.pongTimer);
            this.pongTimer = undefined;
            return;
        }
        if (signal.s === 5) {
            this.resetGatewaySession();
            socket.close(4000, "KOOK requested reconnect");
            this.scheduleReconnect(generation);
        }
    }

    private armPing(socket: WebSocket, generation: number): void {
        const ping = () => {
            if (
                this.stopped ||
                generation !== this.generation ||
                socket.readyState !== WebSocket.OPEN
            )
                return;
            socket.send(JSON.stringify({ s: 2, sn: this.gatewaySequence.sn }));
            if (this.pongTimer) clearTimeout(this.pongTimer);
            this.pongTimer = setTimeout(() => socket.terminate(), PONG_TIMEOUT);
        };
        ping();
        this.pingTimer = setInterval(ping, 25_000 + Math.floor(Math.random() * 10_001));
        socket.on("close", () => this.handleClose(socket, generation));
        socket.on("error", error => this.reportError(error));
    }

    private handleClose(socket: WebSocket, generation: number): void {
        if (this.socket !== socket) return;
        this.socket = undefined;
        this.clearSocketTimers();
        this.scheduleReconnect(generation);
        this.emit("close");
    }

    private scheduleReconnect(generation: number): void {
        if (this.stopped || generation !== this.generation || this.reconnectTimer) return;
        const attempt = this.reconnectAttempt++;
        const base = Math.min(MAX_RECONNECT_DELAY, 1_000 * 2 ** Math.min(attempt, 6));
        const delay = Math.round(base * (0.8 + Math.random() * 0.4));
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            const signal = this.lifecycleAbort?.signal;
            if (!signal) return;
            void this.establish(generation, signal).catch(error => {
                this.reportError(error);
                this.scheduleReconnect(generation);
            });
        }, delay);
        this.emit("reconnecting", { attempt: attempt + 1, delay });
    }

    private clearSocketTimers(): void {
        if (this.pingTimer) clearInterval(this.pingTimer);
        if (this.pongTimer) clearTimeout(this.pongTimer);
        this.pingTimer = undefined;
        this.pongTimer = undefined;
    }

    private clearTimers(): void {
        this.clearSocketTimers();
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
    }

    private bindStartSignal(signal?: AbortSignal): void {
        this.unbindStartSignal();
        if (!signal) return;
        const abort = () => {
            void this.stop().catch(error =>
                this.reportError(KookError.wrap(error, "KOOK_STOP_FAILED")),
            );
        };
        this.startSignal = signal;
        this.startSignalAbort = abort;
        signal.addEventListener("abort", abort, { once: true });
    }

    private unbindStartSignal(): void {
        if (this.startSignal && this.startSignalAbort) {
            this.startSignal.removeEventListener("abort", this.startSignalAbort);
        }
        this.startSignal = undefined;
        this.startSignalAbort = undefined;
    }

    private assertLifecycle(generation: number, signal: AbortSignal): void {
        signal.throwIfAborted();
        if (this.stopped || generation !== this.generation) {
            throw new KookError("KOOK Bot 启动已取消", { code: "KOOK_START_CANCELLED" });
        }
    }

    private resetGatewaySession(): void {
        // reconnect 信令声明当前 session 及其尚未投递的队列全部失效。
        this.gatewayDeliveryGeneration += 1;
        this.gatewaySequence.reset();
        this.sessionId = "";
    }

    async handleWebhook(ctx: RouterContext, _next: Next): Promise<void> {
        try {
            const result = await this.ingest(ctx.request.body, "webhook");
            ctx.status = result.status;
            ctx.body = result.body;
        } catch (error) {
            this.reportError(error);
            const wrapped = KookError.wrap(error, "KOOK_WEBHOOK_INVALID");
            ctx.status = kookWebhookErrorStatus(wrapped);
            ctx.body = { error: wrapped.message, code: wrapped.code };
        }
    }

    /** 将既有 Webhook、反向 WS 或消息队列事件交给当前 Bot。 */
    async ingest(
        rawEvent: unknown,
        transport: "gateway" | "webhook" = this.receiveMode === "webhook" ? "webhook" : "gateway",
    ): Promise<KookIngestResult> {
        if (transport === "gateway") {
            const signal = parseSignal(rawEvent);
            if (signal.s !== 0 || !signal.d) {
                throw KookError.invalid(
                    "KOOK 手动 Gateway 接入只接受事件信令",
                    "KOOK_MANUAL_SIGNAL_INVALID",
                    { signal: signal.s },
                );
            }
            return this.enqueueGatewaySignal(signal);
        }
        return this.webhook.ingest(rawEvent, (event, signal) =>
            emitAllAwaited(this, "event", event, signal),
        );
    }

    /** 上游已有连接进入全新 session 时重置手动接入的 sn 状态。 */
    async resetIngest(): Promise<void> {
        await this.gatewayDeliveryTail;
        this.resetGatewaySession();
    }

    /** 接入 Fetch/标准 Request 风格的既有 HTTP Host。 */
    async acceptHttp(request: Request): Promise<Response> {
        if (request.method !== "POST") {
            return this.webhook.acceptHttp(request, () => undefined);
        }
        try {
            const raw = (await request.json()) as unknown;
            const result = await this.ingest(raw, "webhook");
            return Response.json(result.body, { status: result.status });
        } catch (error) {
            const wrapped = KookError.wrap(error, "KOOK_WEBHOOK_INVALID");
            return Response.json(
                { error: wrapped.message, code: wrapped.code },
                { status: kookWebhookErrorStatus(wrapped) },
            );
        }
    }

    private enqueueGatewaySignal(signal: KookSignal): Promise<KookIngestResult> {
        const deliveryGeneration = this.gatewayDeliveryGeneration;
        const delivery = this.gatewayDeliveryTail.then(() => {
            if (deliveryGeneration !== this.gatewayDeliveryGeneration) {
                throw new KookError("KOOK Gateway 旧投递队列已失效", {
                    code: "KOOK_GATEWAY_DELIVERY_STALE",
                });
            }
            return this.ingestGatewaySignal(signal);
        });
        const guarded = delivery.catch(error => {
            if (deliveryGeneration === this.gatewayDeliveryGeneration) {
                this.gatewayDeliveryGeneration += 1;
            }
            throw error;
        });
        this.gatewayDeliveryTail = guarded.then(
            () => undefined,
            () => undefined,
        );
        return guarded;
    }

    private async ingestGatewaySignal(signal: KookSignal): Promise<KookIngestResult> {
        const sequenced = this.gatewaySequence.ingest(signal);
        const events: KookEvent[] = [];
        let ready: KookSignal | undefined = sequenced.ready[0];
        while (ready) {
            const event = parseEvent(ready.d);
            if (event.channel_type === "WEBHOOK_CHALLENGE") {
                throw KookError.invalid(
                    "KOOK Gateway 不接受 Webhook challenge",
                    "KOOK_GATEWAY_CHALLENGE_INVALID",
                );
            }
            try {
                await emitAllAwaited(this, "event", event, ready);
            } catch (error) {
                throw KookError.wrap(error, "KOOK_EVENT_DELIVERY_FAILED", {
                    details: { sn: ready.sn, message_id: event.msg_id },
                });
            }
            events.push(event);
            ready = this.gatewaySequence.commit(ready);
        }
        return {
            status: 200,
            body: {
                success: true,
                ...(sequenced.duplicate ? { duplicate: true } : {}),
                ...(!sequenced.duplicate && events.length === 0 ? { buffered: true } : {}),
            },
            ...(events.length ? { event: events.at(-1), events, signal } : {}),
        };
    }

    /** EventEmitter 的 error 无监听器时会再次抛错；SDK 生命周期错误保持显式可订阅。 */
    private reportError(error: unknown): void {
        if (this.listenerCount("error") > 0) this.emit("error", error);
    }

    async callApi<T = unknown>(path: string, options: KookApiRequestOptions = {}): Promise<T> {
        return this.rest.call(path, options);
    }

    /** 生成用户授权页；state 用于调用方校验 OAuth 回调来源。 */
    buildOAuthAuthorizationUrl(scopes: readonly KookOAuthScope[], state: string): string {
        return this.oauth.buildAuthorizationUrl(scopes, state);
    }

    exchangeOAuthCode(code: string): Promise<KookOAuthToken> {
        return this.oauth.exchangeCode(code);
    }

    getOAuthUserInfo(accessToken: string): Promise<KookUser> {
        return this.oauth.getUserInfo(accessToken);
    }

    listOAuthUserGuilds(
        accessToken: string,
        query?: Readonly<Record<string, string | number | boolean | undefined>>,
    ): Promise<KookListResponse<KookGuild>> {
        return this.oauth.listUserGuilds(accessToken, query);
    }

    callOAuthApi<T = unknown>(
        accessToken: string,
        path: string,
        query?: Readonly<Record<string, string | number | boolean | undefined>>,
    ): Promise<T> {
        return this.oauth.call(accessToken, path, query);
    }

    sendChannelMessage(targetId: string, message: KookSendMessage): Promise<KookMessageResult> {
        return this.callApi("/v3/message/create", {
            method: "POST",
            body: { target_id: targetId, ...message },
        });
    }

    sendDirectMessage(targetId: string, message: KookSendMessage): Promise<KookMessageResult> {
        return this.callApi("/v3/direct-message/create", {
            method: "POST",
            body: { target_id: targetId, ...message },
        });
    }

    async uploadAsset(data: Uint8Array, filename: string, contentType?: string): Promise<string> {
        return this.rest.upload(data, filename, contentType);
    }

    callMultipart<T>(
        path: string,
        fields: Readonly<Record<string, string | number | boolean | undefined>>,
        file: { field: string; data: Uint8Array; filename: string; contentType?: string },
    ): Promise<T> {
        return this.rest.multipart(path, fields, file);
    }

    download(
        path: string,
        query?: Readonly<Record<string, string | number | boolean | undefined>>,
        signal?: AbortSignal,
    ): Promise<KookBinaryResult> {
        return this.rest.download(path, query, signal);
    }
}
