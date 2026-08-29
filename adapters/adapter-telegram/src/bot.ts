/**
 * Telegram Bot 客户端
 * 基于 grammy 封装
 */
import { EventEmitter } from "node:events";
import { timingSafeEqual } from "node:crypto";
import { Bot, Context, InputFile } from "grammy";
import type { Opts, MessageEntity } from "grammy/types";
import type { Update } from "grammy/types";
import type {
    UserFromGetMe,
    ChatFullInfo,
    ChatMember,
    ChatMemberOwner,
    ChatMemberAdministrator,
} from "grammy/types";
import type { Message } from "grammy/types";
import { createProxyAgent } from "onebots";
import { TelegramError } from "./errors.js";
import type { TelegramCallbackQuery, TelegramConfig, TelegramMessage } from "./types.js";
import { resolveTelegramReceiveConfig, type TelegramReceiveConfig } from "./receive-config.js";
import {
    abortableDelay,
    isSupportedProxyUrl,
    isTelegramUpdate,
    maskProxyAddress,
    pollingRetryDelay,
} from "./runtime-utils.js";

export interface TelegramBotEvents {
    ready: [];
    stopped: [];
    client_error: [error: TelegramError];
    transport_state: [state: "connected" | "reconnecting" | "stopped"];
    raw_update: [update: Update];
    update: [update: Update];
    private_message: [message: TelegramMessage];
    group_message: [message: TelegramMessage];
    channel_message: [message: TelegramMessage];
    message_edited: [message: TelegramMessage];
    callback_query: [query: TelegramCallbackQuery];
}

export class TelegramBot extends EventEmitter<TelegramBotEvents> {
    private bot!: Bot;
    private readonly config: TelegramConfig;
    private me: UserFromGetMe | null = null;
    private initialized = false;
    private readonly receiveConfig: TelegramReceiveConfig;
    private initPromise?: Promise<void>;
    private botInitPromise?: Promise<void>;
    private startPromise?: Promise<void>;
    private running = false;
    private generation = 0;
    private pollingAbort?: AbortController;
    private pollingTask?: Promise<void>;
    private readonly receivedUpdateIds = new Map<number, number>();

    constructor(config: TelegramConfig) {
        super();
        if (!config.token?.trim()) {
            throw TelegramError.configuration("Telegram token 不能为空", "TELEGRAM_TOKEN_REQUIRED");
        }
        if (config.proxy && !isSupportedProxyUrl(config.proxy.url)) {
            throw TelegramError.configuration(
                "Telegram proxy.url 仅支持 HTTP、HTTPS、SOCKS4 和 SOCKS5",
                "TELEGRAM_PROXY_URL_INVALID",
                { url: maskProxyAddress(config.proxy.url) },
            );
        }
        this.config = config;
        this.receiveConfig = resolveTelegramReceiveConfig(config);
    }

    getReceiveMode(): TelegramReceiveConfig["mode"] {
        return this.receiveConfig.mode;
    }

    private async initBot(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;
        const initialize = this.initBotInternal();
        this.initPromise = initialize;
        try {
            await initialize;
        } finally {
            if (this.initPromise === initialize) this.initPromise = undefined;
        }
    }

    private async initBotInternal(): Promise<void> {
        const botConfig: ConstructorParameters<typeof Bot>[1] = {};

        const agent = await createProxyAgent(this.config.proxy);
        if (this.config.proxy && !agent) {
            throw TelegramError.configuration(
                "Telegram 代理配置无效，或缺少对应的代理运行时依赖",
                "TELEGRAM_PROXY_UNAVAILABLE",
                { url: maskProxyAddress(this.config.proxy.url) },
            );
        }
        if (agent) {
            botConfig.client = {
                baseFetchConfig: {
                    agent: agent,
                    compress: true,
                },
            };
        }

        this.bot = new Bot(this.config.token, botConfig);
        this.setupEventHandlers();
        this.initialized = true;
    }

    private setupEventHandlers(): void {
        // 先保留完整 Update，再由 Adapter 统一投影。这样新增 Telegram update 类型时
        // 不需要在 Bot 封装和 Adapter 各维护一套事件分支。
        this.bot.use(async (ctx, next) => {
            this.dispatchUpdate(ctx.update);
            await next();
        });

        this.bot.on("message", async (ctx: Context) => {
            const message = ctx.message;
            if (!message) return;

            if (message.from?.is_bot && message.from.id === this.me?.id) return;
            const event = this.transformMessage(message, ctx);
            if (message.chat.type === "private") {
                this.emit("private_message", event);
            } else {
                this.emit("group_message", event);
            }
        });

        this.bot.on("edited_message", async (ctx: Context) => {
            const message = ctx.editedMessage;
            if (!message) return;

            const event = this.transformMessage(message, ctx);
            this.emit("message_edited", event);
        });

        this.bot.on("channel_post", async (ctx: Context) => {
            const message = ctx.channelPost;
            if (!message) return;

            const event = this.transformMessage(message, ctx);
            this.emit("channel_message", event);
        });

        this.bot.on("callback_query", async (ctx: Context) => {
            const query = ctx.callbackQuery;
            if (!query) return;
            this.emit("callback_query", query as unknown as TelegramCallbackQuery);
        });

        this.bot.catch(error => {
            this.emit("client_error", TelegramError.wrap(error, "TELEGRAM_UPDATE_HANDLER_ERROR"));
        });
    }

    private transformMessage(message: Message, ctx: Context): TelegramMessage {
        return {
            message_id: message.message_id,
            from: message.from,
            date: message.date,
            chat: message.chat,
            text: (message as Message.TextMessage).text,
            caption: (message as Message & { caption?: string }).caption,
            photo: (message as Message.PhotoMessage).photo,
            video: (message as Message.VideoMessage).video,
            audio: (message as Message.AudioMessage).audio,
            document: (message as Message.DocumentMessage).document,
            sticker: (message as Message.StickerMessage).sticker,
            location: (message as Message.LocationMessage).location,
            contact: (message as Message.ContactMessage).contact,
            reply_to_message: message.reply_to_message as unknown as TelegramMessage,
            entities: (message as Message.TextMessage).entities,
            caption_entities: (message as Message & { caption_entities?: MessageEntity[] })
                .caption_entities,
            _original: message,
            _ctx: ctx,
        } as TelegramMessage;
    }

    async start(): Promise<void> {
        if (this.running) return;
        if (this.startPromise) return this.startPromise;
        const generation = this.generation;
        const start = this.startInternal(generation);
        this.startPromise = start;
        try {
            await start;
        } finally {
            if (this.startPromise === start) this.startPromise = undefined;
        }
    }

    private async startInternal(generation: number): Promise<void> {
        try {
            await this.initBot();
            if (generation !== this.generation) return;
            if (this.receiveConfig.mode === "manual") {
                await this.ensureBotInited();
                this.me = this.bot.botInfo;
            } else if (this.receiveConfig.mode === "webhook") {
                await this.ensureBotInited();
                this.me = this.bot.botInfo;
                const receive = this.receiveConfig;
                await this.callApi("setWebhook", () =>
                    this.bot.api.setWebhook(receive.url, {
                        secret_token: receive.secretToken,
                        ip_address: receive.ipAddress,
                        max_connections: receive.maxConnections,
                        drop_pending_updates: receive.dropPendingUpdates,
                        allowed_updates: receive.allowedUpdates,
                    }),
                );
                // stop() 可能在请求期间发生；过期启动不能遗留远端 Webhook。
                if (generation !== this.generation) {
                    await this.callApi("deleteWebhook", () => this.bot.api.deleteWebhook());
                    return;
                }
            } else {
                const abort = new AbortController();
                this.pollingAbort = abort;
                this.pollingTask = this.runPolling(generation, abort.signal);
            }
            if (generation !== this.generation) return;
            this.running = true;
            this.emit("ready");
        } catch (error) {
            const wrapped = TelegramError.wrap(error, "TELEGRAM_START_FAILED", "start");
            this.emit("client_error", wrapped);
            throw wrapped;
        }
    }

    async stop(): Promise<void> {
        const wasActive = this.running || Boolean(this.startPromise || this.pollingTask);
        this.generation += 1;
        this.running = false;
        this.startPromise = undefined;
        this.pollingAbort?.abort();
        this.pollingAbort = undefined;
        try {
            if (this.initialized && wasActive) {
                if (this.receiveConfig.mode === "webhook") {
                    await this.callApi("deleteWebhook", () => this.bot.api.deleteWebhook());
                } else if (this.receiveConfig.mode === "polling" && this.bot.isRunning()) {
                    await this.bot.stop();
                }
            }
            await this.pollingTask;
            this.pollingTask = undefined;
            if (wasActive) {
                if (this.receiveConfig.mode === "polling") {
                    this.emit("transport_state", "stopped");
                }
                this.emit("stopped");
            }
        } catch (error) {
            const wrapped = TelegramError.wrap(error, "TELEGRAM_STOP_FAILED", "stop");
            this.emit("client_error", wrapped);
            throw wrapped;
        }
    }

    /** 将已有 HTTP/队列接收到的原始 Update 交给同一中间件与去重链。 */
    async ingest(rawEvent: unknown): Promise<Update> {
        if (!isTelegramUpdate(rawEvent)) {
            throw TelegramError.invalid(
                "Telegram Update 必须包含整数 update_id",
                "TELEGRAM_UPDATE_INVALID",
            );
        }
        await this.ensureBotInited();
        const update = rawEvent;
        await this.bot.handleUpdate(update);
        return update;
    }

    private async ensureBotInited(): Promise<void> {
        await this.initBot();
        if (this.bot.isInited()) return;
        if (this.botInitPromise) return this.botInitPromise;
        const initialize = this.callApi("getMe", () => this.bot.init());
        this.botInitPromise = initialize;
        try {
            await initialize;
        } finally {
            if (this.botInitPromise === initialize) this.botInitPromise = undefined;
        }
    }

    private dispatchUpdate(update: Update): void {
        this.emit("raw_update", update);
        const now = Date.now();
        const previous = this.receivedUpdateIds.get(update.update_id);
        this.receivedUpdateIds.delete(update.update_id);
        this.receivedUpdateIds.set(update.update_id, now);
        for (const [id, receivedAt] of this.receivedUpdateIds) {
            if (this.receivedUpdateIds.size <= 4_096 && now - receivedAt <= 10 * 60_000) break;
            this.receivedUpdateIds.delete(id);
        }
        if (previous === undefined || now - previous > 10 * 60_000) this.emit("update", update);
    }

    private async runPolling(generation: number, signal: AbortSignal): Promise<void> {
        const receiveConfig = this.receiveConfig;
        if (receiveConfig.mode !== "polling") return;
        const pollingOptions = receiveConfig.options;
        let clearWebhook = true;
        let attempt = 0;
        while (generation === this.generation && !signal.aborted) {
            try {
                if (clearWebhook) {
                    // getUpdates 与 Webhook 在 Telegram 侧互斥；仅首次成功时处理积压，
                    // 避免一次普通重连误删断线期间到达的 Update。
                    await this.callApi("deleteWebhook", () =>
                        this.bot.api.deleteWebhook({
                            drop_pending_updates: receiveConfig.dropPendingUpdates,
                        }),
                    );
                    clearWebhook = false;
                }
                await this.bot.start({
                    ...pollingOptions,
                    onStart: botInfo => {
                        this.me = botInfo;
                        attempt = 0;
                        if (generation === this.generation) {
                            this.emit("transport_state", "connected");
                        }
                    },
                });
            } catch (error) {
                if (generation !== this.generation || signal.aborted) return;
                this.emit(
                    "client_error",
                    TelegramError.wrap(error, "TELEGRAM_POLLING_FAILED", "getUpdates"),
                );
                this.emit("transport_state", "reconnecting");
            }
            if (generation !== this.generation || signal.aborted) return;
            attempt += 1;
            await abortableDelay(pollingRetryDelay(attempt), signal);
        }
    }

    async callApi<T>(method: string, task: () => Promise<T>): Promise<T> {
        try {
            return await task();
        } catch (error) {
            throw TelegramError.wrap(error, "TELEGRAM_API_ERROR", method);
        }
    }

    /** 校验 X-Telegram-Bot-Api-Secret-Token。 */
    verifyWebhookSecret(headerToken: string | undefined): boolean {
        const expected = this.config.webhook?.secret_token;
        if (!expected) return true;
        if (!headerToken) return false;
        const actualBuffer = Buffer.from(headerToken);
        const expectedBuffer = Buffer.from(expected);
        return (
            actualBuffer.length === expectedBuffer.length &&
            timingSafeEqual(actualBuffer, expectedBuffer)
        );
    }

    getCachedMe(): UserFromGetMe | null {
        return this.me;
    }

    // 常用 API 保持强类型；长尾能力通过 call_telegram_api 无损调用。
    async getMe(): Promise<UserFromGetMe> {
        this.me = await this.callApi("getMe", () => this.bot.api.getMe());
        return this.me;
    }

    async sendMessage(
        chatId: number | string,
        text: string,
        options?: Opts<"sendMessage">,
    ): Promise<Message.TextMessage> {
        return this.callApi("sendMessage", () => this.bot.api.sendMessage(chatId, text, options));
    }

    async sendPhoto(
        chatId: number | string,
        photo: string | InputFile,
        options?: Opts<"sendPhoto">,
    ): Promise<Message.PhotoMessage> {
        return this.callApi("sendPhoto", () => this.bot.api.sendPhoto(chatId, photo, options));
    }

    async sendVideo(
        chatId: number | string,
        video: string | InputFile,
        options?: Opts<"sendVideo">,
    ): Promise<Message.VideoMessage> {
        return this.callApi("sendVideo", () => this.bot.api.sendVideo(chatId, video, options));
    }

    async sendAudio(
        chatId: number | string,
        audio: string | InputFile,
        options?: Opts<"sendAudio">,
    ): Promise<Message.AudioMessage> {
        return this.callApi("sendAudio", () => this.bot.api.sendAudio(chatId, audio, options));
    }

    async sendDocument(
        chatId: number | string,
        document: string | InputFile,
        options?: Opts<"sendDocument">,
    ): Promise<Message.DocumentMessage> {
        return this.callApi("sendDocument", () =>
            this.bot.api.sendDocument(chatId, document, options),
        );
    }

    async editMessageText(
        chatId: number | string,
        messageId: number,
        text: string,
        options?: Opts<"editMessageText">,
    ): Promise<true | (Message.CommonMessage & { edit_date: number })> {
        return this.callApi("editMessageText", () =>
            this.bot.api.editMessageText(chatId, messageId, text, options),
        );
    }

    async deleteMessage(chatId: number | string, messageId: number): Promise<boolean> {
        return this.callApi("deleteMessage", () => this.bot.api.deleteMessage(chatId, messageId));
    }

    async getChat(chatId: number | string): Promise<ChatFullInfo> {
        return this.callApi("getChat", () => this.bot.api.getChat(chatId));
    }

    async getChatMember(chatId: number | string, userId: number): Promise<ChatMember> {
        return this.callApi("getChatMember", () => this.bot.api.getChatMember(chatId, userId));
    }

    async getChatAdministrators(
        chatId: number | string,
    ): Promise<(ChatMemberOwner | ChatMemberAdministrator)[]> {
        return this.callApi("getChatAdministrators", () =>
            this.bot.api.getChatAdministrators(chatId),
        );
    }

    async getChatMemberCount(chatId: number | string): Promise<number> {
        return this.callApi("getChatMemberCount", () => this.bot.api.getChatMemberCount(chatId));
    }

    async banChatMember(
        chatId: number | string,
        userId: number,
        options?: Opts<"banChatMember">,
    ): Promise<boolean> {
        return this.callApi("banChatMember", () =>
            this.bot.api.banChatMember(chatId, userId, options),
        );
    }

    async unbanChatMember(
        chatId: number | string,
        userId: number,
        options?: Opts<"unbanChatMember">,
    ): Promise<boolean> {
        return this.callApi("unbanChatMember", () =>
            this.bot.api.unbanChatMember(chatId, userId, options),
        );
    }

    async leaveChat(chatId: number | string): Promise<boolean> {
        return this.callApi("leaveChat", () => this.bot.api.leaveChat(chatId));
    }

    /** 获取原生 grammY Bot，调用方仍应通过 callApi 建立错误边界。 */
    getBot(): Bot {
        return this.bot;
    }
}
