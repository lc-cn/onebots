/**
 * Slack Bot 客户端
 * 基于 @slack/web-api
 */
import { EventEmitter } from "node:events";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SocketModeClient } from "@slack/socket-mode";
import type { WebClient } from "@slack/web-api";
import { type Next, type RouterContext } from "onebots";
import { SlackError } from "./errors.js";
import { parseSlackInbound } from "./inbound.js";
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
} from "./types.js";

interface SocketModeEnvelope {
    ack(): Promise<void>;
    body?: SlackWebhookBody;
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
    private readonly receivedEventIds = new Map<string, number>();

    constructor(readonly config: SlackConfig) {
        super();
        this.api = new SlackWebApi(config.token);
    }

    get receiveMode(): "socket" | "webhook" {
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
                this.ingest(payload.body ?? { type: payload.type });
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
        if (this.receiveMode !== "socket" && this.receiveMode !== "webhook") {
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
        if (!this.config.signing_secret) {
            const error = SlackError.config(
                "Slack Webhook 模式必须配置 signing_secret",
                "SLACK_SIGNING_SECRET_REQUIRED",
            );
            this.emit("client_error", error);
            ctx.status = 503;
            ctx.body = { ok: false, error: error.code };
            return;
        }
        if (!this.verifyWebhookSignature(ctx)) {
            ctx.status = 401;
            ctx.body = { ok: false, error: "invalid_signature" };
            return;
        }
        let body: SlackWebhookBody;
        try {
            body = parseSlackInbound(ctx.request.body);
        } catch (error) {
            const wrapped = SlackError.wrap(error, "webhook", "SLACK_WEBHOOK_INVALID");
            this.emit("client_error", wrapped);
            ctx.status = 400;
            ctx.body = { ok: false, error: wrapped.code };
            return;
        }

        // 处理 URL 验证（Slack 首次配置 webhook 时会发送验证请求）
        if (body.type === "url_verification") {
            ctx.body = { challenge: body.challenge };
            return;
        }

        // 处理事件
        this.ingest(body);

        ctx.body = { ok: true };
        await next();
    }

    private verifyWebhookSignature(ctx: RouterContext): boolean {
        const timestamp = ctx.get("x-slack-request-timestamp");
        const signature = ctx.get("x-slack-signature");
        const rawBody = ctx.request.rawBody;
        if (!timestamp || !signature || typeof rawBody !== "string") return false;
        const timestampSeconds = Number(timestamp);
        if (
            !Number.isFinite(timestampSeconds) ||
            Math.abs(Date.now() / 1000 - timestampSeconds) > 300
        ) {
            return false;
        }
        const digest = `v0=${createHmac("sha256", this.config.signing_secret ?? "")
            .update(`v0:${timestamp}:${rawBody}`)
            .digest("hex")}`;
        const actual = Buffer.from(signature);
        const expected = Buffer.from(digest);
        return actual.length === expected.length && timingSafeEqual(actual, expected);
    }

    /** 将 HTTP Events 与 Socket Mode 归一到同一个原始事件入口。 */
    ingest(rawEvent: unknown): SlackWebhookBody {
        const body = parseSlackInbound(rawEvent);
        this.emit("raw_event", body);
        if (this.isDuplicateEvent(body)) return body;
        if (body.event) {
            this.emit("event", body.event, body);
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
        return body;
    }

    /** Slack 超时重试仍交付 raw_event，但不会重复派发 canonical 事件。 */
    private isDuplicateEvent(body: SlackWebhookBody): boolean {
        const eventId =
            typeof body.event_id === "string"
                ? body.event_id
                : typeof body.envelope_id === "string"
                  ? body.envelope_id
                  : undefined;
        if (!eventId) return false;
        const now = Date.now();
        const previous = this.receivedEventIds.get(eventId);
        this.receivedEventIds.delete(eventId);
        this.receivedEventIds.set(eventId, now);
        for (const [id, receivedAt] of this.receivedEventIds) {
            if (this.receivedEventIds.size <= 4_096 && now - receivedAt <= 10 * 60_000) break;
            this.receivedEventIds.delete(id);
        }
        return previous !== undefined && now - previous <= 10 * 60_000;
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
