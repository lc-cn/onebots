import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { emitAllAwaited, ReliableEventIngress } from "onebots";
import { coerceIrcv3Message, formatIrcv3Message } from "./codec.js";
import { normalizeIrcv3Config, type NormalizedIrcv3Config } from "./configuration.js";
import { Ircv3Error } from "./errors.js";
import { IRCV3_DEFAULT_ERROR_REPLIES, Ircv3RequestManager } from "./requests.js";
import { Ircv3Session } from "./session.js";
import {
    assertIrcv3SocketAttachment,
    connectIrcv3Socket,
    defaultIrcv3Servername,
    Ircv3SocketBinding,
} from "./transport.js";
import type {
    Ircv3ClientDependencies,
    Ircv3ClientEvents,
    Ircv3CommandOptions,
    Ircv3Config,
    Ircv3IngestResult,
    Ircv3Message,
    Ircv3RequestOptions,
    Ircv3SessionSnapshot,
    Ircv3Socket,
    Ircv3SocketAttachOptions,
} from "./types.js";

/**
 * 可独立嵌入的 Modern IRC + IRCv3 Client。
 * 直连 TCP/TLS、宿主已有 socket 和 ingest(rawEvent) 全部经过同一解析与会话入口。
 */
export class Ircv3Client extends EventEmitter<Ircv3ClientEvents> {
    readonly config: NormalizedIrcv3Config;
    private readonly dependencies: Ircv3ClientDependencies;
    private readonly ingress = new ReliableEventIngress<string>();
    private readonly requests = new Ircv3RequestManager();
    private readonly session: Ircv3Session;
    private binding?: Ircv3SocketBinding;
    private bindingOwned = false;
    private startAbort?: AbortController;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private registrationTimer?: ReturnType<typeof setTimeout>;
    private registrationResolve?: (snapshot: Ircv3SessionSnapshot) => void;
    private registrationReject?: (error: Error) => void;
    private registrationSignal?: AbortSignal;
    private registrationAbort?: () => void;
    private startTask?: Promise<void>;
    private externalSignal?: AbortSignal;
    private externalAbort?: () => void;
    private legacyTail: Promise<unknown> = Promise.resolve();
    private generation = 0;
    private reconnectAttempt = 0;
    private started = false;
    private connected = false;
    private registered = false;

    constructor(config: Ircv3Config, dependencies: Ircv3ClientDependencies = {}) {
        super();
        this.config = normalizeIrcv3Config(config);
        this.dependencies = dependencies;
        this.session = new Ircv3Session(this.config);
    }

    get receiveMode(): "connection" | "manual" {
        return this.config.receive_mode;
    }

    get isStarted(): boolean {
        return this.started;
    }

    get isConnected(): boolean {
        return this.connected;
    }

    get isRegistered(): boolean {
        return this.registered;
    }

    get snapshot(): Ircv3SessionSnapshot {
        return this.session.snapshot(this.connected, this.registered);
    }

    supportsCapability(name: string): boolean {
        return this.session.supportsCapability(name);
    }

    supportsFeature(name: string): boolean {
        return this.session.supportsFeature(name);
    }

    supportsClientTag(name: string): boolean {
        return this.supportsCapability("message-tags") && this.session.clientTagAllowed(name);
    }

    supportsHistory(): boolean {
        return this.session.supportsHistory();
    }

    identifiersEqual(left: string | undefined, right: string): boolean {
        return this.session.identifiersEqual(left, right);
    }

    async start(signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        if (this.startTask) return this.startTask;
        if (this.started) return;
        this.started = true;
        this.startAbort = new AbortController();
        this.bindExternalSignal(signal);
        const task =
            this.receiveMode === "manual"
                ? emitAllAwaited(this, "ready", this.snapshot)
                : this.connectManaged(this.startAbort.signal);
        this.startTask = task;
        try {
            await task;
        } catch (error) {
            this.started = false;
            this.unbindExternalSignal();
            this.startAbort = undefined;
            throw Ircv3Error.wrap(error, "IRC Client 启动失败", "IRCV3_START_FAILED");
        } finally {
            if (this.startTask === task) this.startTask = undefined;
        }
    }

    async stop(): Promise<void> {
        if (!this.started && !this.binding) return;
        this.started = false;
        ++this.generation;
        this.unbindExternalSignal();
        this.startAbort?.abort();
        this.startAbort = undefined;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
        this.rejectRegistration(new Ircv3Error("IRC Client 已停止", { code: "IRCV3_STOPPED" }));
        this.requests.rejectAll(new Ircv3Error("IRC Client 已停止", { code: "IRCV3_STOPPED" }));
        const binding = this.detachBinding(true);
        this.resetConnectionState();
        await binding?.drain();
        await emitAllAwaited(this, "stop");
    }

    /** 将宿主已连接的 TCP/TLS/WebSocket bridge 交给同一 Client。 */
    async acceptSocket(
        socket: Ircv3Socket,
        options: Ircv3SocketAttachOptions = {},
        signal?: AbortSignal,
    ): Promise<Ircv3SessionSnapshot> {
        signal?.throwIfAborted();
        assertIrcv3SocketAttachment(socket, options);
        if (!this.started) {
            this.started = true;
            this.startAbort = new AbortController();
            this.bindExternalSignal(signal);
        }
        const generation = ++this.generation;
        const previous = this.detachBinding(true);
        this.resetConnectionState();
        await previous?.drain();
        this.connected = true;
        this.bindingOwned = options.owned === true;
        this.binding = new Ircv3SocketBinding(socket, {
            maxLineBytes: this.config.max_line_bytes,
            onMessage: async message => {
                if (generation === this.generation) await this.consume(message);
            },
            onClose: () => this.onSocketClose(generation),
            onError: error => {
                if (generation === this.generation) this.reportError(error);
            },
        });
        if (options.registered) {
            this.registered = true;
            this.session.adopt(options);
            await emitAllAwaited(this, "connected", this.snapshot);
            await emitAllAwaited(this, "ready", this.snapshot);
            return this.snapshot;
        }
        const registered = this.waitForRegistration(signal);
        this.session.begin(line => this.write(line));
        return registered;
    }

    /** 队列、反向连接或测试夹具可直接提交完整 message、文本行或 UTF-8 bytes。 */
    async ingest(rawEvent: unknown): Promise<Ircv3IngestResult> {
        const message = coerceIrcv3Message(rawEvent, this.config.max_line_bytes);
        return this.consume(message);
    }

    /** 发送受 CRLF 注入、参数数量与 512-byte 主报文约束的 IRC command。 */
    async call(
        command: string,
        params: readonly string[] = [],
        options: Ircv3CommandOptions = {},
    ): Promise<void> {
        options.signal?.throwIfAborted();
        this.write(formatIrcv3Message(command, params, options.tags));
    }

    /** 收集有明确结束回复的命令；支持 labeled-response，旧服务器自动串行化。 */
    request(
        command: string,
        params: readonly string[],
        options: Ircv3RequestOptions,
    ): Promise<Ircv3Message[]> {
        const execute = async (): Promise<Ircv3Message[]> => {
            options.signal?.throwIfAborted();
            const label = this.supportsCapability("labeled-response") ? randomUUID() : undefined;
            const pending = this.requests.create(
                command,
                options.endCommands,
                options.errorCommands || IRCV3_DEFAULT_ERROR_REPLIES,
                options.timeoutMs || this.config.command_timeout_ms,
                label,
                options.signal,
            );
            try {
                await this.call(command, params, {
                    signal: options.signal,
                    tags: { ...options.tags, label },
                });
            } catch (error) {
                const wrapped = Ircv3Error.wrap(
                    error,
                    `IRC ${command} 发送失败`,
                    "IRCV3_COMMAND_SEND_FAILED",
                );
                this.requests.reject(label, wrapped);
                return pending;
            }
            return pending;
        };
        if (this.supportsCapability("labeled-response")) return execute();
        const result = this.legacyTail.then(execute, execute);
        this.legacyTail = result.catch(() => undefined);
        return result;
    }

    async join(channel: string, key?: string): Promise<void> {
        await this.call("JOIN", key ? [channel, key] : [channel]);
    }

    async part(channel: string, reason?: string): Promise<void> {
        await this.call("PART", reason ? [channel, reason] : [channel]);
    }

    async sendMessage(
        target: string,
        text: string,
        tags?: Readonly<Record<string, string | null>>,
    ): Promise<void> {
        await this.call("PRIVMSG", [target, text], { tags });
    }

    async sendMessageWithReceipt(
        target: string,
        text: string,
        tags?: Readonly<Record<string, string | null>>,
    ): Promise<string | undefined> {
        if (
            !this.supportsCapability("labeled-response") ||
            !this.supportsCapability("echo-message")
        ) {
            await this.sendMessage(target, text, tags);
            return undefined;
        }
        const response = await this.request("PRIVMSG", [target, text], {
            endCommands: ["PRIVMSG", "ACK"],
            tags,
        });
        const echoed = response.find(message => message.command === "PRIVMSG");
        return typeof echoed?.tags.msgid === "string" ? echoed.tags.msgid : undefined;
    }

    async sendNotice(target: string, text: string): Promise<void> {
        await this.call("NOTICE", [target, text]);
    }

    async sendAction(target: string, text: string): Promise<void> {
        await this.sendMessage(target, `\u0001ACTION ${text}\u0001`);
    }

    async sendTyping(target: string, state: "active" | "paused" | "done"): Promise<void> {
        if (!this.supportsClientTag("typing")) {
            throw new Ircv3Error("服务器未允许 IRCv3 typing client tag", {
                code: "IRCV3_TYPING_UNAVAILABLE",
            });
        }
        await this.call("TAGMSG", [target], { tags: { "+typing": state } });
    }

    async whois(nickname: string): Promise<Ircv3Message[]> {
        return this.request("WHOIS", [nickname], { endCommands: ["318"] });
    }

    async names(channel: string): Promise<Ircv3Message[]> {
        return this.request("NAMES", [channel], { endCommands: ["366"] });
    }

    async history(
        target: string,
        limit: number,
        beforeMessageId?: string,
    ): Promise<Ircv3Message[]> {
        const params = this.session.historyParams(target, limit, beforeMessageId);
        return this.request("CHATHISTORY", params, { endCommands: ["BATCH"] });
    }

    async setNickname(nickname: string): Promise<void> {
        await this.call("NICK", [nickname]);
    }

    private async connectManaged(signal: AbortSignal): Promise<void> {
        const connector = this.dependencies.connect || connectIrcv3Socket;
        const socket = await connector({
            host: this.config.host,
            port: this.config.port,
            tls: this.config.tls,
            timeoutMs: this.config.connect_timeout_ms,
            tlsOptions: {
                servername: this.config.tls_servername || defaultIrcv3Servername(this.config.host),
                rejectUnauthorized: this.config.tls_reject_unauthorized,
                clientCertPath: this.config.tls_client_cert_path,
                clientKeyPath: this.config.tls_client_key_path,
                clientKeyPassphrase: this.config.tls_client_key_passphrase,
            },
            signal,
        });
        await this.acceptSocket(socket, { owned: true }, signal);
        this.reconnectAttempt = 0;
    }

    private async consume(message: Ircv3Message): Promise<Ircv3IngestResult> {
        await emitAllAwaited(this, "raw", message);
        await this.session.consume(message, {
            send: line => this.write(line),
            onRegistered: () => this.completeRegistration(),
            failRegistration: error => this.failRegistration(error),
        });
        this.requests.observe(message);
        const delivery = this.session.createDelivery(
            message,
            this.generation,
            this.dependencies.now?.() || Date.now(),
        );
        const filtered = !this.config.event_commands.includes(message.command);
        if (filtered) return { accepted: false, filtered: true, delivery };
        const accepted = await this.ingress.deliver(delivery.id, () =>
            emitAllAwaited(this, "event", delivery),
        );
        return { accepted, filtered: false, delivery };
    }

    private async completeRegistration(): Promise<void> {
        this.registered = true;
        if (this.registrationTimer) clearTimeout(this.registrationTimer);
        this.registrationTimer = undefined;
        for (const channel of this.config.channels) {
            if (channel.auto_join !== false) await this.join(channel.name, channel.key);
        }
        const snapshot = this.snapshot;
        this.registrationResolve?.(snapshot);
        this.clearRegistrationWaiter();
        await emitAllAwaited(this, "connected", snapshot);
        await emitAllAwaited(this, "ready", snapshot);
    }

    private waitForRegistration(signal?: AbortSignal): Promise<Ircv3SessionSnapshot> {
        return new Promise((resolve, reject) => {
            this.registrationResolve = resolve;
            this.registrationReject = reject;
            this.registrationTimer = setTimeout(
                () =>
                    this.failRegistration(
                        new Ircv3Error("IRC 注册超时", { code: "IRCV3_REGISTRATION_TIMEOUT" }),
                    ),
                this.config.connect_timeout_ms,
            );
            this.registrationTimer.unref?.();
            if (signal) {
                this.registrationSignal = signal;
                this.registrationAbort = () =>
                    this.failRegistration(
                        new Ircv3Error("IRC 注册已取消", { code: "IRCV3_ABORTED" }),
                    );
                signal.addEventListener("abort", this.registrationAbort, { once: true });
            }
        });
    }

    private failRegistration(error: Error): void {
        this.registrationReject?.(error);
        this.clearRegistrationWaiter();
        ++this.generation;
        this.detachBinding(true);
        this.resetConnectionState();
    }

    private rejectRegistration(error: Error): void {
        this.registrationReject?.(error);
        this.clearRegistrationWaiter();
    }

    private clearRegistrationWaiter(): void {
        if (this.registrationTimer) clearTimeout(this.registrationTimer);
        this.registrationTimer = undefined;
        this.registrationResolve = undefined;
        this.registrationReject = undefined;
        if (this.registrationSignal && this.registrationAbort) {
            this.registrationSignal.removeEventListener("abort", this.registrationAbort);
        }
        this.registrationSignal = undefined;
        this.registrationAbort = undefined;
    }

    private async onSocketClose(generation: number): Promise<void> {
        if (generation !== this.generation) return;
        this.binding = undefined;
        this.bindingOwned = false;
        this.connected = false;
        this.registered = false;
        this.session.reset();
        const error = new Ircv3Error("IRC 连接已关闭", { code: "IRCV3_DISCONNECTED" });
        this.rejectRegistration(error);
        this.requests.rejectAll(error);
        await emitAllAwaited(this, "disconnected", error);
        if (this.started && this.receiveMode === "connection" && !this.startAbort?.signal.aborted)
            this.scheduleReconnect();
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer || !this.startAbort) return;
        const base = Math.min(
            this.config.reconnect_max_delay_ms,
            this.config.reconnect_initial_delay_ms * 2 ** this.reconnectAttempt++,
        );
        const jitter = 0.75 + (this.dependencies.random?.() ?? Math.random()) * 0.5;
        this.reconnectTimer = setTimeout(
            () => {
                this.reconnectTimer = undefined;
                const signal = this.startAbort?.signal;
                if (!signal || signal.aborted || !this.started) return;
                void this.connectManaged(signal).catch(error => {
                    this.reportError(
                        Ircv3Error.wrap(error, "IRC 重连失败", "IRCV3_RECONNECT_FAILED"),
                    );
                    this.scheduleReconnect();
                });
            },
            Math.round(base * jitter),
        );
        this.reconnectTimer.unref?.();
    }

    private write(line: string): void {
        if (!this.binding || !this.connected)
            throw new Ircv3Error("IRC socket 未连接", { code: "IRCV3_NOT_CONNECTED" });
        this.binding.write(line);
    }

    private detachBinding(closeOwned: boolean): Ircv3SocketBinding | undefined {
        const binding = this.binding;
        this.binding = undefined;
        binding?.detach(closeOwned && this.bindingOwned);
        this.bindingOwned = false;
        return binding;
    }

    private resetConnectionState(): void {
        this.connected = false;
        this.registered = false;
        this.session.reset();
    }

    private bindExternalSignal(signal?: AbortSignal): void {
        if (!signal) return;
        this.externalSignal = signal;
        this.externalAbort = () => void this.stop().catch(error => this.reportError(error));
        signal.addEventListener("abort", this.externalAbort, { once: true });
    }

    private unbindExternalSignal(): void {
        if (this.externalSignal && this.externalAbort)
            this.externalSignal.removeEventListener("abort", this.externalAbort);
        this.externalSignal = undefined;
        this.externalAbort = undefined;
    }

    private reportError(error: unknown): void {
        const wrapped = Ircv3Error.wrap(error, "IRC Client 异常", "IRCV3_CLIENT_ERROR");
        this.dependencies.reportError?.(wrapped);
        void emitAllAwaited(this, "error", wrapped).catch(() => undefined);
    }
}
