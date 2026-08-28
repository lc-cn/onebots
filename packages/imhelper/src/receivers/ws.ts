import WebSocket from "ws";
import { Receiver, type ReceiverLogger } from "../receiver.js";
import type { Adapter } from "../adapter.js";

export interface WebSocketLike {
    on(event: "open", listener: () => void): unknown;
    on(event: "message", listener: (data: Buffer) => void): unknown;
    on(event: "error", listener: (error: Error) => void): unknown;
    on(event: "close", listener: (code: number, reason: Buffer) => void): unknown;
    removeAllListeners(event?: string): unknown;
    send(data: string | Buffer): unknown;
    close(): void;
}

/** @deprecated 请使用通用的 ReceiverLogger。 */
export type WebSocketReceiverLogger = ReceiverLogger;

export interface WebSocketReconnectOptions {
    /** 默认无限重试。 */
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
    delay?: (attempt: number) => number;
}

export interface WebSocketReceiverOptions {
    accessToken?: string;
    signal?: AbortSignal;
    reconnect?: WebSocketReconnectOptions;
    logger?: WebSocketReceiverLogger;
    createWebSocket?: (url: string) => WebSocketLike;
    /** 每次连接建立后执行协议握手，例如发送 Satori IDENTIFY。 */
    onOpen?: (socket: WebSocketLike) => void;
}

function abortError(): Error {
    const error = new Error("WebSocket 连接已取消");
    error.name = "AbortError";
    return error;
}

export class WebSocketReceiver<
    Id extends string | number = string | number,
    TRawEvent = unknown,
> extends Receiver<Id, TRawEvent> {
    #socket?: WebSocketLike;
    #reconnectTimer?: NodeJS.Timeout;
    #reconnectAttempts = 0;
    #generation = 0;
    #stopped = true;
    readonly #options: WebSocketReceiverOptions;
    readonly #abortListener = (): void => {
        void this.disconnect();
    };

    constructor(
        adapter: Adapter<Id, TRawEvent>,
        public readonly url: string,
        accessTokenOrOptions?: string | WebSocketReceiverOptions,
    ) {
        const options =
            typeof accessTokenOrOptions === "string"
                ? { accessToken: accessTokenOrOptions }
                : (accessTokenOrOptions ?? {});
        super(adapter, options.logger);
        this.#options = options;
    }

    get generation(): number {
        return this.#generation;
    }

    async connect(_port?: number): Promise<void> {
        if (this.#options.signal?.aborted) throw abortError();
        this.#stopped = false;
        this.#options.signal?.addEventListener("abort", this.#abortListener, { once: true });
        return this.#openConnection();
    }

    async disconnect(): Promise<void> {
        this.#stopped = true;
        this.#generation += 1;
        this.#options.signal?.removeEventListener("abort", this.#abortListener);
        if (this.#reconnectTimer) {
            clearTimeout(this.#reconnectTimer);
            this.#reconnectTimer = undefined;
        }
        const socket = this.#socket;
        this.#socket = undefined;
        if (socket) {
            socket.removeAllListeners();
            socket.close();
        }
    }

    #openConnection(): Promise<void> {
        const generation = ++this.#generation;
        const url = new URL(this.url);
        if (this.#options.accessToken) {
            url.searchParams.set("access_token", this.#options.accessToken);
        }
        const logUrl = new URL(url);
        if (logUrl.searchParams.has("access_token")) {
            logUrl.searchParams.set("access_token", "***");
        }
        this.logger.debug("正在连接 WebSocket", { url: logUrl.toString(), generation });

        return new Promise((resolve, reject) => {
            let opened = false;
            let socket: WebSocketLike;
            try {
                socket = (this.#options.createWebSocket ?? (value => new WebSocket(value)))(
                    url.toString(),
                );
            } catch (error) {
                this.#scheduleReconnect(generation);
                reject(error);
                return;
            }
            this.#socket = socket;

            socket.on("open", () => {
                if (!this.#isCurrent(generation)) return;
                try {
                    this.#options.onOpen?.(socket);
                    opened = true;
                    this.#reconnectAttempts = 0;
                    this.logger.debug("WebSocket 已连接", { generation });
                    resolve();
                } catch (error) {
                    this.logger.error("WebSocket 协议握手失败", error);
                    socket.close();
                    reject(error);
                }
            });
            socket.on("message", data => {
                if (!this.#isCurrent(generation)) return;
                try {
                    this.ingestPayload(data);
                } catch (error) {
                    this.logger.error("解析 WebSocket 事件失败", error);
                }
            });
            socket.on("error", error => {
                if (!this.#isCurrent(generation)) return;
                this.logger.error("WebSocket 连接错误", error);
                this.#scheduleReconnect(generation);
                if (!opened) reject(error);
            });
            socket.on("close", (code, reason) => {
                if (!this.#isCurrent(generation)) return;
                this.logger.debug("WebSocket 已关闭", {
                    code,
                    reason: reason.toString(),
                    generation,
                });
                this.#scheduleReconnect(generation);
            });
        });
    }

    #isCurrent(generation: number): boolean {
        return !this.#stopped && !this.#options.signal?.aborted && generation === this.#generation;
    }

    #scheduleReconnect(generation: number): void {
        if (!this.#isCurrent(generation) || this.#reconnectTimer) return;
        const reconnect = this.#options.reconnect ?? {};
        const maxAttempts = reconnect.maxAttempts ?? Number.POSITIVE_INFINITY;
        if (this.#reconnectAttempts >= maxAttempts) {
            this.logger.error("WebSocket 已达到配置的最大重连次数");
            return;
        }
        const attempt = this.#reconnectAttempts;
        const delay = reconnect.delay
            ? reconnect.delay(attempt)
            : Math.min(
                  (reconnect.initialDelayMs ?? 1_000) * Math.pow(reconnect.factor ?? 2, attempt),
                  reconnect.maxDelayMs ?? 30_000,
              );
        this.#reconnectAttempts += 1;
        this.logger.debug("WebSocket 等待重连", { attempt: attempt + 1, delay, generation });
        this.#reconnectTimer = setTimeout(
            () => {
                this.#reconnectTimer = undefined;
                if (!this.#isCurrent(generation)) return;
                void this.#openConnection().catch(error => {
                    this.logger.error("WebSocket 重连失败", error);
                });
            },
            Math.max(0, delay),
        );
    }
}
