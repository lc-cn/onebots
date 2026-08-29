import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import type { Next, RouterContext } from "onebots";
import type { KookBotEvents } from "./bot-events.js";
import { assertKookConfig } from "./config.js";
import { KookError } from "./errors.js";
import { KookGatewaySequence } from "./gateway-sequence.js";
import { KookRestClient, type KookBinaryResult } from "./rest-client.js";
import type {
    KookApiRequestOptions,
    KookConfig,
    KookEvent,
    KookHello,
    KookMessageResult,
    KookSendMessage,
    KookSignal,
    KookUser,
} from "./types.js";
import { parseEvent, parseSignal } from "./utils.js";
import { KookWebhookReceiver, type KookIngestResult } from "./webhook.js";

export type { KookBotEvents } from "./bot-events.js";

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
    private readonly gatewaySequence = new KookGatewaySequence();
    private sessionId = "";
    private me: KookUser | null = null;
    private readonly webhook: KookWebhookReceiver;
    private readonly rest: KookRestClient;
    private readonly messageContexts = new Map<
        string,
        { scene: "channel" | "direct"; targetId?: string; chatCode?: string }
    >();

    constructor(readonly config: KookConfig) {
        super();
        assertKookConfig(config);
        this.webhook = new KookWebhookReceiver(config);
        this.rest = new KookRestClient(config);
    }

    get receiveMode(): "gateway" | "webhook" | "manual" {
        return this.config.receive_mode || "gateway";
    }

    async start(): Promise<void> {
        if (!this.stopped) return;
        this.stopped = false;
        this.generation++;
        try {
            await this.establish(this.generation);
        } catch (error) {
            this.scheduleReconnect(this.generation);
            throw error;
        }
    }

    async stop(): Promise<void> {
        this.stopped = true;
        this.generation++;
        this.clearTimers();
        this.me = null;
        const socket = this.socket;
        this.socket = undefined;
        if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "OneBots stopped");
        this.emit("stopped");
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
        if (!messageId) return;
        this.messageContexts.delete(messageId);
        this.messageContexts.set(messageId, { scene, targetId, chatCode });
        if (this.messageContexts.size > 4_096) {
            const oldest = this.messageContexts.keys().next().value;
            if (typeof oldest === "string") this.messageContexts.delete(oldest);
        }
    }

    getMessageScene(messageId: string): "channel" | "direct" | undefined {
        return this.messageContexts.get(messageId)?.scene;
    }

    getMessageContext(
        messageId: string,
    ): { scene: "channel" | "direct"; targetId?: string; chatCode?: string } | undefined {
        return this.messageContexts.get(messageId);
    }

    private async establish(generation: number): Promise<void> {
        if (this.stopped || generation !== this.generation) return;
        if (!this.me) this.me = await this.callApi<KookUser>("/v3/user/me");
        if (this.stopped || generation !== this.generation) return;
        if (this.receiveMode === "gateway") await this.connect(generation);
        else this.emit("ready");
    }

    private async connect(generation: number): Promise<void> {
        if (this.stopped || generation !== this.generation) return;
        this.clearSocketTimers();
        const gateway = await this.callApi<{ url: string }>("/v3/gateway/index", {
            query: { compress: 0 },
        });
        if (this.stopped || generation !== this.generation) return;
        const url = new URL(gateway.url);
        if (this.sessionId) {
            url.searchParams.set("resume", "1");
            url.searchParams.set("sn", String(this.gatewaySequence.sn));
            url.searchParams.set("session_id", this.sessionId);
        }
        const socket = new WebSocket(url);
        this.socket = socket;
        try {
            await this.waitForHello(socket, generation);
            if (generation !== this.generation || this.stopped) return;
            this.reconnectAttempt = 0;
            this.armPing(socket, generation);
            this.emit("ready");
        } catch (error) {
            if (this.socket === socket) this.socket = undefined;
            socket.removeAllListeners();
            if (socket.readyState < WebSocket.CLOSING) socket.close();
            this.scheduleReconnect(generation);
            throw error;
        }
    }

    private waitForHello(socket: WebSocket, generation: number): Promise<void> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const settle = (error?: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(helloTimer);
                if (error) reject(error);
                else resolve();
            };
            const helloTimer = setTimeout(
                () => settle(new Error("等待 KOOK Gateway HELLO 超时")),
                HELLO_TIMEOUT,
            );
            socket.on("message", raw => {
                try {
                    const signal = parseSignal(JSON.parse(raw.toString()) as unknown);
                    if (signal.s === 1) {
                        const hello = signal.d as KookHello;
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
                    } else {
                        this.handleSignal(signal, socket, generation);
                    }
                } catch (error) {
                    this.emit("error", error);
                }
            });
            socket.once("error", error => settle(error));
            socket.once("close", (code, reason) => {
                settle(new Error(`KOOK Gateway 在握手时关闭: ${code} ${reason.toString()}`));
                this.handleClose(socket, generation);
            });
            socket.once("open", () => this.emit("debug", "KOOK Gateway 已建立 TCP 连接"));
        });
    }

    private handleSignal(signal: KookSignal, socket: WebSocket, generation: number): void {
        if (signal.s === 0 && signal.d) {
            this.ingestGatewaySignal(signal);
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
        socket.on("error", error => this.emit("error", error));
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
            void this.establish(generation).catch(error => {
                this.emit("error", error);
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

    private resetGatewaySession(): void {
        this.gatewaySequence.reset();
        this.sessionId = "";
    }

    async handleWebhook(ctx: RouterContext, _next: Next): Promise<void> {
        try {
            const result = this.ingest(ctx.request.body, "webhook");
            ctx.status = result.status;
            ctx.body = result.body;
        } catch (error) {
            this.emit("error", error);
            ctx.status = 400;
            const wrapped = KookError.wrap(error, "KOOK_WEBHOOK_INVALID");
            ctx.body = { error: wrapped.message, code: wrapped.code };
        }
    }

    /** 将既有 Webhook、反向 WS 或消息队列事件交给当前 Bot。 */
    ingest(
        rawEvent: unknown,
        transport: "gateway" | "webhook" = this.receiveMode === "webhook" ? "webhook" : "gateway",
    ): KookIngestResult {
        if (transport === "gateway") {
            const signal = parseSignal(rawEvent);
            if (signal.s !== 0 || !signal.d) {
                throw KookError.invalid(
                    "KOOK 手动 Gateway 接入只接受事件信令",
                    "KOOK_MANUAL_SIGNAL_INVALID",
                    { signal: signal.s },
                );
            }
            return this.ingestGatewaySignal(signal);
        }
        const result = this.webhook.ingest(rawEvent);
        if (result.event && result.signal) this.emit("event", result.event, result.signal);
        return result;
    }

    /** 上游已有连接进入全新 session 时重置手动接入的 sn 状态。 */
    resetIngest(): void {
        this.resetGatewaySession();
    }

    /** 接入 Fetch/标准 Request 风格的既有 HTTP Host。 */
    async acceptHttp(request: Request): Promise<Response> {
        if (request.method !== "POST") return this.webhook.acceptHttp(request);
        try {
            const raw = (await request.json()) as unknown;
            const result = this.ingest(raw, "webhook");
            return Response.json(result.body, { status: result.status });
        } catch (error) {
            const wrapped = KookError.wrap(error, "KOOK_WEBHOOK_INVALID");
            return Response.json({ error: wrapped.message, code: wrapped.code }, { status: 400 });
        }
    }

    private ingestGatewaySignal(signal: KookSignal): KookIngestResult {
        const sequenced = this.gatewaySequence.ingest(signal);
        const events: KookEvent[] = [];
        for (const ready of sequenced.ready) {
            const event = parseEvent(ready.d);
            events.push(event);
            this.emit("event", event, ready);
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

    async callApi<T = unknown>(path: string, options: KookApiRequestOptions = {}): Promise<T> {
        return this.rest.call(path, options);
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
