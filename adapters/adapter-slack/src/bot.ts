/**
 * Slack Bot 客户端
 * 基于 @slack/web-api
 */
import { EventEmitter } from "node:events";
import { SocketModeClient } from "@slack/socket-mode";
import type { WebClient } from "@slack/web-api";
import { RecentEventDeduplicator, type Next, type RouterContext } from "onebots";
import { SlackError } from "./errors.js";
import { parseSlackHttpBody, parseSlackInbound, verifySlackSignature } from "./inbound.js";
import type { SlackFileInput } from "./messages.js";
import { SlackWebApi } from "./web-api.js";
import type {
    SlackConfig,
    SlackEvent,
    SlackUser,
    SlackChannel,
    SlackWebhookBody,
    SlackBlock,
    SlackMessageOptions,
    SlackChatResult,
    SlackHttpResult,
} from "./types.js";

interface SocketModeEnvelope {
    ack(): Promise<void>;
    body?: SlackWebhookBody;
    envelope_id?: string;
    type?: string;
}

function isSocketModeEnvelope(value: unknown): value is SocketModeEnvelope {
    return (
        typeof value === "object" &&
        value !== null &&
        "ack" in value &&
        typeof value.ack === "function"
    );
}

export interface SlackBotEvents {
    ready: [];
    stopped: [];
    raw_event: [rawEvent: SlackWebhookBody];
    event: [event: SlackEvent, rawEvent: SlackWebhookBody];
    client_error: [error: SlackError];
    transport_state: [state: "connected" | "reconnecting" | "disconnected"];
}

export class SlackBot extends EventEmitter<SlackBotEvents> {
    private readonly api: SlackWebApi;
    private socketClient?: SocketModeClient;
    private me: SlackUser | null = null;
    private startPromise?: Promise<void>;
    private running = false;
    private generation = 0;
    private readonly messageContexts = new Map<string, { channel: string; threadTs?: string }>();
    private readonly receivedEvents = new RecentEventDeduplicator<string>();

    constructor(readonly config: SlackConfig) {
        super();
        this.api = new SlackWebApi(config.token);
    }

    get receiveMode(): NonNullable<SlackConfig["receive_mode"]> {
        return this.config.receive_mode || "socket";
    }

    /**
     * 启动 Bot
     */
    async start(): Promise<void> {
        if (this.running) return;
        if (this.startPromise) return this.startPromise;
        const generation = this.generation;
        const start = this.startInternal(generation);
        this.startPromise = start;
        try {
            await start;
        } finally {
            if (this.startPromise === start) this.startPromise = undefined;
        }
    }

    /**
     * 停止 Bot
     */
    async stop(): Promise<void> {
        const wasActive = this.running || Boolean(this.startPromise || this.socketClient);
        this.generation += 1;
        this.running = false;
        this.startPromise = undefined;
        const socket = this.socketClient;
        this.socketClient = undefined;
        if (socket) {
            try {
                await socket.disconnect();
            } catch (error) {
                this.emit(
                    "client_error",
                    SlackError.wrap(error, "socket.disconnect", "SLACK_SOCKET_STOP_FAILED"),
                );
            }
        }
        if (wasActive) this.emit("stopped");
    }

    private async startInternal(generation: number): Promise<void> {
        try {
            this.validateReceiveConfig();
            const authTest = await this.api.getBotInfo();
            if (generation !== this.generation) return;
            this.me = authTest;
            if (this.receiveMode === "socket") await this.startSocket(generation);
            if (generation !== this.generation) return;
            this.running = true;
            this.emit("ready");
        } catch (error) {
            if (generation === this.generation) {
                const socket = this.socketClient;
                this.running = false;
                this.socketClient = undefined;
                if (socket) {
                    try {
                        await socket.disconnect();
                    } catch (disconnectError) {
                        this.emit(
                            "client_error",
                            SlackError.wrap(
                                disconnectError,
                                "socket.disconnect",
                                "SLACK_SOCKET_STOP_FAILED",
                            ),
                        );
                    }
                }
            }
            const wrapped = SlackError.wrap(error, "start", "SLACK_START_FAILED");
            this.emit("client_error", wrapped);
            throw wrapped;
        }
    }

    private async startSocket(generation: number): Promise<void> {
        const socket = new SocketModeClient({
            appToken: this.config.app_token || "",
            autoReconnectEnabled: true,
        });
        this.socketClient = socket;
        socket.on("slack_event", async (payload: unknown) => {
            if (!this.isCurrentSocket(socket, generation) || !isSocketModeEnvelope(payload)) return;
            try {
                await payload.ack();
                const body = payload.body ?? { type: payload.type };
                this.ingest(
                    payload.envelope_id && !body.envelope_id
                        ? { ...body, envelope_id: payload.envelope_id }
                        : body,
                );
            } catch (error) {
                this.emit(
                    "client_error",
                    SlackError.wrap(error, "socket.event", "SLACK_SOCKET_EVENT_FAILED"),
                );
            }
        });
        socket.on("error", error => {
            if (!this.isCurrentSocket(socket, generation)) return;
            this.emit("client_error", SlackError.wrap(error, "socket", "SLACK_SOCKET_ERROR"));
        });
        socket.on("connected", () => {
            if (this.isCurrentSocket(socket, generation)) this.emit("transport_state", "connected");
        });
        socket.on("reconnecting", () => {
            if (this.isCurrentSocket(socket, generation)) {
                this.emit("transport_state", "reconnecting");
            }
        });
        socket.on("disconnected", () => {
            if (this.isCurrentSocket(socket, generation)) {
                this.emit("transport_state", "disconnected");
            }
        });
        await socket.start();
        if (!this.isCurrentSocket(socket, generation)) await socket.disconnect();
    }

    private isCurrentSocket(socket: SocketModeClient, generation: number): boolean {
        return generation === this.generation && this.socketClient === socket;
    }

    private validateReceiveConfig(): void {
        if (!["socket", "webhook", "manual"].includes(this.receiveMode)) {
            throw SlackError.config(
                `Slack receive_mode 无效: ${String(this.config.receive_mode)}`,
                "SLACK_RECEIVE_MODE_INVALID",
            );
        }
        if (this.receiveMode === "socket" && !this.config.app_token) {
            throw SlackError.config(
                "Slack Socket Mode 必须配置 app_token",
                "SLACK_APP_TOKEN_REQUIRED",
            );
        }
        if (this.receiveMode === "webhook" && !this.config.signing_secret) {
            throw SlackError.config(
                "Slack Webhook 模式必须配置 signing_secret",
                "SLACK_SIGNING_SECRET_REQUIRED",
            );
        }
    }

    /**
     * 处理 Webhook 请求（Events API）
     */
    async handleWebhook(ctx: RouterContext, next: Next): Promise<void> {
        try {
            const rawBody = ctx.request.rawBody;
            if (typeof rawBody !== "string" && !Buffer.isBuffer(rawBody)) {
                throw new SlackError("Slack Webhook 必须保留未经修改的 rawBody", {
                    code: "SLACK_RAW_BODY_REQUIRED",
                    status: 400,
                });
            }
            const result = this.ingestHttp(rawBody, {
                timestamp: ctx.get("x-slack-request-timestamp"),
                signature: ctx.get("x-slack-signature"),
                contentType: ctx.get("content-type"),
            });
            ctx.status = result.status;
            ctx.body = result.body;
        } catch (error) {
            const wrapped = SlackError.wrap(error, "webhook", "SLACK_WEBHOOK_INVALID");
            this.emit("client_error", wrapped);
            ctx.status = wrapped.status || 500;
            ctx.body = { ok: false, error: wrapped.code };
            return;
        }
        await next();
    }

    /** 验证原始 HTTP 请求并汇入与 Socket Mode / manual 相同的 ingest 管线。 */
    ingestHttp(
        rawBody: string | Buffer,
        headers: { timestamp: string; signature: string; contentType?: string },
    ): SlackHttpResult {
        if (!this.config.signing_secret) {
            throw new SlackError("Slack Webhook 模式必须配置 signing_secret", {
                code: "SLACK_SIGNING_SECRET_REQUIRED",
                status: 503,
            });
        }
        if (
            !verifySlackSignature(
                this.config.signing_secret,
                rawBody,
                headers.timestamp,
                headers.signature,
            )
        ) {
            throw new SlackError("Slack Webhook 签名无效或已过期", {
                code: "SLACK_INVALID_SIGNATURE",
                status: 401,
            });
        }
        let body: SlackWebhookBody;
        try {
            body = parseSlackInbound(parseSlackHttpBody(rawBody, headers.contentType));
        } catch (error) {
            const wrapped = SlackError.wrap(error, "webhook", "SLACK_WEBHOOK_INVALID");
            throw new SlackError(wrapped.message, {
                code: wrapped.code,
                status: wrapped.status || 400,
                cause: wrapped,
            });
        }
        if (body.type === "url_verification") {
            if (typeof body.challenge !== "string" || !body.challenge) {
                throw new SlackError("Slack URL verification 缺少 challenge", {
                    code: "SLACK_CHALLENGE_REQUIRED",
                    status: 400,
                });
            }
            return { status: 200, body: { challenge: body.challenge } };
        }
        this.ingest(body);
        return { status: 200, body: { ok: true } };
    }

    /** Fetch / WinterCG Host 可直接转交标准 Request，无需复刻验签与表单解析。 */
    async acceptHttp(request: Request): Promise<Response> {
        if (request.method !== "POST") {
            return Response.json(
                { ok: false, error: "SLACK_METHOD_NOT_ALLOWED" },
                { status: 405, headers: { Allow: "POST" } },
            );
        }
        try {
            const result = this.ingestHttp(Buffer.from(await request.arrayBuffer()), {
                timestamp: request.headers.get("x-slack-request-timestamp") || "",
                signature: request.headers.get("x-slack-signature") || "",
                contentType: request.headers.get("content-type") || undefined,
            });
            return Response.json(result.body, { status: result.status });
        } catch (error) {
            const wrapped = SlackError.wrap(error, "webhook", "SLACK_WEBHOOK_INVALID");
            return Response.json(
                { ok: false, error: wrapped.code, message: wrapped.message },
                { status: wrapped.status || 500 },
            );
        }
    }

    /** 将 HTTP Events 与 Socket Mode 归一到同一个原始事件入口。 */
    ingest(rawEvent: unknown): SlackWebhookBody {
        const body = parseSlackInbound(rawEvent);
        this.emit("raw_event", body);
        if (this.hasProcessedEvent(body)) return body;
        if (body.event) {
            this.emit("event", body.event, body);
            this.markEventProcessed(body);
            return body;
        }
        const eventType =
            typeof body.command === "string"
                ? "slash_command"
                : body.type && body.type !== "event_callback"
                  ? body.type
                  : undefined;
        if (eventType) {
            this.emit(
                "event",
                {
                    ...body,
                    type: eventType,
                    event_ts: String(body.event_time ?? Date.now() / 1000),
                },
                body,
            );
        }
        this.markEventProcessed(body);
        return body;
    }

    /** Slack 超时重试仍交付 raw_event，但不会重复派发 canonical 事件。 */
    private hasProcessedEvent(body: SlackWebhookBody): boolean {
        const eventId = eventIdentity(body);
        return eventId ? this.receivedEvents.has(eventId) : false;
    }

    private markEventProcessed(body: SlackWebhookBody): void {
        const eventId = eventIdentity(body);
        if (eventId) this.receivedEvents.commit(eventId);
    }

    /**
     * 获取缓存的 Bot 信息
     */
    getCachedMe(): SlackUser | null {
        return this.me;
    }

    rememberMessage(ts: string, channel: string, threadTs?: string): void {
        if (!ts || !channel) return;
        this.messageContexts.delete(ts);
        this.messageContexts.set(ts, { channel, threadTs });
        if (this.messageContexts.size > 4_096) {
            const oldest = this.messageContexts.keys().next().value;
            if (typeof oldest === "string") this.messageContexts.delete(oldest);
        }
    }

    getMessageContext(ts: string): { channel: string; threadTs?: string } | undefined {
        return this.messageContexts.get(ts);
    }

    async getBotInfo(): Promise<SlackUser> {
        return this.api.getBotInfo();
    }

    async sendMessage(
        channel: string,
        text: string,
        options?: SlackMessageOptions,
    ): Promise<SlackChatResult> {
        return this.api.sendMessage(channel, text, options);
    }

    async sendBlocks(
        channel: string,
        blocks: SlackBlock[],
        text?: string,
    ): Promise<SlackChatResult> {
        return this.api.sendBlocks(channel, blocks, text);
    }

    async sendFiles(
        channel: string,
        files: SlackFileInput[],
        text: string,
        options: Pick<SlackMessageOptions, "thread_ts" | "blocks"> = {},
    ): Promise<SlackChatResult> {
        return this.api.sendFiles(channel, files, text, options);
    }

    async updateMessage(
        channel: string,
        ts: string,
        text: string,
        options?: SlackMessageOptions,
    ): Promise<SlackChatResult> {
        return this.api.updateMessage(channel, ts, text, options);
    }

    async deleteMessage(channel: string, ts: string): Promise<boolean> {
        return this.api.deleteMessage(channel, ts);
    }

    async getChannelInfo(channelId: string): Promise<SlackChannel> {
        return this.api.getChannelInfo(channelId);
    }

    async getChannelList(types?: string, excludeArchived?: boolean): Promise<SlackChannel[]> {
        return this.api.getChannelList(types, excludeArchived);
    }

    async getUserInfo(userId: string): Promise<SlackUser> {
        return this.api.getUserInfo(userId);
    }

    async getUserList(): Promise<SlackUser[]> {
        return this.api.getUserList();
    }

    async getChannelMembers(channelId: string): Promise<string[]> {
        return this.api.getChannelMembers(channelId);
    }

    async leaveChannel(channelId: string): Promise<boolean> {
        return this.api.leaveChannel(channelId);
    }

    async createChannel(name: string): Promise<SlackChannel> {
        return this.api.createChannel(name);
    }

    async kickChannelMember(channelId: string, userId: string): Promise<boolean> {
        return this.api.kickChannelMember(channelId, userId);
    }

    getWebClient(): WebClient {
        return this.api.rawClient;
    }

    async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        return this.api.call(method, params);
    }
}

function eventIdentity(body: SlackWebhookBody): string | undefined {
    return typeof body.event_id === "string"
        ? body.event_id
        : typeof body.envelope_id === "string"
          ? body.envelope_id
          : undefined;
}
