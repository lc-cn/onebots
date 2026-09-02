import { EventEmitter } from "node:events";
import { emitAllAwaited } from "onebots";
import { WebSocket, type RawData } from "ws";
import { parseTwitchEventSubUrl } from "./configuration.js";
import { TwitchError } from "./errors.js";
import type {
    TwitchConfig,
    TwitchEventSubMessage,
    TwitchEventSubSession,
    TwitchSocketAttachOptions,
} from "./types.js";
import { parseEventSubMessage } from "./validation.js";

interface TwitchEventSubTransportEvents {
    message: [message: TwitchEventSubMessage];
    connected: [session: TwitchEventSubSession, resumed: boolean];
    disconnected: [error?: Error];
    error: [error: Error];
}

interface SocketBinding {
    socket: WebSocket;
    owned: boolean;
    generation: number;
    suppressReconnect: boolean;
    open(): void;
    message(data: RawData): void;
    close(code: number, reason: Buffer): void;
    error(error: Error): void;
}

export interface TwitchEventSubDependencies {
    createSocket?(url: string): WebSocket;
    sleep?(delayMs: number, signal: AbortSignal): Promise<void>;
}

/**
 * Twitch EventSub WebSocket transport。
 * 隐藏 welcome 握手、keepalive watchdog、官方 reconnect_url 无损迁移、无限退避与 socket 所有权。
 */
export class TwitchEventSubTransport extends EventEmitter<TwitchEventSubTransportEvents> {
    private readonly createSocket: (url: string) => WebSocket;
    private readonly sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
    private binding?: SocketBinding;
    private lifecycleAbort?: AbortController;
    private externalSignal?: AbortSignal;
    private externalAbort?: () => void;
    private reconnectTask?: Promise<void>;
    private watchdog?: NodeJS.Timeout;
    private keepaliveTimeoutSeconds?: number;
    private generation = 0;
    private active = false;

    constructor(
        private readonly config: TwitchConfig,
        dependencies: TwitchEventSubDependencies = {},
    ) {
        super();
        this.createSocket = dependencies.createSocket || (url => new WebSocket(url));
        this.sleep = dependencies.sleep || abortableSleep;
    }

    get connected(): boolean {
        return this.binding?.socket.readyState === WebSocket.OPEN;
    }

    async start(signal?: AbortSignal): Promise<TwitchEventSubSession> {
        signal?.throwIfAborted();
        if (this.active && this.binding)
            throw new TwitchError("Twitch EventSub 已启动", {
                code: "TWITCH_EVENTSUB_ALREADY_STARTED",
            });
        const generation = ++this.generation;
        const controller = new AbortController();
        this.lifecycleAbort?.abort();
        this.lifecycleAbort = controller;
        this.active = true;
        this.bindExternalSignal(signal, controller);
        try {
            return await this.connectOwned(
                parseTwitchEventSubUrl(
                    this.config.eventsub_websocket_url,
                    this.config.keepalive_timeout_seconds,
                ).href,
                generation,
                false,
                controller.signal,
            );
        } catch (error) {
            this.active = false;
            controller.abort();
            this.lifecycleAbort = undefined;
            this.unbindExternalSignal();
            throw TwitchError.wrap(
                error,
                "Twitch EventSub 启动失败",
                "TWITCH_EVENTSUB_START_FAILED",
            );
        }
    }

    async acceptSocket(
        socket: WebSocket,
        options: TwitchSocketAttachOptions = {},
        signal?: AbortSignal,
    ): Promise<TwitchEventSubSession> {
        signal?.throwIfAborted();
        const generation = ++this.generation;
        const controller = new AbortController();
        this.lifecycleAbort?.abort();
        this.lifecycleAbort = controller;
        this.active = true;
        this.bindExternalSignal(signal, controller);
        try {
            return await this.attach(
                socket,
                generation,
                false,
                options.owned === true,
                controller.signal,
                options.welcome,
            );
        } catch (error) {
            this.unbindCurrent(false);
            this.unbindExternalSignal();
            throw TwitchError.wrap(
                error,
                "Twitch EventSub socket 接入失败",
                "TWITCH_EVENTSUB_ATTACH_FAILED",
            );
        }
    }

    async stop(): Promise<void> {
        if (!this.active && !this.binding) return;
        this.active = false;
        ++this.generation;
        clearTimeout(this.watchdog);
        this.watchdog = undefined;
        this.keepaliveTimeoutSeconds = undefined;
        this.unbindExternalSignal();
        this.lifecycleAbort?.abort();
        this.lifecycleAbort = undefined;
        this.unbindCurrent(true);
        await this.reconnectTask?.catch(() => undefined);
        this.reconnectTask = undefined;
    }

    private async connectOwned(
        url: string,
        generation: number,
        resumed: boolean,
        signal: AbortSignal,
        preserveCurrent = false,
    ): Promise<TwitchEventSubSession> {
        const socket = this.createSocket(url);
        try {
            return await this.attach(
                socket,
                generation,
                resumed,
                true,
                signal,
                undefined,
                preserveCurrent,
            );
        } catch (error) {
            if (this.binding?.socket === socket) this.unbindCurrent(true);
            throw error;
        }
    }

    private attach(
        socket: WebSocket,
        generation: number,
        resumed: boolean,
        owned: boolean,
        signal: AbortSignal,
        providedWelcome?: TwitchEventSubMessage,
        preserveCurrent = false,
    ): Promise<TwitchEventSubSession> {
        if (!preserveCurrent) this.unbindCurrent(true);
        let resolveWelcome!: (session: TwitchEventSubSession) => void;
        let rejectWelcome!: (error: Error) => void;
        const welcome = new Promise<TwitchEventSubSession>((resolve, reject) => {
            resolveWelcome = resolve;
            rejectWelcome = reject;
        });
        const timeout = setTimeout(
            () =>
                rejectWelcome(
                    new TwitchError("Twitch EventSub welcome 超时", {
                        code: "TWITCH_EVENTSUB_TIMEOUT",
                    }),
                ),
            this.config.connect_timeout_ms || 15_000,
        );
        const open = (): void => {
            if (generation !== this.generation || signal.aborted) return;
            if (providedWelcome)
                this.observeMessage(providedWelcome, resolveWelcome, resumed, generation, signal);
        };
        const message = (data: RawData): void => {
            try {
                this.observeMessage(
                    parseEventSubMessage(parseSocketData(data)),
                    resolveWelcome,
                    resumed,
                    generation,
                    signal,
                );
            } catch (error) {
                const wrapped = TwitchError.wrap(
                    error,
                    "Twitch EventSub frame 无效",
                    "TWITCH_EVENTSUB_FRAME_INVALID",
                );
                rejectWelcome(wrapped);
                this.report(wrapped);
            }
        };
        const close = (code: number, reason: Buffer): void => {
            if (this.binding?.socket !== socket) return;
            clearTimeout(timeout);
            clearTimeout(this.watchdog);
            const binding = this.binding;
            const error =
                code === 1000
                    ? undefined
                    : new TwitchError(
                          `Twitch EventSub 已断开 (${code}${reason.length ? `: ${reason.toString("utf8")}` : ""})`,
                          { code: "TWITCH_EVENTSUB_CLOSED", details: { closeCode: code } },
                      );
            this.unbindCurrent(false);
            void emitAllAwaited(this, "disconnected", error).catch(reportError =>
                this.report(TwitchError.wrap(reportError, "Twitch 断线监听器失败")),
            );
            if (binding?.owned && !binding.suppressReconnect && this.active)
                this.scheduleReconnect(generation);
        };
        const socketError = (error: Error): void => {
            const wrapped = TwitchError.wrap(
                error,
                "Twitch EventSub socket 异常",
                "TWITCH_EVENTSUB_SOCKET_ERROR",
            );
            rejectWelcome(wrapped);
            this.report(wrapped);
        };
        this.binding = {
            socket,
            owned,
            generation,
            suppressReconnect: false,
            open,
            message,
            close,
            error: socketError,
        };
        socket.on("open", open);
        socket.on("message", message);
        socket.on("close", close);
        socket.on("error", socketError);
        const abort = (): void => rejectWelcome(abortReason(signal));
        signal.addEventListener("abort", abort, { once: true });
        if (socket.readyState === WebSocket.OPEN) queueMicrotask(open);
        return welcome.finally(() => {
            clearTimeout(timeout);
            signal.removeEventListener("abort", abort);
        });
    }

    private observeMessage(
        message: TwitchEventSubMessage,
        resolveWelcome: (session: TwitchEventSubSession) => void,
        resumed: boolean,
        generation: number,
        signal: AbortSignal,
    ): void {
        const session = message.payload.session;
        if (session?.keepalive_timeout_seconds != null) {
            this.keepaliveTimeoutSeconds = session.keepalive_timeout_seconds;
        }
        this.armWatchdog(this.keepaliveTimeoutSeconds);
        if (message.metadata.message_type === "session_welcome" && session) {
            resolveWelcome(session);
            void emitAllAwaited(this, "connected", session, resumed).catch(error =>
                this.report(TwitchError.wrap(error, "Twitch connected 监听器失败")),
            );
        }
        void emitAllAwaited(this, "message", message).catch(error =>
            this.report(TwitchError.wrap(error, "Twitch EventSub 监听器失败")),
        );
        if (message.metadata.message_type === "session_reconnect" && session?.reconnect_url) {
            void this.followReconnectUrl(session.reconnect_url, generation, signal);
        }
    }

    private async followReconnectUrl(
        url: string,
        generation: number,
        signal: AbortSignal,
    ): Promise<void> {
        const previous = this.binding;
        if (!previous || previous.generation !== generation || signal.aborted) return;
        previous.suppressReconnect = true;
        try {
            const nextGeneration = ++this.generation;
            await this.connectOwned(
                parseTwitchEventSubUrl(url).href,
                nextGeneration,
                true,
                signal,
                true,
            );
            this.detachBinding(previous, true, "EventSub reconnect handoff");
        } catch (error) {
            previous.suppressReconnect = false;
            this.report(
                TwitchError.wrap(
                    error,
                    "Twitch 官方 reconnect_url 迁移失败",
                    "TWITCH_EVENTSUB_HANDOFF_FAILED",
                ),
            );
            this.scheduleReconnect(this.generation);
        }
    }

    private armWatchdog(timeoutSeconds: number | null | undefined): void {
        clearTimeout(this.watchdog);
        if (!timeoutSeconds) return;
        this.watchdog = setTimeout(
            () => {
                const binding = this.binding;
                if (!binding) return;
                const error = new TwitchError("Twitch EventSub keepalive 超时", {
                    code: "TWITCH_EVENTSUB_KEEPALIVE_TIMEOUT",
                });
                this.report(error);
                if (binding.socket.readyState < WebSocket.CLOSING) binding.socket.terminate();
            },
            (timeoutSeconds + 5) * 1000,
        );
    }

    private scheduleReconnect(previousGeneration: number): void {
        if (this.reconnectTask || !this.active) return;
        const generation = ++this.generation;
        const signal = this.lifecycleAbort?.signal;
        if (!signal || previousGeneration > generation) return;
        const task = this.reconnectForever(generation, signal);
        this.reconnectTask = task;
        task.finally(() => {
            if (this.reconnectTask === task) this.reconnectTask = undefined;
        }).catch(error => this.report(TwitchError.wrap(error, "Twitch EventSub 重连任务失败")));
    }

    private async reconnectForever(generation: number, signal: AbortSignal): Promise<void> {
        const initial = this.config.reconnect_initial_delay_ms || 1_000;
        const maximum = this.config.reconnect_max_delay_ms || 30_000;
        let attempt = 0;
        while (this.active && generation === this.generation && !signal.aborted) {
            await this.sleep(Math.min(maximum, initial * 2 ** Math.min(attempt, 16)), signal);
            try {
                await this.connectOwned(
                    parseTwitchEventSubUrl(
                        this.config.eventsub_websocket_url,
                        this.config.keepalive_timeout_seconds,
                    ).href,
                    generation,
                    false,
                    signal,
                );
                return;
            } catch (error) {
                if (signal.aborted) return;
                attempt += 1;
                this.report(
                    TwitchError.wrap(
                        error,
                        "Twitch EventSub 重连失败",
                        "TWITCH_EVENTSUB_RECONNECT_FAILED",
                    ),
                );
            }
        }
    }

    private bindExternalSignal(signal: AbortSignal | undefined, controller: AbortController): void {
        this.unbindExternalSignal();
        if (!signal) return;
        const abort = (): void => {
            controller.abort(signal.reason);
            void this.stop().catch(error =>
                this.report(TwitchError.wrap(error, "Twitch EventSub 停止失败")),
            );
        };
        this.externalSignal = signal;
        this.externalAbort = abort;
        signal.addEventListener("abort", abort, { once: true });
    }

    private unbindExternalSignal(): void {
        if (this.externalSignal && this.externalAbort)
            this.externalSignal.removeEventListener("abort", this.externalAbort);
        this.externalSignal = undefined;
        this.externalAbort = undefined;
    }

    private unbindCurrent(closeOwned: boolean): void {
        const binding = this.binding;
        if (!binding) return;
        this.binding = undefined;
        this.detachBinding(binding, closeOwned, "OneBots stop");
    }

    private detachBinding(binding: SocketBinding, closeOwned: boolean, reason: string): void {
        binding.socket.off("open", binding.open);
        binding.socket.off("message", binding.message);
        binding.socket.off("close", binding.close);
        binding.socket.off("error", binding.error);
        if (closeOwned && binding.owned && binding.socket.readyState < WebSocket.CLOSING)
            binding.socket.close(1000, reason);
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
        return JSON.parse(text) as unknown;
    } catch {
        throw TwitchError.protocol("Twitch EventSub frame 不是有效 JSON");
    }
}

function abortReason(signal: AbortSignal): Error {
    return signal.reason instanceof Error
        ? signal.reason
        : new TwitchError("Twitch EventSub 操作已取消", { code: "TWITCH_EVENTSUB_ABORTED" });
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
