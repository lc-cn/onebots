import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import type { Next, RouterContext } from "onebots";
import type {
    KookApiEnvelope,
    KookApiRequestOptions,
    KookConfig,
    KookHello,
    KookMessageResult,
    KookSendMessage,
    KookSignal,
    KookUser,
} from "./types.js";
import {
    decryptWebhookMessage,
    objectValue,
    parseEvent,
    parseSignal,
    stringValue,
} from "./utils.js";

const DEFAULT_API_BASE = "https://www.kookapp.cn/api";
const HELLO_TIMEOUT = 6_000;
const PONG_TIMEOUT = 10_000;
const MAX_RECONNECT_DELAY = 60_000;

export class KookApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code?: number,
        readonly path?: string,
    ) {
        super(message);
        this.name = "KookApiError";
    }
}

/** KOOK 官方 REST、Gateway 与 Webhook 的统一底层客户端。 */
export class KookBot extends EventEmitter {
    private socket?: WebSocket;
    private reconnectTimer?: NodeJS.Timeout;
    private pingTimer?: NodeJS.Timeout;
    private pongTimer?: NodeJS.Timeout;
    private generation = 0;
    private reconnectAttempt = 0;
    private stopped = true;
    private sn = 0;
    private sessionId = "";
    private me: KookUser | null = null;
    private readonly webhookSequences = new Set<number>();
    private readonly messageContexts = new Map<
        string,
        { scene: "channel" | "direct"; targetId?: string; chatCode?: string }
    >();

    constructor(readonly config: KookConfig) {
        super();
    }

    get receiveMode(): "gateway" | "webhook" {
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
        if (this.sessionId && this.sn) {
            url.searchParams.set("resume", "1");
            url.searchParams.set("sn", String(this.sn));
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
                            settle(new Error(`KOOK Gateway HELLO 失败: ${hello.code}`));
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
        if (typeof signal.sn === "number") this.sn = Math.max(this.sn, signal.sn);
        if (signal.s === 0 && signal.d) {
            const event = parseEvent(signal.d);
            this.emit("event", event, signal);
            return;
        }
        if (signal.s === 3) {
            if (this.pongTimer) clearTimeout(this.pongTimer);
            this.pongTimer = undefined;
            return;
        }
        if (signal.s === 5) {
            this.sn = 0;
            this.sessionId = "";
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
            socket.send(JSON.stringify({ s: 2, sn: this.sn }));
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

    async handleWebhook(ctx: RouterContext, _next: Next): Promise<void> {
        try {
            const incoming = objectValue(ctx.request.body);
            const encrypted = stringValue(incoming.encrypt);
            const payload = encrypted
                ? objectValue(
                      JSON.parse(decryptWebhookMessage(encrypted, this.config.encrypt_key || "")),
                  )
                : incoming;
            const signal = parseSignal(payload);
            const event = parseEvent(signal.d);
            if (this.config.verify_token && event.verify_token !== this.config.verify_token) {
                ctx.status = 401;
                ctx.body = { error: "Invalid verify_token" };
                return;
            }
            if (event.channel_type === "WEBHOOK_CHALLENGE") {
                ctx.body = { challenge: event.challenge || "" };
                return;
            }
            if (typeof signal.sn === "number" && this.rememberWebhookSequence(signal.sn)) {
                ctx.body = { success: true, duplicate: true };
                return;
            }
            this.emit("event", event, signal);
            ctx.body = { success: true };
        } catch (error) {
            this.emit("error", error);
            ctx.status = 400;
            ctx.body = { error: error instanceof Error ? error.message : "Invalid KOOK callback" };
        }
    }

    private rememberWebhookSequence(sn: number): boolean {
        if (this.webhookSequences.has(sn)) return true;
        this.webhookSequences.add(sn);
        if (this.webhookSequences.size > 2_048) {
            const oldest = this.webhookSequences.values().next().value;
            if (typeof oldest === "number") this.webhookSequences.delete(oldest);
        }
        return false;
    }

    async callApi<T = unknown>(path: string, options: KookApiRequestOptions = {}): Promise<T> {
        if (!path.startsWith("/v3/") || path.includes("..")) {
            throw new Error("KOOK API path 必须是 /v3/ 下的安全绝对路径");
        }
        const base = (this.config.api_base_url || DEFAULT_API_BASE).replace(/\/$/, "");
        const url = new URL(`${base}${path}`);
        for (const [key, value] of Object.entries(options.query || {})) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        const response = await fetch(url, {
            method: options.method || "GET",
            headers: {
                Authorization: `Bot ${this.config.token}`,
                Accept: "application/json",
                ...(options.body ? { "Content-Type": "application/json" } : {}),
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
        });
        const text = await response.text();
        let envelope: KookApiEnvelope<T>;
        try {
            envelope = JSON.parse(text) as KookApiEnvelope<T>;
        } catch {
            throw new KookApiError("KOOK API 返回了无效 JSON", response.status, undefined, path);
        }
        if (!response.ok || envelope.code !== 0) {
            throw new KookApiError(
                envelope.message || response.statusText || "KOOK API 调用失败",
                response.status,
                envelope.code,
                path,
            );
        }
        return envelope.data;
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
        const form = new FormData();
        const bytes = new Uint8Array(data);
        form.append("file", new Blob([bytes.buffer], { type: contentType }), filename);
        const base = (this.config.api_base_url || DEFAULT_API_BASE).replace(/\/$/, "");
        const response = await fetch(`${base}/v3/asset/create`, {
            method: "POST",
            headers: { Authorization: `Bot ${this.config.token}` },
            body: form,
        });
        const envelope = (await response.json()) as KookApiEnvelope<{ url: string }>;
        if (!response.ok || envelope.code !== 0 || !envelope.data?.url) {
            throw new KookApiError(
                envelope.message || "KOOK 素材上传失败",
                response.status,
                envelope.code,
                "/v3/asset/create",
            );
        }
        return envelope.data.url;
    }
}
