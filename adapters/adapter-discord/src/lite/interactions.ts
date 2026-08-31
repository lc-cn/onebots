import { DiscordREST } from "./rest.js";
import type {
    DiscordInteraction,
    DiscordInteractionResponse,
    DiscordInteractionCallbackData,
    DiscordMessageComponent,
    CreateMessageBody,
    EditMessageBody,
} from "../types.js";
import { DiscordError } from "../errors.js";
import {
    DISCORD_INTERACTION_JSON_HEADERS,
    interactionFetchResponse,
    interactionHttpError,
    isInteractionTimestampFresh,
    parseInteractionJson,
    verifyInteractionSignature,
} from "./interaction-http.js";
import { InteractionResponseCache } from "./interaction-response-cache.js";

export { verifyInteractionSignature } from "./interaction-http.js";

// Interaction Types
export enum InteractionType {
    Ping = 1,
    ApplicationCommand = 2,
    MessageComponent = 3,
    ApplicationCommandAutocomplete = 4,
    ModalSubmit = 5,
}

// Interaction Callback Types
export enum InteractionCallbackType {
    Pong = 1,
    ChannelMessageWithSource = 4,
    DeferredChannelMessageWithSource = 5,
    DeferredUpdateMessage = 6,
    UpdateMessage = 7,
    ApplicationCommandAutocompleteResult = 8,
    Modal = 9,
    PremiumRequired = 10,
    LaunchActivity = 12,
}

export interface InteractionWebhookOptions {
    publicKey?: string;
    token: string;
    applicationId?: string;
    /** 仅允许注入已经由上游验签的事件；本实例不会接受 HTTP 请求。 */
    trustedIngress?: boolean;
    /** 防止已签名请求被长期重放；设为 0 可关闭时间窗校验。 */
    maxTimestampAgeMs?: number;
    /** 在路由处理前观察已验证的 Interaction。 */
    onInteraction?: (interaction: DiscordInteraction) => void;
    /** 未注册本地处理器时的响应策略。 */
    onUnhandled?: (
        interaction: DiscordInteraction,
        message: string,
    ) => DiscordInteractionResponse | Promise<DiscordInteractionResponse>;
}

export interface DiscordInteractionHttpRequest {
    method?: string;
    body: string;
    signature?: string;
    timestamp?: string;
}

export interface DiscordInteractionHttpResponse {
    status: number;
    headers: Readonly<Record<string, string>>;
    body: unknown;
}

/**
 * Interaction 处理器回调函数类型
 */
export type InteractionHandler = (
    interaction: DiscordInteraction,
) => DiscordInteractionResponse | Promise<DiscordInteractionResponse>;

/**
 * Discord Interactions Webhook 处理器
 */
export class InteractionsHandler {
    private publicKey: string;
    private applicationId: string;
    private rest: DiscordREST;
    private handlers: Map<string, InteractionHandler> = new Map();
    private readonly maxTimestampAgeMs: number;
    private readonly onInteraction?: InteractionWebhookOptions["onInteraction"];
    private readonly onUnhandled?: InteractionWebhookOptions["onUnhandled"];
    private readonly responses = new InteractionResponseCache();

    constructor(options: InteractionWebhookOptions) {
        if (!options.trustedIngress && !/^[\da-f]{64}$/i.test(options.publicKey ?? "")) {
            throw DiscordError.configuration(
                "Discord Interaction publicKey 必须是 32 字节十六进制公钥",
                "DISCORD_INTERACTION_PUBLIC_KEY_INVALID",
            );
        }
        if (!options.token.trim() || (!options.trustedIngress && !options.applicationId?.trim())) {
            throw DiscordError.configuration(
                "Discord Interaction token 与 applicationId 不能为空",
                "DISCORD_INTERACTION_CONFIG_REQUIRED",
            );
        }
        if ((options.maxTimestampAgeMs ?? 300_000) < 0) {
            throw DiscordError.configuration(
                "maxTimestampAgeMs 不能小于 0",
                "DISCORD_INTERACTION_TIMESTAMP_WINDOW_INVALID",
            );
        }
        this.publicKey = options.publicKey ?? "";
        this.applicationId = options.applicationId ?? "";
        this.rest = new DiscordREST({ token: options.token });
        this.maxTimestampAgeMs = options.maxTimestampAgeMs ?? 300_000;
        this.onInteraction = options.onInteraction;
        this.onUnhandled = options.onUnhandled;
    }

    /**
     * 注册命令处理器
     */
    onCommand(name: string, handler: InteractionHandler): this {
        this.handlers.set(`command:${name}`, handler);
        return this;
    }

    /**
     * 注册消息组件处理器
     */
    onComponent(customId: string, handler: InteractionHandler): this {
        this.handlers.set(`component:${customId}`, handler);
        return this;
    }

    /**
     * 注册模态框提交处理器
     */
    onModalSubmit(customId: string, handler: InteractionHandler): this {
        this.handlers.set(`modal:${customId}`, handler);
        return this;
    }

    /** 注册应用命令自动补全处理器。 */
    onAutocomplete(name: string, handler: InteractionHandler): this {
        this.handlers.set(`autocomplete:${name}`, handler);
        return this;
    }

    /**
     * 处理 HTTP 请求
     * 适用于 Cloudflare Workers / Vercel Edge Functions
     */
    async acceptHttp(request: Request): Promise<Response> {
        const response = await this.ingestHttp({
            method: request.method,
            signature: request.headers.get("x-signature-ed25519") ?? undefined,
            timestamp: request.headers.get("x-signature-timestamp") ?? undefined,
            body: await request.text(),
        });
        return interactionFetchResponse(response);
    }

    /** Web Fetch API 的历史命名入口；行为与 acceptHttp 完全相同。 */
    async handleRequest(request: Request): Promise<Response> {
        return this.acceptHttp(request);
    }

    /** 接收任意已有 HTTP Host 提取出的原始请求数据，返回宿主无关的结构化响应。 */
    async ingestHttp(
        request: DiscordInteractionHttpRequest,
    ): Promise<DiscordInteractionHttpResponse> {
        if ((request.method || "POST").toUpperCase() !== "POST") {
            return interactionHttpError(
                405,
                "DISCORD_INTERACTION_METHOD_NOT_ALLOWED",
                "Discord Interaction 入口只接受 POST",
            );
        }
        if (!this.publicKey) {
            return interactionHttpError(
                503,
                "DISCORD_INTERACTION_PUBLIC_KEY_REQUIRED",
                "Discord manual 模式未启用本地 HTTP 验签",
            );
        }
        const { signature, timestamp, body } = request;
        if (!signature || !timestamp) return interactionHttpError(401, "missing_signature");
        if (!isInteractionTimestampFresh(timestamp, this.maxTimestampAgeMs)) {
            return interactionHttpError(401, "expired_signature");
        }
        if (!(await verifyInteractionSignature(this.publicKey, signature, timestamp, body))) {
            return interactionHttpError(401, "invalid_signature");
        }

        let rawEvent: unknown;
        try {
            rawEvent = parseInteractionJson(body);
        } catch (error) {
            const wrapped = DiscordError.wrap(error, "DISCORD_INTERACTION_INVALID_JSON");
            return interactionHttpError(400, wrapped.code, wrapped.message);
        }
        try {
            return {
                status: 200,
                headers: DISCORD_INTERACTION_JSON_HEADERS,
                body: await this.ingest(rawEvent),
            };
        } catch (error) {
            const wrapped = DiscordError.wrap(error, "DISCORD_INTERACTION_INGEST_FAILED");
            return interactionHttpError(
                wrapped.code === "DISCORD_INTERACTION_INVALID" ? 400 : 500,
                wrapped.code,
                wrapped.code === "DISCORD_INTERACTION_INVALID"
                    ? wrapped.message
                    : "Discord Interaction 处理失败",
            );
        }
    }

    /**
     * 接收宿主已经验证或从既有连接获得的原始 Interaction。
     * 此入口不创建监听端口，也不执行 HTTP 签名校验。
     */
    async ingest(rawEvent: unknown): Promise<DiscordInteractionResponse> {
        if (!isDiscordInteraction(rawEvent)) {
            throw DiscordError.invalid(
                "Discord Interaction 缺少有效的 id、token、version 或 type",
                "DISCORD_INTERACTION_INVALID",
            );
        }
        try {
            return await this.responses.run(rawEvent.id, async () => {
                this.onInteraction?.(rawEvent);
                return this.handleInteraction(rawEvent);
            });
        } catch (error) {
            throw DiscordError.wrap(error, "DISCORD_INTERACTION_HANDLER_FAILED");
        }
    }

    /**
     * 处理 Interaction
     */
    async handleInteraction(interaction: DiscordInteraction): Promise<DiscordInteractionResponse> {
        const { type, data } = interaction;

        // Ping/Pong 健康检查
        if (type === InteractionType.Ping) {
            return { type: InteractionCallbackType.Pong };
        }

        // 应用命令
        if (type === InteractionType.ApplicationCommand && data) {
            const handler = this.handlers.get(`command:${data.name}`);
            if (handler) {
                return handler(interaction);
            }
            return this.unhandled(interaction, "命令未找到");
        }

        // 消息组件
        if (type === InteractionType.MessageComponent && data) {
            // 尝试精确匹配
            let handler = this.handlers.get(`component:${data.custom_id}`);

            // 尝试前缀匹配
            if (!handler) {
                for (const [key, h] of this.handlers) {
                    if (key.startsWith("component:") && data.custom_id?.startsWith(key.slice(10))) {
                        handler = h;
                        break;
                    }
                }
            }

            if (handler) {
                return handler(interaction);
            }
            return this.unhandled(interaction, "组件处理器未找到");
        }

        // 模态框提交
        if (type === InteractionType.ModalSubmit && data) {
            const handler = this.handlers.get(`modal:${data.custom_id}`);
            if (handler) {
                return handler(interaction);
            }
            return this.unhandled(interaction, "模态框处理器未找到");
        }

        // 自动补全
        if (type === InteractionType.ApplicationCommandAutocomplete && data) {
            const handler = this.handlers.get(`autocomplete:${data.name}`);
            if (handler) {
                return handler(interaction);
            }
            return {
                type: InteractionCallbackType.ApplicationCommandAutocompleteResult,
                data: { choices: [] },
            };
        }

        return this.unhandled(interaction, "未知的 Interaction 类型");
    }

    /**
     * 默认响应
     */
    private defaultResponse(message: string): DiscordInteractionResponse {
        return {
            type: InteractionCallbackType.ChannelMessageWithSource,
            data: {
                content: message,
                flags: 64, // Ephemeral
            },
        };
    }

    private async unhandled(
        interaction: DiscordInteraction,
        message: string,
    ): Promise<DiscordInteractionResponse> {
        return this.onUnhandled
            ? this.onUnhandled(interaction, message)
            : this.defaultResponse(message);
    }

    /**
     * 创建延迟响应
     */
    static deferResponse(ephemeral = false): DiscordInteractionResponse {
        return {
            type: InteractionCallbackType.DeferredChannelMessageWithSource,
            data: ephemeral ? { flags: 64 } : {},
        };
    }

    /** 组件默认延迟更新原消息，其余交互默认延迟创建回复。 */
    static deferUnhandled(
        interaction: DiscordInteraction,
        ephemeral = false,
    ): DiscordInteractionResponse {
        if (interaction.type === InteractionType.MessageComponent) {
            return { type: InteractionCallbackType.DeferredUpdateMessage };
        }
        return InteractionsHandler.deferResponse(ephemeral);
    }

    /**
     * 创建消息响应
     */
    static messageResponse(
        content: string | CreateMessageBody,
        ephemeral = false,
    ): DiscordInteractionResponse {
        const data: DiscordInteractionCallbackData =
            typeof content === "string"
                ? { content }
                : {
                      content: content.content,
                      embeds: content.embeds,
                      components: content.components,
                  };
        return {
            type: InteractionCallbackType.ChannelMessageWithSource,
            data: {
                ...data,
                flags: ephemeral ? 64 : 0,
            },
        };
    }

    /**
     * 创建更新消息响应
     */
    static updateResponse(content: string | EditMessageBody): DiscordInteractionResponse {
        const data: DiscordInteractionCallbackData =
            typeof content === "string"
                ? { content }
                : {
                      content: content.content,
                      embeds: content.embeds,
                      components: content.components,
                  };
        return {
            type: InteractionCallbackType.UpdateMessage,
            data,
        };
    }

    /**
     * 创建模态框响应
     */
    static modalResponse(
        customId: string,
        title: string,
        components: DiscordMessageComponent[],
    ): DiscordInteractionResponse {
        return {
            type: InteractionCallbackType.Modal,
            data: {
                custom_id: customId,
                title,
                components,
            },
        };
    }

    /** 启动已为应用配置的 Discord Activity。 */
    static launchActivityResponse(): DiscordInteractionResponse {
        return { type: InteractionCallbackType.LaunchActivity };
    }

    /**
     * 获取 REST 客户端
     */
    getREST(): DiscordREST {
        return this.rest;
    }

    /**
     * 编辑后续消息（用于延迟响应后）
     */
    async editFollowup(interactionToken: string, content: EditMessageBody) {
        return this.rest.editOriginalInteractionResponse(
            this.requireApplicationId(),
            interactionToken,
            content,
        );
    }

    /**
     * 发送后续消息
     */
    async sendFollowup(interactionToken: string, content: CreateMessageBody) {
        return this.rest.createFollowupMessage(
            this.requireApplicationId(),
            interactionToken,
            content,
        );
    }

    private requireApplicationId(): string {
        if (this.applicationId) return this.applicationId;
        throw DiscordError.configuration(
            "Discord Interaction 跟进操作需要 applicationId",
            "DISCORD_INTERACTION_APPLICATION_ID_REQUIRED",
        );
    }
}

function isDiscordInteraction(value: unknown): value is DiscordInteraction {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const interaction = value as Record<string, unknown>;
    return (
        typeof interaction.id === "string" &&
        typeof interaction.application_id === "string" &&
        typeof interaction.token === "string" &&
        typeof interaction.type === "number" &&
        Number.isInteger(interaction.type) &&
        interaction.type >= InteractionType.Ping &&
        interaction.type <= InteractionType.ModalSubmit &&
        interaction.version === 1
    );
}
