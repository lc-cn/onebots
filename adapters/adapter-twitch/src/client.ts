import { emitAllAwaited, ReliableEventIngress } from "onebots";
import { WebSocket } from "ws";
import { validateTwitchToken } from "./auth.js";
import { TwitchApiClient, type TwitchApiDependencies } from "./client-api.js";
import { assertTwitchConfig, expandSubscriptions } from "./configuration.js";
import { TwitchError } from "./errors.js";
import { TwitchEventSubTransport, type TwitchEventSubDependencies } from "./eventsub.js";
import type {
    TwitchClientDependencies,
    TwitchConfig,
    TwitchDelivery,
    TwitchEventSubMessage,
    TwitchEventSubSession,
    TwitchIngestResult,
    TwitchSocketAttachOptions,
    TwitchTokenInfo,
} from "./types.js";
import { parseEventSubMessage } from "./validation.js";
import { TwitchWebhookHandler } from "./webhook.js";

export interface TwitchClientOptions
    extends TwitchApiDependencies, TwitchEventSubDependencies, TwitchClientDependencies {}

/** 可独立嵌入的 Twitch Helix + EventSub Client，所有 transport 汇入同一可靠事件入口。 */
export class TwitchClient extends TwitchApiClient {
    private readonly eventsub: TwitchEventSubTransport;
    private readonly webhook: TwitchWebhookHandler;
    private readonly ingress = new ReliableEventIngress<string>();
    private readonly subscribedSessions = new Set<string>();
    private startTask?: Promise<void>;
    private startAbort?: AbortController;
    private externalSignal?: AbortSignal;
    private externalAbort?: () => void;
    private generation = 0;
    private started = false;
    private currentToken?: TwitchTokenInfo;

    constructor(
        config: TwitchConfig,
        private readonly dependencies: TwitchClientOptions = {},
    ) {
        super(config, dependencies);
        assertTwitchConfig(config);
        this.eventsub = new TwitchEventSubTransport(config, dependencies);
        this.webhook = new TwitchWebhookHandler(config, {
            ingest: event => this.ingest(event),
            now: dependencies.now,
        });
        this.eventsub.on("message", message => this.consumeSocketMessage(message));
        this.eventsub.on("connected", (session, resumed) => this.onConnected(session, resumed));
        this.eventsub.on("disconnected", error => emitAllAwaited(this, "disconnected", error));
        this.eventsub.on("error", error => this.reportError(error));
    }

    get receiveMode(): "websocket" | "webhook" | "manual" {
        return this.config.receive_mode || "websocket";
    }

    get isStarted(): boolean {
        return this.started;
    }

    get isConnected(): boolean {
        return this.eventsub.connected;
    }

    get tokenInfo(): TwitchTokenInfo | undefined {
        return this.currentToken ? structuredClone(this.currentToken) : undefined;
    }

    async start(signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        if (this.started) return;
        if (this.startTask) return this.startTask;
        const generation = ++this.generation;
        const controller = new AbortController();
        this.startAbort = controller;
        this.bindExternalSignal(signal, controller);
        const task = this.initialize(generation, controller.signal);
        this.startTask = task;
        try {
            await task;
        } finally {
            if (this.startTask === task) this.startTask = undefined;
            if (!this.started) {
                this.unbindExternalSignal();
                if (this.startAbort === controller) this.startAbort = undefined;
            }
        }
    }

    async stop(): Promise<void> {
        ++this.generation;
        this.unbindExternalSignal();
        this.startAbort?.abort();
        await this.startTask?.catch(() => undefined);
        await this.eventsub.stop();
        this.subscribedSessions.clear();
        this.started = false;
        this.currentToken = undefined;
        this.setCurrentUser(undefined);
        await emitAllAwaited(this, "stop");
    }

    /** 已有连接、Webhook consumer、队列与测试夹具共用的最底层可靠入口。 */
    async ingest(rawEvent: unknown): Promise<TwitchIngestResult> {
        const envelope = parseEventSubMessage(rawEvent);
        if (envelope.metadata.message_type === "webhook_callback_verification") {
            throw TwitchError.invalid("verification challenge 必须由 acceptHttp() 响应");
        }
        const deliveries = envelope.payload.events?.length
            ? envelope.payload.events.map(
                  (event, batchIndex): TwitchDelivery => ({
                      envelope,
                      subscription: envelope.payload.subscription,
                      event,
                      batchIndex,
                  }),
              )
            : [
                  {
                      envelope,
                      subscription: envelope.payload.subscription,
                      event: envelope.payload.event,
                  },
              ];
        if (!this.shouldDeliver(deliveries[0])) {
            return { accepted: false, duplicate: false, filtered: true, deliveries };
        }
        const accepted = await this.ingress.deliver(envelope.metadata.message_id, async () => {
            for (const delivery of deliveries) {
                if (envelope.metadata.message_type === "revocation") {
                    await emitAllAwaited(this, "revocation", delivery);
                }
                await emitAllAwaited(this, "event", delivery);
            }
        });
        return { accepted, duplicate: !accepted, filtered: false, deliveries };
    }

    /** 将现有 Host 已建立的 EventSub socket 交给同一 Client。 */
    acceptSocket(
        socket: WebSocket,
        options?: TwitchSocketAttachOptions,
        signal?: AbortSignal,
    ): Promise<TwitchEventSubSession> {
        return this.eventsub.acceptSocket(socket, options, signal);
    }

    /** 将现有 Fetch/Koa/Workers Host 的 Request 交给签名 Webhook 边界。 */
    acceptHttp(request: Request): Promise<Response> {
        return this.webhook.acceptHttp(request);
    }

    private async initialize(generation: number, signal: AbortSignal): Promise<void> {
        try {
            const token = await validateTwitchToken(this.config, this.dependencies.fetcher, signal);
            this.assertTokenType(token);
            const identityId =
                this.receiveMode === "websocket"
                    ? token.user_id
                    : this.config.bot_user_id || this.config.broadcaster_user_id;
            if (!identityId) {
                throw new TwitchError("Twitch 令牌缺少可用用户身份", {
                    code: "TWITCH_TOKEN_USER_MISSING",
                });
            }
            const user = (await this.getUsers({ ids: [identityId] }))[0];
            if (!user) {
                throw new TwitchError(`Twitch 用户 ${identityId} 不存在`, {
                    code: "TWITCH_USER_NOT_FOUND",
                });
            }
            this.assertCurrent(generation, signal);
            this.currentToken = token;
            this.setCurrentUser(user);
            if (this.receiveMode === "websocket") {
                const session = await this.eventsub.start(signal);
                await this.ensureSubscriptions(session);
                await emitAllAwaited(this, "connected", session, false);
            } else if (this.receiveMode === "webhook" && this.config.auto_subscribe !== false) {
                await this.ensureSubscriptions();
            }
            this.assertCurrent(generation, signal);
            this.started = true;
            await emitAllAwaited(this, "ready", user);
        } catch (error) {
            this.setCurrentUser(undefined);
            this.currentToken = undefined;
            this.started = false;
            await this.eventsub.stop();
            throw TwitchError.wrap(error, "Twitch Client 启动失败", "TWITCH_START_FAILED");
        }
    }

    private async onConnected(session: TwitchEventSubSession, resumed: boolean): Promise<void> {
        // 初次连接由 initialize() 在订阅完成后发布；这里只处理运行期迁移与断线恢复。
        if (!this.started) return;
        try {
            if (!resumed) {
                this.subscribedSessions.clear();
                await this.ensureSubscriptions(session);
            }
            await emitAllAwaited(this, "connected", session, resumed);
        } catch (error) {
            this.reportError(
                TwitchError.wrap(
                    error,
                    "Twitch EventSub 订阅恢复失败",
                    "TWITCH_SUBSCRIPTION_RESTORE_FAILED",
                ),
            );
        }
    }

    private async ensureSubscriptions(session?: TwitchEventSubSession): Promise<void> {
        if (this.config.auto_subscribe === false || this.receiveMode === "manual") return;
        const key = session?.id || `webhook:${this.config.webhook_callback_url}`;
        if (this.subscribedSessions.has(key)) return;
        for (const subscription of expandSubscriptions(this.config)) {
            const transport = session
                ? { method: "websocket", session_id: session.id }
                : {
                      method: "webhook",
                      callback: this.config.webhook_callback_url,
                      secret: this.config.webhook_secret,
                  };
            try {
                await this.createEventSubSubscription({ ...subscription, transport });
            } catch (error) {
                if (!(error instanceof TwitchError) || error.status !== 409) throw error;
            }
        }
        this.subscribedSessions.add(key);
    }

    private async consumeSocketMessage(message: TwitchEventSubMessage): Promise<void> {
        if (
            ["notification", "revocation", "session_keepalive"].includes(
                message.metadata.message_type,
            )
        ) {
            try {
                await this.ingest(message);
            } catch (error) {
                this.reportError(
                    TwitchError.wrap(
                        error,
                        "Twitch EventSub 投递失败",
                        "TWITCH_EVENT_DELIVERY_FAILED",
                    ),
                );
            }
        }
    }

    private shouldDeliver(delivery: TwitchDelivery): boolean {
        const type = delivery.subscription?.type || delivery.envelope.metadata.subscription_type;
        const configured = this.config.subscriptions?.map(item => item.type);
        return !type || !configured?.length || configured.includes(type);
    }

    private assertCurrent(generation: number, signal: AbortSignal): void {
        if (generation !== this.generation) {
            throw new TwitchError("Twitch Client 启动已取消", {
                code: "TWITCH_START_CANCELLED",
            });
        }
        signal.throwIfAborted();
    }

    private assertTokenType(token: TwitchTokenInfo): void {
        if (this.receiveMode === "websocket" && !token.user_id) {
            throw new TwitchError("EventSub WebSocket 必须使用用户访问令牌", {
                code: "TWITCH_WEBSOCKET_USER_TOKEN_REQUIRED",
            });
        }
        if (
            this.receiveMode === "webhook" &&
            this.config.auto_subscribe !== false &&
            token.user_id
        ) {
            throw new TwitchError("EventSub Webhook 自动订阅必须使用应用访问令牌", {
                code: "TWITCH_WEBHOOK_APP_TOKEN_REQUIRED",
            });
        }
        if (
            this.receiveMode === "websocket" &&
            this.config.bot_user_id &&
            token.user_id !== this.config.bot_user_id
        ) {
            throw new TwitchError(
                `access_token 用户 ${token.user_id} 与 bot_user_id ${this.config.bot_user_id} 不一致`,
                { code: "TWITCH_BOT_ID_MISMATCH" },
            );
        }
    }

    private bindExternalSignal(signal: AbortSignal | undefined, controller: AbortController): void {
        this.unbindExternalSignal();
        if (!signal) return;
        const abort = (): void => {
            controller.abort(signal.reason);
            void this.stop().catch(error =>
                this.reportError(TwitchError.wrap(error, "Twitch Client 停止失败")),
            );
        };
        this.externalSignal = signal;
        this.externalAbort = abort;
        signal.addEventListener("abort", abort, { once: true });
    }

    private unbindExternalSignal(): void {
        if (this.externalSignal && this.externalAbort) {
            this.externalSignal.removeEventListener("abort", this.externalAbort);
        }
        this.externalSignal = undefined;
        this.externalAbort = undefined;
    }

    private reportError(error: Error): void {
        this.dependencies.reportError?.(error);
        void emitAllAwaited(this, "error", error).catch(() => undefined);
    }
}
