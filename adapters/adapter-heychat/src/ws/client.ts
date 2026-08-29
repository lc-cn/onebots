import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { createProxyAgent, ErrorCategory } from "onebots";
import { HeychatApiError } from "../errors.js";
import type { HeychatConfig, HeychatWsEnvelope } from "../types.js";

const DEFAULT_WS_URL = "wss://chat.xiaoheihe.cn/chatroom/ws/connect";
const DEFAULT_CHAT_VERSION = "1.30.0";
const DEFAULT_HEARTBEAT_INTERVAL = 30_000;
const DEFAULT_RECONNECT_INITIAL_DELAY = 1_000;
const DEFAULT_RECONNECT_MAX_DELAY = 30_000;

export interface HeychatWsClientEvents {
    ready: [];
    disconnected: [details: { code: number; reason: string }];
    reconnecting: [details: { attempt: number; delay: number }];
    error: [error: HeychatApiError];
    event: [event: HeychatWsEnvelope];
}

/** 可复现的指数退避；实际连接使用 ±20% 抖动避免实例同步重连。 */
export function calculateHeychatReconnectDelay(
    attempt: number,
    initialDelay: number,
    maxDelay: number,
    random = Math.random,
): number {
    const base = Math.min(maxDelay, initialDelay * 2 ** Math.max(0, attempt - 1));
    return Math.max(0, Math.round(base * (0.8 + random() * 0.4)));
}

/** 正向 WebSocket 客户端；无限重连，并用 generation 隔离过期 socket 回调。 */
export class HeychatWsClient extends EventEmitter<HeychatWsClientEvents> {
    private ws: WebSocket | null = null;
    private pendingWs: WebSocket | null = null;
    private readonly token: string;
    private readonly wsUrl: string;
    private readonly chatVersion: string;
    private readonly heartbeatIntervalMs: number;
    private readonly reconnectInitialDelayMs: number;
    private readonly reconnectMaxDelayMs: number;
    private readonly proxy?: HeychatConfig["proxy"];
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private lastSequence = 0;
    private reconnectAttempt = 0;
    private generation = 0;
    private closed = true;
    private awaitingPong = false;

    constructor(config: HeychatConfig) {
        super();
        this.token = config.token;
        this.wsUrl = validateWsUrl(config.ws_url || DEFAULT_WS_URL);
        this.chatVersion = config.chat_version || DEFAULT_CHAT_VERSION;
        this.heartbeatIntervalMs = Math.max(
            5_000,
            config.heartbeat_interval_ms || DEFAULT_HEARTBEAT_INTERVAL,
        );
        this.reconnectInitialDelayMs = Math.max(
            100,
            config.reconnect_initial_delay_ms || DEFAULT_RECONNECT_INITIAL_DELAY,
        );
        this.reconnectMaxDelayMs = Math.max(
            this.reconnectInitialDelayMs,
            config.reconnect_max_delay_ms || DEFAULT_RECONNECT_MAX_DELAY,
        );
        this.proxy = config.proxy;
    }

    async connect(): Promise<void> {
        if (!this.closed) return;
        this.closed = false;
        await this.connectGeneration();
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.generation += 1;
        this.stopHeartbeat();
        this.clearReconnect();
        this.disposeSocket();
    }

    isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    private async connectGeneration(): Promise<void> {
        if (this.closed) return;
        const generation = ++this.generation;
        try {
            const ws = await this.openSocket(generation);
            if (this.closed || generation !== this.generation) {
                ws.terminate();
                return;
            }
            this.attachSocket(ws, generation);
            this.reconnectAttempt = 0;
            this.awaitingPong = false;
            this.startHeartbeat(generation);
            this.emit("ready");
        } catch (error) {
            if (this.closed || generation !== this.generation) return;
            const wrapped = HeychatApiError.wrap(
                error,
                "HEYCHAT_WS_CONNECT_ERROR",
                ErrorCategory.NETWORK,
            );
            this.emit("error", wrapped);
            this.scheduleReconnect();
        }
    }

    private async openSocket(generation: number): Promise<WebSocket> {
        const options: WebSocket.ClientOptions = {
            headers: { Accept: "application/json, text/plain, */*" },
        };
        if (this.proxy?.url) {
            const agent = await createProxyAgent(this.proxy, true);
            if (agent) options.agent = agent as WebSocket.ClientOptions["agent"];
        }

        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.buildConnectUrl(), options);
            this.pendingWs = ws;
            const onError = (error: Error): void => {
                ws.removeListener("open", onOpen);
                ws.removeListener("close", onClose);
                if (this.pendingWs === ws) this.pendingWs = null;
                ws.terminate();
                reject(error);
            };
            const onClose = (code: number): void => {
                ws.removeListener("open", onOpen);
                ws.removeListener("error", onError);
                if (this.pendingWs === ws) this.pendingWs = null;
                reject(new Error(`WebSocket 在握手完成前关闭（${code}）`));
            };
            const onOpen = (): void => {
                ws.removeListener("error", onError);
                ws.removeListener("close", onClose);
                if (this.pendingWs === ws) this.pendingWs = null;
                if (generation !== this.generation || this.closed) {
                    ws.terminate();
                    reject(new Error("连接已被更新的 generation 取代"));
                    return;
                }
                resolve(ws);
            };
            ws.once("error", onError);
            ws.once("close", onClose);
            ws.once("open", onOpen);
        });
    }

    private attachSocket(ws: WebSocket, generation: number): void {
        this.disposeSocket();
        this.ws = ws;
        // Heychat 没有跨连接 resume 游标；新连接的 sequence 从独立代次重新计数。
        this.lastSequence = 0;
        ws.on("message", raw => this.handleMessage(raw.toString()));
        ws.on("ping", data => ws.pong(data));
        ws.on("pong", () => {
            this.awaitingPong = false;
        });
        ws.on("error", error => {
            this.emit(
                "error",
                HeychatApiError.wrap(error, "HEYCHAT_WS_ERROR", ErrorCategory.NETWORK),
            );
        });
        ws.once("close", (code, reason) => {
            if (generation !== this.generation) return;
            this.ws = null;
            this.stopHeartbeat();
            this.emit("disconnected", { code, reason: reason.toString() });
            if (!this.closed) this.scheduleReconnect();
        });
    }

    private handleMessage(raw: string): void {
        if (/^pong$/iu.test(raw.trim()) || raw.startsWith("PONG")) {
            this.awaitingPong = false;
            return;
        }
        let value: unknown;
        try {
            value = JSON.parse(raw) as unknown;
        } catch (error) {
            this.emit(
                "error",
                new HeychatApiError("WebSocket 推送不是有效 JSON", {
                    code: "HEYCHAT_INVALID_WS_EVENT",
                    category: ErrorCategory.PROTOCOL,
                    details: raw.slice(0, 500),
                    cause: error,
                }),
            );
            return;
        }
        if (!isEnvelope(value)) {
            this.emit(
                "error",
                new HeychatApiError("WebSocket 推送结构无效", {
                    code: "HEYCHAT_INVALID_WS_EVENT",
                    category: ErrorCategory.PROTOCOL,
                    details: value,
                }),
            );
            return;
        }
        if (value.sequence <= this.lastSequence) return;
        this.lastSequence = value.sequence;
        this.emit("event", value);
    }

    private startHeartbeat(generation: number): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (generation !== this.generation || !this.ws) return;
            if (this.ws.readyState !== WebSocket.OPEN) return;
            if (this.awaitingPong) {
                this.ws.terminate();
                return;
            }
            this.awaitingPong = true;
            this.ws.ping(Buffer.from("PING"));
        }, this.heartbeatIntervalMs);
    }

    private scheduleReconnect(): void {
        if (this.closed || this.reconnectTimer) return;
        this.reconnectAttempt += 1;
        const delay = calculateHeychatReconnectDelay(
            this.reconnectAttempt,
            this.reconnectInitialDelayMs,
            this.reconnectMaxDelayMs,
        );
        this.emit("reconnecting", { attempt: this.reconnectAttempt, delay });
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connectGeneration();
        }, delay);
    }

    private buildConnectUrl(): string {
        const url = new URL(this.wsUrl);
        url.searchParams.set("chat_os_type", "bot");
        url.searchParams.set("client_type", "heybox_chat");
        url.searchParams.set("chat_version", this.chatVersion);
        url.searchParams.set("token", this.token);
        return url.toString();
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
        this.awaitingPong = false;
    }

    private clearReconnect(): void {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    private disposeSocket(): void {
        if (this.pendingWs) {
            this.pendingWs.removeAllListeners();
            this.pendingWs.terminate();
            this.pendingWs = null;
        }
        if (!this.ws) return;
        this.ws.removeAllListeners();
        this.ws.terminate();
        this.ws = null;
    }
}

function isEnvelope(value: unknown): value is HeychatWsEnvelope {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (
        typeof record.sequence === "number" &&
        typeof record.type === "string" &&
        typeof record.timestamp === "number" &&
        Boolean(record.data) &&
        typeof record.data === "object" &&
        !Array.isArray(record.data)
    );
}

function validateWsUrl(value: string): string {
    if (!URL.canParse(value)) {
        throw new HeychatApiError("ws_url 必须是有效的 ws:// 或 wss:// URL", {
            code: "HEYCHAT_INVALID_CONFIG_URL",
            category: ErrorCategory.CONFIG,
            details: value,
        });
    }
    const url = new URL(value);
    if (
        !["ws:", "wss:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol === "ws:" && !isLoopback(url.hostname))
    ) {
        throw new HeychatApiError(
            "ws_url 必须是无凭据、查询参数或片段的 wss:// URL（本机测试可用 ws://）",
            {
                code: "HEYCHAT_INVALID_CONFIG_URL",
                category: ErrorCategory.CONFIG,
                details: value,
            },
        );
    }
    return url.toString();
}

function isLoopback(hostname: string): boolean {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
