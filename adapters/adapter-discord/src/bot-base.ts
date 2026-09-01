import { EventEmitter } from "node:events";
import { emitAllAwaited, FailureCollector } from "onebots";
import type { DiscordBotEvents } from "./bot-events.js";
import { createDiscordLite } from "./bot-client.js";
import { wrapDiscordUser, type DiscordGuild, type DiscordUser } from "./bot-model.js";
import { DiscordError } from "./errors.js";
import type {
    DiscordInteractionHttpRequest,
    DiscordInteractionHttpResponse,
} from "./lite/interactions.js";
import type { DiscordGatewayCommand } from "./lite/gateway-commands.js";
import { isFatalGatewayCloseCode } from "./lite/gateway-types.js";
import { DiscordLite } from "./lite/index.js";
import type { DiscordREST } from "./lite/rest.js";
import type { DiscordConfig } from "./types.js";
import { wrapDiscordMember, wrapDiscordMessage } from "./bot-model.js";

/** Discord 客户端生命周期、事件桥接与手动接入的共享实现。 */
export abstract class DiscordBotBase extends EventEmitter<DiscordBotEvents> {
    protected readonly client: DiscordLite;
    protected readonly config: DiscordConfig;
    protected readonly guilds = new Map<string, DiscordGuild>();
    private ready = false;
    private running = false;
    private user: DiscordUser | null = null;
    private startSignal?: AbortSignal;
    private startAbort?: () => void;

    constructor(config: DiscordConfig) {
        super();
        this.config = config;
        this.client = createDiscordLite(config);
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        this.client.on("ready", async user => {
            this.ready = true;
            this.user = wrapDiscordUser(user);
            await emitAllAwaited(this, "ready", this.user);
        });
        this.client.on("messageCreate", message =>
            emitAllAwaited(this, "messageCreate", wrapDiscordMessage(message)),
        );
        this.client.on("messageUpdate", message =>
            emitAllAwaited(this, "messageUpdate", null, message),
        );
        this.client.on("messageDelete", data => emitAllAwaited(this, "messageDelete", data));
        this.client.on("guildCreate", async guild => {
            this.guilds.set(guild.id, guild);
            await emitAllAwaited(this, "guildCreate", guild);
        });
        this.client.on("guildDelete", async guild => {
            this.guilds.delete(guild.id);
            await emitAllAwaited(this, "guildDelete", guild);
        });
        this.client.on("guildMemberAdd", member =>
            emitAllAwaited(this, "guildMemberAdd", wrapDiscordMember(member)),
        );
        this.client.on("guildMemberRemove", member =>
            emitAllAwaited(this, "guildMemberRemove", member),
        );
        this.client.on("interactionCreate", interaction =>
            emitAllAwaited(this, "interactionCreate", interaction),
        );
        this.client.on("webhookEvent", payload => emitAllAwaited(this, "webhookEvent", payload));
        this.client.on("dispatch", (eventName, data, sequence, sessionId) =>
            emitAllAwaited(this, "dispatch", eventName, data, sequence, sessionId),
        );
        this.client.on("client_error", error => this.emit("client_error", error));
        this.client.on("reconnecting", error => {
            this.ready = false;
            this.emit("reconnecting", error);
        });
        this.client.on("resumed", () => {
            this.ready = true;
            this.emit("resumed");
        });
        this.client.on("close", (code, reason) => {
            this.ready = false;
            if (isFatalGatewayCloseCode(code)) this.running = false;
            this.emit("close", code, reason);
        });
    }

    async start(signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        if (this.running) return;
        this.bindStartSignal(signal);
        this.running = true;
        try {
            if (
                this.config.receive_mode === "interactions" ||
                this.config.receive_mode === "webhook_events" ||
                this.config.receive_mode === "manual"
            ) {
                if (this.config.receive_mode === "webhook_events") {
                    this.client.initWebhookEvents();
                } else {
                    this.client.initInteractions();
                }
                const user = wrapDiscordUser(await this.getREST().getCurrentUser());
                signal?.throwIfAborted();
                if (!this.running) return;
                this.ready = true;
                this.user = user;
                await emitAllAwaited(this, "ready", user);
                return;
            }
            await this.client.start(signal);
            signal?.throwIfAborted();
        } catch (error) {
            this.running = false;
            this.unbindStartSignal();
            if (signal?.aborted) throw signal.reason;
            const wrapped = DiscordError.wrap(error, "DISCORD_START_FAILED");
            this.emit("client_error", wrapped);
            throw wrapped;
        }
    }

    async stop(): Promise<void> {
        if (!this.running && !this.ready) return;
        this.unbindStartSignal();
        this.running = false;
        this.ready = false;
        const failures = new FailureCollector();
        await failures.capture(() => this.client.stop());
        await failures.capture(() => emitAllAwaited(this, "stopped"));
        failures.throwIfAny("Discord 客户端停止期间发生多个错误");
    }

    private bindStartSignal(signal?: AbortSignal): void {
        this.unbindStartSignal();
        if (!signal) return;
        const abort = () => {
            void this.stop().catch(error => this.emit("client_error", error));
        };
        this.startSignal = signal;
        this.startAbort = abort;
        signal.addEventListener("abort", abort, { once: true });
    }

    private unbindStartSignal(): void {
        if (this.startSignal && this.startAbort) {
            this.startSignal.removeEventListener("abort", this.startAbort);
        }
        this.startSignal = undefined;
        this.startAbort = undefined;
    }

    isReady(): boolean {
        return this.ready;
    }

    ingest(rawEvent: unknown) {
        return this.client.ingest(rawEvent);
    }

    ingestHttp(request: DiscordInteractionHttpRequest): Promise<DiscordInteractionHttpResponse> {
        return this.config.receive_mode === "webhook_events"
            ? this.client.ingestWebhookEventHttp(request)
            : this.client.ingestInteractionHttp(request);
    }

    acceptHttp(request: Request): Promise<Response> {
        return this.client.acceptHttp(request);
    }

    ingestWebhookEvent(rawEvent: unknown) {
        return this.client.ingestWebhookEvent(rawEvent);
    }

    sendGatewayCommand(command: DiscordGatewayCommand): void {
        this.client.sendGatewayCommand(command);
    }

    getBotUser(): DiscordUser | null {
        return this.user;
    }

    getREST(): DiscordREST {
        return this.client.getREST();
    }

    getClient(): DiscordLite {
        return this.client;
    }

    getReceiveMode(): "gateway" | "interactions" | "webhook_events" | "manual" {
        return this.config.receive_mode ?? "gateway";
    }
}
