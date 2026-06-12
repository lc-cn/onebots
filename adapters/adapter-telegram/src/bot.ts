/**
 * Telegram Bot 客户端
 * 基于 grammy 封装
 */
import { EventEmitter } from 'events';
import { Bot, Context, InputFile, type PollingOptions } from 'grammy';
import type { Opts, MessageEntity } from 'grammy/types';
import type { Update } from 'grammy/types';
import type { UserFromGetMe, ChatFullInfo, ChatMember, ChatMemberOwner, ChatMemberAdministrator } from 'grammy/types';
import type { Message } from 'grammy/types';
import { buildProxyUrl, maskProxyUrl, createHttpsProxyAgent } from 'onebots';
import type { TelegramConfig, ProxyConfig, TelegramMessage } from './types.js';

export class TelegramBot extends EventEmitter {
    private bot!: Bot;
    private config: TelegramConfig;
    private me: UserFromGetMe | null = null;
    private initialized: boolean = false;
    /** grammy Bot 已 init（handleUpdate 前必须，仅 webhook 模式需在首请求时兜底） */
    private botInited: boolean = false;

    constructor(config: TelegramConfig) {
        super();
        this.config = config;
    }

    /**
     * 初始化 Bot（异步，支持代理配置）
     */
    private async initBot(): Promise<void> {
        if (this.initialized) return;
        
        const botConfig: ConstructorParameters<typeof Bot>[1] = {};
        
        const agent = await createHttpsProxyAgent(this.config.proxy);
        if (agent) {
            botConfig.client = {
                baseFetchConfig: {
                    agent: agent,
                    compress: true,
                },
            };
            console.log(`[Telegram] 已配置代理: ${this.config.proxy.url}`);
        } else {
            console.warn('[Telegram] 创建代理失败，将直接连接');
        }
        
        this.bot = new Bot(this.config.token, botConfig);
        this.setupEventHandlers();
        this.initialized = true;
    }

    /**
     * 设置事件处理器
     */
    private setupEventHandlers(): void {
        // 监听所有消息
        this.bot.on('message', async (ctx: Context) => {
            const message = ctx.message;
            if (!message) return;

            // 忽略自己发送的消息
            if (message.from?.is_bot && message.from.id === this.me?.id) return;

            // 转换消息格式
            const event = this.transformMessage(message, ctx);
            
            // 判断是私聊还是群组/频道
            if (message.chat.type === 'private') {
                this.emit('private_message', event);
            } else {
                this.emit('group_message', event);
            }
        });

        // 监听编辑的消息
        this.bot.on('edited_message', async (ctx: Context) => {
            const message = ctx.editedMessage;
            if (!message) return;

            const event = this.transformMessage(message, ctx);
            this.emit('message_edited', event);
        });

        // 监听频道消息
        this.bot.on('channel_post', async (ctx: Context) => {
            const message = ctx.channelPost;
            if (!message) return;

            const event = this.transformMessage(message, ctx);
            this.emit('channel_message', event);
        });

        // 监听回调查询（Inline Keyboard 按钮点击）
        this.bot.on('callback_query', async (ctx: Context) => {
            const query = ctx.callbackQuery;
            if (!query) return;

            this.emit('callback_query', {
                id: query.id,
                from: query.from,
                message: query.message,
                data: query.data,
                chat_instance: query.chat_instance,
            });
        });

        // 监听错误
        this.bot.catch((err) => {
            this.emit('error', err);
        });
    }

    /**
     * 转换消息为内部格式
     */
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
            caption_entities: (message as Message & { caption_entities?: MessageEntity[] }).caption_entities,
            _original: message,
            _ctx: ctx,
        } as TelegramMessage;
    }

    /**
     * 启动 Bot
     */
    async start(): Promise<void> {
        try {
            // 初始化 Bot（包含代理配置）
            await this.initBot();
            
            // 获取 Bot 信息
            this.me = await this.bot.api.getMe();
            
            // 根据配置选择启动方式
            if (this.config.webhook?.url) {
                // Webhook 模式：grammy 要求先 init 才能 handleUpdate
                if (typeof this.bot.init === 'function') {
                    await this.bot.init();
                    this.botInited = true;
                }
                await this.bot.api.setWebhook(this.config.webhook.url, {
                    secret_token: this.config.webhook.secret_token,
                    allowed_updates: this.config.webhook.allowed_updates,
                });
                this.emit('ready');
            } else if (this.config.polling?.enabled !== false) {
                // 轮询模式（默认）
                const pollingOptions: PollingOptions = {};
                if (this.config.polling?.allowed_updates) {
                    pollingOptions.allowed_updates = this.config.polling.allowed_updates;
                }
                await this.bot.start(pollingOptions);
                this.emit('ready');
            } else {
                throw new Error('必须启用 webhook 或 polling 模式之一');
            }
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * 停止 Bot
     */
    async stop(): Promise<void> {
        try {
            if (this.config.webhook?.url) {
                // Webhook 模式：删除 webhook
                await this.bot.api.deleteWebhook();
            } else {
                // 轮询模式：停止轮询
                await this.bot.stop();
            }
            
            this.emit('stopped');
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * 处理 Webhook 推送的 Update（由适配器在 POST 路由中调用）
     * @param update Telegram 推送的 Update 对象
     */
    async handleWebhookUpdate(update: Update): Promise<void> {
        if (!this.initialized) await this.initBot();
        // grammy 要求 bot 已 init 才能 handleUpdate（start() 未跑到时兜底，只 init 一次）
        if (!this.botInited && typeof this.bot.init === 'function') {
            await this.bot.init();
            this.botInited = true;
        }
        await this.bot.handleUpdate(update);
    }

    /**
     * 校验 Webhook secret_token（X-Telegram-Bot-Api-Secret-Token）
     */
    verifyWebhookSecret(headerToken: string | undefined): boolean {
        const expected = this.config.webhook?.secret_token;
        if (!expected) return true;
        return headerToken === expected;
    }

    /**
     * 获取缓存的 Bot 信息
     */
    getCachedMe(): UserFromGetMe | null {
        return this.me;
    }

    // ============================================
    // API 方法代理到 grammy
    // ============================================

    /**
     * 获取 Bot 信息
     */
    async getMe(): Promise<UserFromGetMe> {
        this.me = await this.bot.api.getMe();
        return this.me;
    }

    /**
     * 发送消息
     */
    async sendMessage(chatId: number | string, text: string, options?: Opts<"sendMessage">): Promise<Message.TextMessage> {
        return await this.bot.api.sendMessage(chatId, text, options);
    }

    /**
     * 发送图片
     */
    async sendPhoto(chatId: number | string, photo: string | InputFile, options?: Opts<"sendPhoto">): Promise<Message.PhotoMessage> {
        return await this.bot.api.sendPhoto(chatId, photo, options);
    }

    /**
     * 发送视频
     */
    async sendVideo(chatId: number | string, video: string | InputFile, options?: Opts<"sendVideo">): Promise<Message.VideoMessage> {
        return await this.bot.api.sendVideo(chatId, video, options);
    }

    /**
     * 发送音频
     */
    async sendAudio(chatId: number | string, audio: string | InputFile, options?: Opts<"sendAudio">): Promise<Message.AudioMessage> {
        return await this.bot.api.sendAudio(chatId, audio, options);
    }

    /**
     * 发送文档
     */
    async sendDocument(chatId: number | string, document: string | InputFile, options?: Opts<"sendDocument">): Promise<Message.DocumentMessage> {
        return await this.bot.api.sendDocument(chatId, document, options);
    }

    /**
     * 编辑消息
     */
    async editMessageText(chatId: number | string, messageId: number, text: string, options?: Opts<"editMessageText">): Promise<true | (Message.CommonMessage & { edit_date: number })> {
        return await this.bot.api.editMessageText(chatId, messageId, text, options);
    }

    /**
     * 删除消息
     */
    async deleteMessage(chatId: number | string, messageId: number): Promise<boolean> {
        return await this.bot.api.deleteMessage(chatId, messageId);
    }

    /**
     * 获取聊天信息
     */
    async getChat(chatId: number | string): Promise<ChatFullInfo> {
        return await this.bot.api.getChat(chatId);
    }

    /**
     * 获取聊天成员
     */
    async getChatMember(chatId: number | string, userId: number): Promise<ChatMember> {
        return await this.bot.api.getChatMember(chatId, userId);
    }

    /**
     * 获取聊天成员列表
     */
    async getChatAdministrators(chatId: number | string): Promise<(ChatMemberOwner | ChatMemberAdministrator)[]> {
        return await this.bot.api.getChatAdministrators(chatId);
    }

    /**
     * 获取聊天成员数量
     */
    async getChatMemberCount(chatId: number | string): Promise<number> {
        return await this.bot.api.getChatMemberCount(chatId);
    }

    /**
     * 踢出成员
     */
    async banChatMember(chatId: number | string, userId: number, options?: Opts<"banChatMember">): Promise<boolean> {
        return await this.bot.api.banChatMember(chatId, userId, options);
    }

    /**
     * 取消封禁成员
     */
    async unbanChatMember(chatId: number | string, userId: number, options?: Opts<"unbanChatMember">): Promise<boolean> {
        return await this.bot.api.unbanChatMember(chatId, userId, options);
    }

    /**
     * 离开群组
     */
    async leaveChat(chatId: number | string): Promise<boolean> {
        return await this.bot.api.leaveChat(chatId);
    }

    /**
     * 获取 Bot 实例（用于高级用法）
     */
    getBot(): Bot {
        return this.bot;
    }
}

