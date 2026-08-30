import { EventEmitter } from "node:events";
import { timingSafeEqual } from "node:crypto";
import { Bot, InputFile } from "grammy";
import type { Message, Opts } from "grammy/types";
import type { Update } from "grammy/types";
import type {
    UserFromGetMe,
    ChatFullInfo,
    ChatMember,
    ChatMemberOwner,
    ChatMemberAdministrator,
} from "grammy/types";
import { createProxyAgent, emitAllAwaited, FailureCollector, ReliableEventIngress } from "onebots";
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
import { acceptTelegramHttp } from "./webhook.js";
import { installTelegramLegacyEventHandlers } from "./legacy-events.js";

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
    guest_message: [message: TelegramMessage];
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
    private readonly updateIngress = new ReliableEventIngress<number>();

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
        // 完整 Update 先进入统一投影，避免 Bot 与 Adapter 维护两套事件分支。
        this.bot.use(async (ctx, next) => {
            await this.dispatchUpdate(ctx.update, next);
        });
        installTelegramLegacyEventHandlers(this.bot, {
            getSelfId: () => this.me?.id,
            privateMessage: message => emitAllAwaited(this, "private_message", message),
            groupMessage: message => emitAllAwaited(this, "group_message", message),
            channelMessage: message => emitAllAwaited(this, "channel_message", message),
            guestMessage: message => emitAllAwaited(this, "guest_message", message),
            editedMessage: message => emitAllAwaited(this, "message_edited", message),
            callbackQuery: query => emitAllAwaited(this, "callback_query", query),
        });
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
                await this.ensureBotInited();
                this.me = this.bot.botInfo;
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
        const pollingTask = this.pollingTask;
        this.generation += 1;
        this.running = false;
        this.startPromise = undefined;
        this.pollingAbort?.abort();
        this.pollingAbort = undefined;
        this.pollingTask = undefined;
        const failures = new FailureCollector();
        try {
            if (this.initialized && wasActive) {
                if (this.receiveConfig.mode === "webhook") {
                    await failures.capture(async () => {
                        await this.callApi("deleteWebhook", () => this.bot.api.deleteWebhook());
                    });
                }
            }
            await failures.capture(() => pollingTask);
            if (wasActive) {
                if (this.receiveConfig.mode === "polling") {
                    await failures.capture(() =>
                        emitAllAwaited(this, "transport_state", "stopped"),
                    );
                }
                await failures.capture(() => emitAllAwaited(this, "stopped"));
            }
            failures.throwIfAny("Telegram 客户端停止期间发生多个错误");
        } catch (error) {
            const wrapped = TelegramError.wrap(error, "TELEGRAM_STOP_FAILED", "stop");
            this.emit("client_error", wrapped);
            throw wrapped;
        }
    }

    async ingest(rawEvent: unknown): Promise<Update> {
        if (!isTelegramUpdate(rawEvent)) {
            throw TelegramError.invalid(
                "Telegram Update 必须包含整数 update_id",
                "TELEGRAM_UPDATE_INVALID",
            );
        }
        await this.ensureBotInited();
        const update = rawEvent;
        await this.handleUpdate(update);
        return update;
    }

    acceptHttp(request: Request): Promise<Response> {
        return acceptTelegramHttp(this, request);
    }

    private async ensureBotInited(): Promise<void> {
        await this.initBot();
        if (this.bot.isInited()) {
            this.me = this.bot.botInfo;
            return;
        }
        if (this.botInitPromise) return this.botInitPromise;
        const initialize = this.callApi("getMe", () => this.bot.init());
        this.botInitPromise = initialize;
        try {
            await initialize;
            this.me = this.bot.botInfo;
        } finally {
            if (this.botInitPromise === initialize) this.botInitPromise = undefined;
        }
    }

    private async dispatchUpdate(
        update: Update,
        next: () => Promise<void> = async () => undefined,
    ): Promise<boolean> {
        await emitAllAwaited(this, "raw_update", update);
        return this.updateIngress.deliver(update.update_id, async () => {
            await emitAllAwaited(this, "update", update);
            await next();
        });
    }

    private async handleUpdate(update: Update): Promise<void> {
        try {
            await this.bot.handleUpdate(update);
        } catch (error) {
            const wrapped = TelegramError.wrap(error, "TELEGRAM_UPDATE_HANDLER_ERROR");
            this.emit("client_error", wrapped);
            throw wrapped;
        }
    }

    private async runPolling(generation: number, signal: AbortSignal): Promise<void> {
        const receiveConfig = this.receiveConfig;
        if (receiveConfig.mode !== "polling") return;
        const pollingOptions = receiveConfig.options;
        let clearWebhook = true;
        let offset: number | undefined;
        let attempt = 0;
        let connected = false;
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
                if (!connected) {
                    this.emit("transport_state", "connected");
                    connected = true;
                }
                const updates = await this.callApi("getUpdates", () =>
                    this.bot.api.getUpdates(
                        {
                            ...pollingOptions,
                            timeout: pollingOptions.timeout ?? 30,
                            limit: pollingOptions.limit ?? 100,
                            offset,
                        },
                        signal as Parameters<typeof this.bot.api.getUpdates>[1],
                    ),
                );
                attempt = 0;
                for (const update of updates) {
                    if (generation !== this.generation || signal.aborted) return;
                    await this.handleUpdate(update);
                    offset = update.update_id + 1;
                }
            } catch (error) {
                if (generation !== this.generation || signal.aborted) return;
                if (
                    !(error instanceof TelegramError) ||
                    error.code !== "TELEGRAM_UPDATE_HANDLER_ERROR"
                ) {
                    this.emit(
                        "client_error",
                        TelegramError.wrap(error, "TELEGRAM_POLLING_FAILED", "getUpdates"),
                    );
                }
                connected = false;
                this.emit("transport_state", "reconnecting");
                attempt += 1;
                await abortableDelay(pollingRetryDelay(attempt), signal);
            }
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
