import { WebSocket, type ClientOptions, type RawData } from "ws";

interface ReverseWebSocketLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string, error?: unknown): void;
}

export interface ReverseWebSocketOptions {
    url: string;
    headers?: Record<string, string>;
    logger: ReverseWebSocketLogger;
    reconnectDelayMs?: number;
    onOpen?(): void;
    onMessage(data: RawData): void | Promise<void>;
    createSocket?(url: string, options: ClientOptions): WebSocket;
}

/**
 * 管理一条反向 WebSocket 的完整生命周期。
 *
 * 协议层只负责解释报文；该会话统一处理无限重连、旧连接隔离与停止清理，
 * 防止协议停止后被遗留定时器重新拉起。
 */
export class ReverseWebSocketSession {
    private socket?: WebSocket;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private generation = 0;
    private stopped = true;

    constructor(private readonly options: ReverseWebSocketOptions) {}

    start(): void {
        if (!this.stopped) return;
        this.stopped = false;
        this.generation++;
        this.connect(this.generation);
    }

    stop(): void {
        if (this.stopped) return;
        this.stopped = true;
        this.generation++;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;

        const socket = this.socket;
        this.socket = undefined;
        if (!socket) return;
        socket.removeAllListeners();
        // ws 在握手阶段关闭时会异步发出 error；保留空监听避免停止流程制造未处理异常。
        socket.on("error", () => undefined);
        if (socket.readyState < WebSocket.CLOSING) socket.close(1000, "OneBots stopped");
    }

    send(data: string): void {
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(data);
    }

    private connect(generation: number): void {
        if (this.stopped || generation !== this.generation) return;
        try {
            const createSocket =
                this.options.createSocket ??
                ((url: string, options: ClientOptions) => new WebSocket(url, options));
            const socket = createSocket(this.options.url, {
                headers: this.options.headers,
            });
            this.socket = socket;
            socket.on("open", () => {
                if (this.socket !== socket || this.stopped) return;
                this.options.logger.info(`WebSocket reverse connected to ${this.options.url}`);
                try {
                    this.options.onOpen?.();
                } catch (error) {
                    this.options.logger.error("WebSocket reverse open handler failed", error);
                }
            });
            socket.on("message", data => {
                if (this.socket !== socket || this.stopped) return;
                void Promise.resolve(this.options.onMessage(data)).catch(error =>
                    this.options.logger.error("WebSocket reverse message error", error),
                );
            });
            socket.on("close", () => {
                if (this.socket !== socket) return;
                this.socket = undefined;
                this.options.logger.warn(
                    `WebSocket reverse disconnected from ${this.options.url}, reconnecting...`,
                );
                this.scheduleReconnect(generation);
            });
            socket.on("error", error =>
                this.options.logger.error("WebSocket reverse error", error),
            );
        } catch (error) {
            this.options.logger.error("WebSocket reverse connection failed", error);
            this.scheduleReconnect(generation);
        }
    }

    private scheduleReconnect(generation: number): void {
        if (this.stopped || generation !== this.generation || this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this.connect(generation);
        }, this.options.reconnectDelayMs ?? 5_000);
    }
}
