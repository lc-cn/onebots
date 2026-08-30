import { EventEmitter } from "node:events";
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

    constructor(config: DiscordConfig) {
        super();
        this.config = config;
        this.client = createDiscordLite(config);
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        this.client.on("ready", user => {
            this.ready = true;
            this.user = wrapDiscordUser(user);
            this.emit("ready", this.user);
        });
        this.client.on("messageCreate", message => {
            this.emit("messageCreate", wrapDiscordMessage(message));
        });
        this.client.on("messageUpdate", message => this.emit("messageUpdate", null, message));
        this.client.on("messageDelete", data => this.emit("messageDelete", data));
        this.client.on("guildCreate", guild => {
            this.guilds.set(guild.id, guild);
            this.emit("guildCreate", guild);
        });
        this.client.on("guildDelete", guild => {
            this.guilds.delete(guild.id);
            this.emit("guildDelete", guild);
        });
        this.client.on("guildMemberAdd", member => {
            this.emit("guildMemberAdd", wrapDiscordMember(member));
        });
        this.client.on("guildMemberRemove", member => this.emit("guildMemberRemove", member));
        this.client.on("interactionCreate", interaction => {
            this.emit("interactionCreate", interaction);
        });
        this.client.on("dispatch", (eventName, data, sequence, sessionId) => {
            this.emit("dispatch", eventName, data, sequence, sessionId);
        });
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

    async start(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            if (
                this.config.receive_mode === "interactions" ||
                this.config.receive_mode === "manual"
            ) {
                this.client.initInteractions();
                const user = wrapDiscordUser(await this.getREST().getCurrentUser());
                this.ready = true;
                this.user = user;
                this.emit("ready", user);
                return;
            }
            await this.client.start();
        } catch (error) {
            this.running = false;
            const wrapped = DiscordError.wrap(error, "DISCORD_START_FAILED");
            this.emit("client_error", wrapped);
            throw wrapped;
        }
    }

    async stop(): Promise<void> {
        if (!this.running) return;
        this.running = false;
        this.ready = false;
        this.client.stop();
        this.emit("stopped");
    }

    isReady(): boolean {
        return this.ready;
    }

    ingest(rawEvent: unknown) {
        return this.client.ingestInteraction(rawEvent);
    }

    ingestHttp(request: DiscordInteractionHttpRequest): Promise<DiscordInteractionHttpResponse> {
        return this.client.ingestInteractionHttp(request);
    }

    acceptHttp(request: Request): Promise<Response> {
        return this.client.acceptHttp(request);
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

    getReceiveMode(): "gateway" | "interactions" | "manual" {
        return this.config.receive_mode ?? "gateway";
    }
}
