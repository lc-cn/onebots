import { EventEmitter } from "node:events";
import { emitAllAwaited, FailureCollector } from "onebots";
import { DiscordREST } from "./rest.js";
import type { DiscordHttpTransport } from "./rest-transport.js";
import {
    DiscordGateway,
    GatewayIntents,
    type DiscordGatewayCommand,
    type GatewayOptions,
} from "./gateway.js";
import {
    InteractionsHandler,
    type DiscordInteractionHttpRequest,
    type DiscordInteractionHttpResponse,
    type InteractionWebhookOptions,
} from "./interactions.js";
import {
    DiscordWebhookEventsReceiver,
    isDiscordWebhookPayload,
    type DiscordWebhookEventPayload,
    type DiscordWebhookPayload,
} from "./webhook-events.js";
import type {
    CreateMessageBody,
    DiscordApiGuild,
    DiscordApiGuildMember,
    DiscordApiMessage,
    DiscordApiUser,
    DiscordInteraction,
    DiscordMessageDeleteData,
    DiscordMessageUpdateData,
    DiscordGuildDeleteData,
    DiscordGuildMemberRemoveData,
    EditMessageBody,
} from "../types.js";
import { DiscordError } from "../errors.js";
import { isFatalGatewayCloseCode } from "./gateway-types.js";
import { detectDiscordRuntime, supportsDiscordGateway, type DiscordRuntime } from "./runtime.js";

// 重新导出
export { DiscordREST, type RESTOptions } from "./rest.js";
export {
    DefaultDiscordHttpTransport,
    type DiscordHttpRequest,
    type DiscordHttpResponse,
    type DiscordHttpTransport,
} from "./rest-transport.js";
export {
    DiscordRateLimitCoordinator,
    discordRouteKey,
    type DiscordScheduledRequest,
} from "./rest-rate-limit.js";
export { buildDiscordMultipart, type DiscordMultipartBody } from "./multipart.js";
export { DiscordGateway, GatewayIntents, GatewayOpcodes, type GatewayOptions } from "./gateway.js";
export {
    compileDiscordGatewayCommand,
    parseDiscordGatewayCommand,
    type DiscordChannelInfoField,
    type DiscordGatewayCommand,
    type DiscordGatewayCommandPayload,
    type DiscordPresenceStatus,
} from "./gateway-commands.js";
export {
    InteractionsHandler,
    InteractionType,
    InteractionCallbackType,
    verifyInteractionSignature,
    type InteractionWebhookOptions,
    type InteractionHandler,
    type DiscordInteractionHttpRequest,
    type DiscordInteractionHttpResponse,
} from "./interactions.js";
export {
    DiscordWebhookEventsReceiver,
    isDiscordWebhookPayload,
    type DiscordWebhookEvent,
    type DiscordWebhookEventPayload,
    type DiscordWebhookEventsOptions,
    type DiscordWebhookEventType,
    type DiscordWebhookPayload,
    type DiscordWebhookPingPayload,
} from "./webhook-events.js";
/**
 * 运行时类型
 */
export type RuntimeType = DiscordRuntime;
export const detectRuntime = detectDiscordRuntime;
export const supportsGateway = supportsDiscordGateway;
export { detectDiscordRuntime, supportsDiscordGateway, type DiscordRuntime } from "./runtime.js";

/**
 * Discord Lite 配置
 */
export interface DiscordLiteOptions {
    token: string;
    intents?: number;
    proxy?: {
        url: string;
        username?: string;
        password?: string;
    };
    mode?: "gateway" | "interactions" | "webhook_events" | "manual" | "auto";
    // HTTP 接收模式需要
    publicKey?: string;
    applicationId?: string;
    presence?: GatewayOptions["presence"];
    shard?: GatewayOptions["shard"];
    apiBaseUrl?: string;
    transport?: DiscordHttpTransport;
    maxRateLimitRetries?: number;
    unhandledInteractionHandler?: InteractionWebhookOptions["onUnhandled"];
}

export interface DiscordLiteEvents {
    ready: [user: DiscordApiUser];
    resumed: [];
    stopped: [];
    reconnecting: [error: DiscordError];
    client_error: [error: DiscordError];
    close: [code: number, reason: string];
    dispatch: [eventName: string, data: unknown, sequence: number | null, sessionId: string | null];
    messageCreate: [message: DiscordApiMessage];
    messageUpdate: [message: DiscordMessageUpdateData];
    messageDelete: [data: DiscordMessageDeleteData];
    guildCreate: [guild: DiscordApiGuild];
    guildDelete: [guild: DiscordGuildDeleteData];
    guildMemberAdd: [member: DiscordApiGuildMember];
    guildMemberRemove: [member: DiscordGuildMemberRemoveData];
    interactionCreate: [interaction: DiscordInteraction];
    webhookEvent: [payload: DiscordWebhookEventPayload];
}

/**
 * Discord Lite 统一客户端
 */
export class DiscordLite extends EventEmitter<DiscordLiteEvents> {
    private options: DiscordLiteOptions;
    private gateway: DiscordGateway | null = null;
    private interactions: InteractionsHandler | null = null;
    private webhookEvents: DiscordWebhookEventsReceiver | null = null;
    private rest: DiscordREST;
    private runtime: RuntimeType;
    private mode: "gateway" | "interactions" | "webhook_events" | "manual";
    private user: DiscordApiUser | null = null;
    private startPromise?: Promise<void>;

    constructor(options: DiscordLiteOptions) {
        super();
        if (!options.token?.trim()) {
            throw DiscordError.configuration("Discord token 不能为空", "DISCORD_TOKEN_REQUIRED");
        }
        this.options = options;
        this.runtime = detectRuntime();
        this.rest = new DiscordREST({
            token: options.token,
            proxy: options.proxy,
            apiBaseUrl: options.apiBaseUrl,
            transport: options.transport,
            maxRateLimitRetries: options.maxRateLimitRetries,
        });

        // 确定运行模式
        if (options.mode === "auto" || !options.mode) {
            this.mode = supportsGateway() ? "gateway" : "interactions";
        } else {
            this.mode = options.mode;
        }
    }

    /**
     * 启动客户端（Gateway 模式）
     */
    async start(signal?: AbortSignal): Promise<void> {
        if (this.gateway) return;
        if (this.startPromise) return this.startPromise;
        const start = this.startInternal(signal);
        this.startPromise = start;
        try {
            await start;
        } finally {
            if (this.startPromise === start) this.startPromise = undefined;
        }
    }

    private async startInternal(signal?: AbortSignal): Promise<void> {
        if (this.mode !== "gateway") {
            throw DiscordError.invalid(
                "start() 仅支持 Gateway 模式，Interactions 模式请使用 handleRequest()",
                "DISCORD_RECEIVE_MODE_INVALID",
            );
        }

        if (!supportsGateway()) {
            throw DiscordError.configuration(
                `当前运行时 ${this.runtime} 不支持 Gateway 模式`,
                "DISCORD_GATEWAY_RUNTIME_UNSUPPORTED",
            );
        }

        const intents =
            this.options.intents ??
            GatewayIntents.Guilds |
                GatewayIntents.GuildMessages |
                GatewayIntents.DirectMessages |
                GatewayIntents.MessageContent;

        const gateway = new DiscordGateway({
            token: this.options.token,
            intents,
            rest: this.rest,
            proxy: this.options.proxy,
            presence: this.options.presence,
            shard: this.options.shard,
        });
        this.gateway = gateway;

        // 转发事件
        gateway.on("ready", async user => {
            this.user = user;
            await emitAllAwaited(this, "ready", user);
        });
        gateway.on("resumed", () => emitAllAwaited(this, "resumed"));
        gateway.on("messageCreate", message => emitAllAwaited(this, "messageCreate", message));
        gateway.on("messageUpdate", message => emitAllAwaited(this, "messageUpdate", message));
        gateway.on("messageDelete", data => emitAllAwaited(this, "messageDelete", data));
        gateway.on("guildCreate", guild => emitAllAwaited(this, "guildCreate", guild));
        gateway.on("guildDelete", guild => emitAllAwaited(this, "guildDelete", guild));
        gateway.on("guildMemberAdd", member => emitAllAwaited(this, "guildMemberAdd", member));
        gateway.on("guildMemberRemove", member =>
            emitAllAwaited(this, "guildMemberRemove", member),
        );
        gateway.on("interactionCreate", interaction =>
            emitAllAwaited(this, "interactionCreate", interaction),
        );
        gateway.on("dispatch", (event, data, sequence, sessionId) =>
            emitAllAwaited(this, "dispatch", event, data, sequence, sessionId),
        );
        gateway.on("client_error", error => this.emit("client_error", error));
        gateway.on("reconnecting", error => this.emit("reconnecting", error));
        gateway.on("close", (code, reason) => {
            if (isFatalGatewayCloseCode(code) && this.gateway === gateway) {
                this.gateway = null;
                this.user = null;
            }
            this.emit("close", code, reason);
        });

        try {
            await gateway.connect(signal);
        } catch (error) {
            await gateway.disconnect();
            if (this.gateway === gateway) this.gateway = null;
            throw error;
        }
    }

    /**
     * 停止客户端
     */
    async stop(): Promise<void> {
        const gateway = this.gateway;
        if (!gateway) return;

        // 先使当前代次失效，避免关闭过程中的迟到事件继续使用旧连接。
        this.gateway = null;
        this.user = null;
        const failures = new FailureCollector();
        await failures.capture(() => gateway.disconnect());
        await failures.capture(() => emitAllAwaited(this, "stopped"));
        try {
            failures.throwIfAny("Discord Lite 停止期间发生多个错误");
        } catch (error) {
            const wrapped = DiscordError.wrap(error, "DISCORD_STOP_FAILED");
            this.emit("client_error", wrapped);
            throw wrapped;
        }
    }

    /**
     * 初始化 Interactions 处理器
     */
    initInteractions(): InteractionsHandler {
        if (this.interactions) return this.interactions;
        if (
            this.mode === "interactions" &&
            (!this.options.publicKey || !this.options.applicationId)
        ) {
            throw DiscordError.configuration(
                "Interactions 模式需要 publicKey 和 applicationId",
                "DISCORD_INTERACTION_CONFIG_REQUIRED",
            );
        }

        this.interactions = new InteractionsHandler({
            publicKey: this.options.publicKey ?? "",
            token: this.options.token,
            applicationId: this.options.applicationId ?? "",
            trustedIngress: this.mode === "manual",
            onInteraction: async interaction => {
                await emitAllAwaited(this, "interactionCreate", interaction);
                await emitAllAwaited(
                    this,
                    "dispatch",
                    "INTERACTION_CREATE",
                    interaction,
                    null,
                    null,
                );
            },
            onUnhandled: this.options.unhandledInteractionHandler,
        });

        return this.interactions;
    }

    /** 初始化 Discord 原生 Webhook Events 接收器。 */
    initWebhookEvents(): DiscordWebhookEventsReceiver {
        if (this.webhookEvents) return this.webhookEvents;
        if (
            this.mode === "webhook_events" &&
            (!this.options.publicKey || !this.options.applicationId)
        ) {
            throw DiscordError.configuration(
                "Webhook Events 模式需要 publicKey 和 applicationId",
                "DISCORD_WEBHOOK_CONFIG_REQUIRED",
            );
        }
        this.webhookEvents = new DiscordWebhookEventsReceiver({
            publicKey: this.options.publicKey,
            applicationId: this.options.applicationId,
            trustedIngress: this.mode === "manual",
            onEvent: async payload => {
                await emitAllAwaited(this, "webhookEvent", payload);
                await emitAllAwaited(
                    this,
                    "dispatch",
                    `WEBHOOK_EVENT:${payload.event.type}`,
                    payload,
                    null,
                    null,
                );
            },
        });
        return this.webhookEvents;
    }

    /**
     * 处理 HTTP 请求（Interactions 模式）
     */
    async handleRequest(request: Request): Promise<Response> {
        return this.acceptHttp(request);
    }

    /** 标准 Fetch/WinterCG HTTP seam。 */
    async acceptHttp(request: Request): Promise<Response> {
        if (this.mode === "webhook_events") {
            return this.initWebhookEvents().acceptHttp(request);
        }
        if (!this.interactions) {
            this.initInteractions();
        }
        return this.interactions!.acceptHttp(request);
    }

    /** 将已有连接取得的 Interaction 交给同一个客户端。 */
    async ingestInteraction(rawEvent: unknown) {
        return this.initInteractions().ingest(rawEvent);
    }

    /** 供 Koa、Hono 等已有 HTTP Host 复用的结构化入站接口。 */
    async ingestInteractionHttp(
        request: DiscordInteractionHttpRequest,
    ): Promise<DiscordInteractionHttpResponse> {
        return this.initInteractions().ingestHttp(request);
    }

    /** 将 Discord Webhook Events 请求交给已有 HTTP Host。 */
    async ingestWebhookEventHttp(
        request: DiscordInteractionHttpRequest,
    ): Promise<DiscordInteractionHttpResponse> {
        return this.initWebhookEvents().ingestHttp(request);
    }

    /** 将已验证或结构化的 Discord Webhook Event 交给同一个客户端。 */
    async ingestWebhookEvent(rawEvent: unknown): Promise<DiscordWebhookPayload> {
        return this.initWebhookEvents().ingest(rawEvent);
    }

    /** 按配置的 HTTP 接收模式分派原始事件。 */
    async ingest(rawEvent: unknown) {
        return this.mode === "webhook_events" ||
            (this.mode === "manual" && isDiscordWebhookPayload(rawEvent))
            ? this.ingestWebhookEvent(rawEvent)
            : this.ingestInteraction(rawEvent);
    }

    /**
     * 获取 REST 客户端
     */
    getREST(): DiscordREST {
        return this.rest;
    }

    /**
     * 获取当前用户
     */
    getUser(): DiscordApiUser | null {
        return this.user;
    }

    /**
     * 获取当前运行时
     */
    getRuntime(): RuntimeType {
        return this.runtime;
    }

    /**
     * 获取当前模式
     */
    getMode(): "gateway" | "interactions" | "webhook_events" | "manual" {
        return this.mode;
    }

    /** 发送 Presence、Voice State 与资源请求等 Gateway 主动事件。 */
    sendGatewayCommand(command: DiscordGatewayCommand): void {
        if (this.mode !== "gateway" || !this.gateway) {
            throw DiscordError.invalid(
                "Gateway 主动事件仅可在已启动的 gateway 模式发送",
                "DISCORD_GATEWAY_NOT_STARTED",
            );
        }
        this.gateway.sendCommand(command);
    }

    // ============================================
    // 便捷方法
    // ============================================

    /** 发送消息 */
    async sendMessage(channelId: string, content: string | CreateMessageBody) {
        return this.rest.createMessage(channelId, content);
    }

    /** 编辑消息 */
    async editMessage(channelId: string, messageId: string, content: string | EditMessageBody) {
        return this.rest.editMessage(channelId, messageId, content);
    }

    /** 删除消息 */
    async deleteMessage(channelId: string, messageId: string) {
        return this.rest.deleteMessage(channelId, messageId);
    }

    /** 获取消息 */
    async getMessage(channelId: string, messageId: string) {
        return this.rest.getMessage(channelId, messageId);
    }

    /** 获取服务器 */
    async getGuild(guildId: string) {
        return this.rest.getGuild(guildId);
    }

    /** 获取服务器成员 */
    async getGuildMember(guildId: string, userId: string) {
        return this.rest.getGuildMember(guildId, userId);
    }
}

/**
 * 创建 Discord Lite 客户端的便捷方法
 */
export function createClient(options: DiscordLiteOptions): DiscordLite {
    return new DiscordLite(options);
}
