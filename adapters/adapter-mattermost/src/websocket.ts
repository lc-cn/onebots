import { EventEmitter } from "node:events";
import { emitAllAwaited } from "onebots";
import { WebSocket, type RawData } from "ws";
import { parseMattermostServerUrl } from "./configuration.js";
import { MattermostError } from "./errors.js";
import type {
    MattermostConfig,
    MattermostSocketAttachOptions,
    MattermostWebSocketEvent,
    MattermostWebSocketResponse,
} from "./types.js";
import { parseMattermostWebSocketMessage } from "./validation.js";

interface MattermostWebSocketTransportEvents {
    event: [event: MattermostWebSocketEvent];
    connected: [event: MattermostWebSocketEvent];
    disconnected: [error?: Error];
    missed: [expected: number, actual: number, event: MattermostWebSocketEvent];
    error: [error: Error];
}

export interface MattermostWebSocketDependencies {
    createSocket?(url: string): WebSocket;
    sleep?(delayMs: number, signal: AbortSignal): Promise<void>;
}

interface SocketBinding {
    socket: WebSocket;
    owned: boolean;
    generation: number;
    open(): void;
    message(data: RawData): void;
    close(code: number, reason: Buffer): void;
    error(error: Error): void;
}

interface PendingAction {
    resolve(response: MattermostWebSocketResponse): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
}

/**
 * Mattermost WebSocket 深模块：认证、可靠续接、序列缺口、无限退避和外部 socket
 * 复用都隐藏在同一接口后，Client 只处理已校验的官方 event envelope。
 */
export class MattermostWebSocketTransport extends EventEmitter<MattermostWebSocketTransportEvents> {
    private readonly createSocket: (url: string) => WebSocket;
    private readonly sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
    private binding?: SocketBinding;
    private lifecycleAbort?: AbortController;
    private externalSignal?: AbortSignal;
    private externalAbort?: () => void;
    private lifecycleGeneration = 0;
    private reconnectTask?: Promise<void>;
    private connectionId?: string;
    private serverSequence = -1;
    private clientSequence = 1;
    private pendingActions = new Map<number, PendingAction>();
    private deliveryQueue: Promise<void> = Promise.resolve();
    private active = false;

    constructor(
        private readonly config: MattermostConfig,
        dependencies: MattermostWebSocketDependencies = {},
    ) {
        super();
        this.createSocket = dependencies.createSocket || (url => new WebSocket(url));
        this.sleep = dependencies.sleep || abortableSleep;
    }

    get connected(): boolean {
        return this.binding?.socket.readyState === WebSocket.OPEN;
    }

    get resumeState(): { connection_id?: string; sequence_number?: number } {
        return {
            connection_id: this.connectionId,
            sequence_number: this.serverSequence >= 0 ? this.serverSequence : undefined,
        };
    }

    /** 建立主动连接；首次握手失败会抛错，之后断线则无限恢复。 */
    async start(signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        if (this.active) return;
        const generation = ++this.lifecycleGeneration;
        const controller = new AbortController();
        this.lifecycleAbort = controller;
        this.active = true;
        this.bindExternalSignal(signal, controller);
        try {
            await this.connectOwned(generation, controller.signal);
        } catch (error) {
            this.active = false;
            controller.abort();
            this.lifecycleAbort = undefined;
            this.unbindExternalSignal();
            throw MattermostError.wrap(error, "MATTERMOST_WEBSOCKET_START_FAILED");
        }
    }

    /**
     * 接收已有 Host 建立或升级完成的 socket。默认发送官方 authentication_challenge，
     * 调用方使用 Authorization header 完成认证时可显式关闭。
     */
    async acceptSocket(
        socket: WebSocket,
        options: MattermostSocketAttachOptions = {},
        signal?: AbortSignal,
    ): Promise<MattermostWebSocketEvent> {
        signal?.throwIfAborted();
        const generation = ++this.lifecycleGeneration;
        this.active = true;
        this.lifecycleAbort?.abort();
        const controller = new AbortController();
        this.lifecycleAbort = controller;
        this.bindExternalSignal(signal, controller);
        try {
            return await this.attach(socket, generation, {
                authenticate: options.authenticate !== false,
                owned: options.owned === true,
                signal: controller.signal,
            });
        } catch (error) {
            this.unbindCurrent(false);
            this.unbindExternalSignal();
            throw MattermostError.wrap(error, "MATTERMOST_WEBSOCKET_ATTACH_FAILED");
        }
    }

    /** 发送官方 WebSocket action，并按 seq_reply 返回结构化响应。 */
    async sendAction(
        action: "user_typing" | "get_statuses" | "get_statuses_by_ids",
        data: Readonly<Record<string, unknown>> = {},
        timeoutMs = this.config.connect_timeout_ms || 15_000,
    ): Promise<MattermostWebSocketResponse> {
        return this.sendRequest(action, data, timeoutMs);
    }

    async stop(): Promise<void> {
        if (!this.active && !this.binding) return;
        this.active = false;
        ++this.lifecycleGeneration;
        this.unbindExternalSignal();
        this.lifecycleAbort?.abort();
        this.lifecycleAbort = undefined;
        this.rejectPending(
            new MattermostError("Mattermost WebSocket 已停止", {
                code: "MATTERMOST_WEBSOCKET_STOPPED",
            }),
        );
        this.unbindCurrent(true);
        await this.reconnectTask?.catch(() => undefined);
        this.reconnectTask = undefined;
        await this.deliveryQueue.catch(() => undefined);
    }

    private bindExternalSignal(signal: AbortSignal | undefined, controller: AbortController): void {
        this.unbindExternalSignal();
        if (!signal) return;
        const abort = (): void => {
            controller.abort(signal.reason);
            void this.stop().catch(error => this.report(MattermostError.wrap(error)));
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

    private async connectOwned(generation: number, signal: AbortSignal): Promise<void> {
        const socket = this.createSocket(this.websocketUrl());
        try {
            await this.attach(socket, generation, { authenticate: true, owned: true, signal });
        } catch (error) {
            if (this.binding?.socket === socket) this.unbindCurrent(true);
            throw error;
        }
    }

    private websocketUrl(): string {
        const url = parseMattermostServerUrl(this.config.server_url);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.pathname = `${url.pathname}/api/v4/websocket`.replace(/\/{2,}/gu, "/");
        if (this.connectionId && this.serverSequence >= 0) {
            url.searchParams.set("connection_id", this.connectionId);
            url.searchParams.set("sequence_number", String(this.serverSequence));
        }
        return url.href;
    }

    private attach(
        socket: WebSocket,
        generation: number,
        options: { authenticate: boolean; owned: boolean; signal: AbortSignal },
    ): Promise<MattermostWebSocketEvent> {
        this.unbindCurrent(true);
        let resolveHello!: (event: MattermostWebSocketEvent) => void;
        let rejectHello!: (error: Error) => void;
        const hello = new Promise<MattermostWebSocketEvent>((resolve, reject) => {
            resolveHello = resolve;
            rejectHello = reject;
        });
        const timeout = setTimeout(
            () =>
                rejectHello(
                    new MattermostError("Mattermost WebSocket 握手超时", {
                        code: "MATTERMOST_WEBSOCKET_TIMEOUT",
                    }),
                ),
            this.config.connect_timeout_ms || 15_000,
        );
        let authentication: Promise<MattermostWebSocketResponse> | undefined;
        const open = (): void => {
            if (generation !== this.lifecycleGeneration || options.signal.aborted) return;
            if (options.authenticate) {
                authentication = this.sendRequest(
                    "authentication_challenge",
                    { token: this.config.access_token },
                    this.config.connect_timeout_ms || 15_000,
                );
                authentication.catch(error => rejectHello(MattermostError.wrap(error)));
            }
        };
        const message = (data: RawData): void => {
            try {
                const parsed = parseSocketData(data);
                const packet = parseMattermostWebSocketMessage(parsed);
                if ("event" in packet) {
                    this.observeSequence(packet);
                    if (packet.event === "hello") resolveHello(packet);
                    this.enqueueEvent(packet);
                } else {
                    this.resolveAction(packet);
                }
            } catch (error) {
                this.report(MattermostError.wrap(error, "MATTERMOST_WEBSOCKET_MESSAGE_INVALID"));
            }
        };
        const close = (code: number, reason: Buffer): void => {
            if (this.binding?.socket !== socket) return;
            clearTimeout(timeout);
            const error =
                code === 1000
                    ? undefined
                    : new MattermostError(
                          `Mattermost WebSocket 已断开 (${code}${reason.length ? `: ${reason.toString("utf8")}` : ""})`,
                          { code: "MATTERMOST_WEBSOCKET_CLOSED", details: { closeCode: code } },
                      );
            this.unbindCurrent(false);
            void emitAllAwaited(this, "disconnected", error).catch(reportError =>
                this.report(MattermostError.wrap(reportError)),
            );
            if (options.owned && this.active) this.scheduleReconnect(generation);
        };
        const socketError = (error: Error): void => {
            const wrapped = MattermostError.wrap(error, "MATTERMOST_WEBSOCKET_ERROR");
            rejectHello(wrapped);
            this.report(wrapped);
        };
        this.binding = {
            socket,
            owned: options.owned,
            generation,
            open,
            message,
            close,
            error: socketError,
        };
        socket.on("open", open);
        socket.on("message", message);
        socket.on("close", close);
        socket.on("error", socketError);
        const abort = (): void => rejectHello(abortReason(options.signal));
        options.signal.addEventListener("abort", abort, { once: true });
        if (socket.readyState === WebSocket.OPEN) queueMicrotask(open);
        return hello
            .then(async event => {
                if (authentication) {
                    const response = await authentication;
                    if (response.status !== "OK") throw websocketResponseError(response);
                }
                await emitAllAwaited(this, "connected", event);
                return event;
            })
            .finally(() => {
                clearTimeout(timeout);
                options.signal.removeEventListener("abort", abort);
            });
    }

    private sendRequest(
        action: string,
        data: Readonly<Record<string, unknown>>,
        timeoutMs: number,
    ): Promise<MattermostWebSocketResponse> {
        const socket = this.binding?.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(
                new MattermostError("Mattermost WebSocket 尚未连接", {
                    code: "MATTERMOST_WEBSOCKET_NOT_CONNECTED",
                }),
            );
        }
        const seq = this.clientSequence++;
        return new Promise<MattermostWebSocketResponse>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingActions.delete(seq);
                reject(
                    new MattermostError(`Mattermost WebSocket action ${action} 超时`, {
                        code: "MATTERMOST_WEBSOCKET_ACTION_TIMEOUT",
                        details: { action, seq },
                    }),
                );
            }, timeoutMs);
            this.pendingActions.set(seq, { resolve, reject, timer });
            socket.send(JSON.stringify({ seq, action, data }), error => {
                if (!error) return;
                const pending = this.pendingActions.get(seq);
                if (!pending) return;
                clearTimeout(pending.timer);
                this.pendingActions.delete(seq);
                pending.reject(MattermostError.wrap(error, "MATTERMOST_WEBSOCKET_SEND_FAILED"));
            });
        }).then(response => {
            if (response.status === "FAIL") throw websocketResponseError(response);
            return response;
        });
    }

    private resolveAction(response: MattermostWebSocketResponse): void {
        const pending = this.pendingActions.get(response.seq_reply);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingActions.delete(response.seq_reply);
        pending.resolve(response);
    }

    private observeSequence(event: MattermostWebSocketEvent): void {
        if (event.event === "hello") {
            const nextConnectionId =
                typeof event.data.connection_id === "string" ? event.data.connection_id : undefined;
            if (this.connectionId && nextConnectionId && this.connectionId !== nextConnectionId) {
                this.serverSequence = -1;
            }
            if (nextConnectionId) this.connectionId = nextConnectionId;
        }
        const expected = this.serverSequence + 1;
        if (this.serverSequence >= 0 && event.seq !== expected) {
            void emitAllAwaited(this, "missed", expected, event.seq, event).catch(error =>
                this.report(MattermostError.wrap(error)),
            );
        }
        this.serverSequence = event.seq;
    }

    private enqueueEvent(event: MattermostWebSocketEvent): void {
        const delivery = this.deliveryQueue.then(() => emitAllAwaited(this, "event", event));
        this.deliveryQueue = delivery.catch(error => {
            this.report(MattermostError.wrap(error, "MATTERMOST_EVENT_DELIVERY_FAILED"));
        });
    }

    private scheduleReconnect(previousGeneration: number): void {
        if (this.reconnectTask || !this.active) return;
        const generation = ++this.lifecycleGeneration;
        const signal = this.lifecycleAbort?.signal;
        if (!signal || previousGeneration > generation) return;
        const task = this.reconnectForever(generation, signal);
        this.reconnectTask = task;
        task.finally(() => {
            if (this.reconnectTask === task) this.reconnectTask = undefined;
        }).catch(error => this.report(MattermostError.wrap(error)));
    }

    private async reconnectForever(generation: number, signal: AbortSignal): Promise<void> {
        const initial = this.config.reconnect_initial_delay_ms || 1_000;
        const maximum = this.config.reconnect_max_delay_ms || 30_000;
        let attempt = 0;
        while (this.active && generation === this.lifecycleGeneration && !signal.aborted) {
            const delay = Math.min(maximum, initial * 2 ** Math.min(attempt, 16));
            await this.sleep(delay, signal);
            try {
                await this.connectOwned(generation, signal);
                return;
            } catch (error) {
                if (signal.aborted) return;
                attempt += 1;
                this.report(MattermostError.wrap(error, "MATTERMOST_WEBSOCKET_RECONNECT_FAILED"));
            }
        }
    }

    private unbindCurrent(closeOwned: boolean): void {
        const binding = this.binding;
        if (!binding) return;
        this.binding = undefined;
        binding.socket.off("open", binding.open);
        binding.socket.off("message", binding.message);
        binding.socket.off("close", binding.close);
        binding.socket.off("error", binding.error);
        if (closeOwned && binding.owned && binding.socket.readyState < WebSocket.CLOSING) {
            binding.socket.close(1000, "OneBots stop");
        }
    }

    private rejectPending(error: Error): void {
        for (const pending of this.pendingActions.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pendingActions.clear();
    }

    private report(error: Error): void {
        void emitAllAwaited(this, "error", error).catch(() => undefined);
    }
}

function parseSocketData(data: RawData): unknown {
    let text: string;
    if (typeof data === "string") text = data;
    else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString("utf8");
    else if (Array.isArray(data)) text = Buffer.concat(data).toString("utf8");
    else text = Buffer.from(data).toString("utf8");
    try {
        return JSON.parse(text);
    } catch {
        throw MattermostError.invalid("Mattermost WebSocket frame 不是有效 JSON");
    }
}

function websocketResponseError(response: MattermostWebSocketResponse): MattermostError {
    return new MattermostError(response.error?.message || "Mattermost WebSocket action 失败", {
        code: response.error?.id || "MATTERMOST_WEBSOCKET_ACTION_FAILED",
        requestId: response.error?.request_id,
        detailedError: response.error?.detailed_error,
        details: { seq_reply: response.seq_reply },
    });
}

function abortReason(signal: AbortSignal): Error {
    return signal.reason instanceof Error
        ? signal.reason
        : new MattermostError("Mattermost WebSocket 操作已取消", {
              code: "MATTERMOST_WEBSOCKET_ABORTED",
          });
}

function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const complete = (): void => {
            signal.removeEventListener("abort", abort);
            resolve();
        };
        const timer = setTimeout(complete, delayMs);
        const abort = (): void => {
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            reject(abortReason(signal));
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
    });
}
