/**
 * Telegram 适配器
 * 继承 Adapter 基类，实现 Telegram 平台功能
 */
import { Account, AdapterRegistry, AccountStatus, unixSecondsToEventMs } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { TelegramBot } from "./bot.js";
import { CommonEvent, type CommonTypes } from "onebots";
import type { TelegramConfig } from "./types.js";

export class TelegramAdapter extends Adapter<TelegramBot, "telegram"> {
    constructor(app: BaseApp) {
        super(app, "telegram");
        this.icon = "https://telegram.org/favicon.ico";
    }

    // ============================================
    // 消息相关方法
    // ============================================

    /**
     * 发送消息
     */
    async sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const { scene_type, message } = params;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);

        // 解析消息内容
        let text = '';
        const options: any = {};

        for (const seg of message) {
            if (typeof seg === 'string') {
                text += seg;
            } else if (seg.type === 'text') {
                text += seg.data.text || '';
            } else if (seg.type === 'at') {
                const userId = seg.data.qq || seg.data.id || seg.data.user_id;
                if (userId === 'all') {
                    text += '@all ';
                } else {
                    text += `@${userId} `;
                }
            } else if (seg.type === 'image') {
                // 图片需要单独发送
                if (seg.data.url || seg.data.file) {
                    const photo = seg.data.url || seg.data.file;
                    const chatId = sceneId.string;
                    const result = await bot.sendPhoto(chatId, photo, {
                        caption: text || undefined,
                    });
                    return {
                        message_id: this.createId(result.message_id.toString()),
                    };
                }
            } else if (seg.type === 'video') {
                if (seg.data.url || seg.data.file) {
                    const video = seg.data.url || seg.data.file;
                    const chatId = sceneId.string;
                    const result = await bot.sendVideo(chatId, video, {
                        caption: text || undefined,
                    });
                    return {
                        message_id: this.createId(result.message_id.toString()),
                    };
                }
            } else if (seg.type === 'audio') {
                if (seg.data.url || seg.data.file) {
                    const audio = seg.data.url || seg.data.file;
                    const chatId = sceneId.string;
                    const result = await bot.sendAudio(chatId, audio, {
                        caption: text || undefined,
                    });
                    return {
                        message_id: this.createId(result.message_id.toString()),
                    };
                }
            } else if (seg.type === 'file') {
                if (seg.data.url || seg.data.file) {
                    const document = seg.data.url || seg.data.file;
                    const chatId = sceneId.string;
                    const result = await bot.sendDocument(chatId, document, {
                        caption: text || undefined,
                    });
                    return {
                        message_id: this.createId(result.message_id.toString()),
                    };
                }
            }
        }

        // 发送文本消息
        const chatId = sceneId.string;
        const result = await bot.sendMessage(chatId, text, options);

        return {
            message_id: this.createId(result.message_id.toString()),
        };
    }

    /**
     * 删除/撤回消息
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msgId = parseInt(this.coerceId(params.message_id as CommonTypes.Id | string | number).string, 10);
        const chatId = params.scene_id != null ? this.coerceId(params.scene_id as CommonTypes.Id | string | number).string : '';

        if (chatId) {
            await bot.deleteMessage(chatId, msgId);
        }
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        // Telegram Bot API 不直接支持获取消息，需要通过其他方式
        // 这里返回一个占位实现
        throw new Error('Telegram Bot API 不支持直接获取消息');
    }

    /**
     * 更新消息
     */
    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msgId = parseInt(this.coerceId(params.message_id as CommonTypes.Id | string | number).string, 10);
        const rawScene = (params as Adapter.UpdateMessageParams & { scene_id?: CommonTypes.Id | string | number }).scene_id;
        const chatId = rawScene != null ? this.coerceId(rawScene as CommonTypes.Id | string | number).string : '';

        // 解析消息内容
        let text = '';
        for (const seg of params.message) {
            if (typeof seg === 'string') {
                text += seg;
            } else if (seg.type === 'text') {
                text += seg.data.text || '';
            }
        }

        if (chatId) {
            await bot.editMessageText(chatId, msgId, text);
        }
    }

    // ============================================
    // 用户相关方法
    // ============================================

    /**
     * 获取机器人自身信息
     */
    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const me = await bot.getMe();

        return {
            user_id: this.createId(me.id.toString()),
            user_name: me.username || '',
            user_displayname: me.first_name || '',
            avatar: undefined,
        };
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        // Telegram Bot API 不直接支持获取用户信息
        // 这里返回一个占位实现
        throw new Error('Telegram Bot API 不支持直接获取用户信息');
    }

    // ============================================
    // 好友（私聊会话）相关方法
    // ============================================

    /**
     * 获取好友列表（Telegram 不支持）
     */
    async getFriendList(uin: string, params?: Adapter.GetFriendListParams): Promise<Adapter.FriendInfo[]> {
        // Telegram Bot API 不提供好友列表
        return [];
    }

    /**
     * 获取好友信息
     */
    async getFriendInfo(uin: string, params: Adapter.GetFriendInfoParams): Promise<Adapter.FriendInfo> {
        // Telegram Bot API 不直接支持获取好友信息
        throw new Error('Telegram Bot API 不支持直接获取好友信息');
    }

    // ============================================
    // 群组相关方法
    // ============================================

    /**
     * 获取群列表（Telegram 不支持）
     */
    async getGroupList(uin: string, params?: Adapter.GetGroupListParams): Promise<Adapter.GroupInfo[]> {
        // Telegram Bot API 不提供群列表
        return [];
    }

    /**
     * 获取群信息
     */
    async getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const chatId = params.group_id.string;
        const chat = await bot.getChat(chatId);

        return {
            group_id: this.createId(chat.id.toString()),
            group_name: chat.title || chat.username || '',
        };
    }

    /**
     * 退出群组
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.leaveChat(params.group_id.string);
    }

    /**
     * 获取群成员列表
     */
    async getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const chatId = params.group_id.string;
        const administrators = await bot.getChatAdministrators(chatId);

        return administrators.map((admin: any) => ({
            group_id: params.group_id,
            user_id: this.createId(admin.user.id.toString()),
            user_name: admin.user.username || '',
            card: admin.user.first_name || '',
            role: admin.status === 'creator' ? 'owner' : 'admin',
        }));
    }

    /**
     * 获取群成员信息
     */
    async getGroupMemberInfo(uin: string, params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const chatId = params.group_id.string;
        const userId = parseInt(params.user_id.string);
        const member = await bot.getChatMember(chatId, userId);

        return {
            group_id: params.group_id,
            user_id: this.createId(member.user.id.toString()),
            user_name: member.user.username || '',
            card: member.user.first_name || '',
            role: member.status === 'creator' ? 'owner' : member.status === 'administrator' ? 'admin' : 'member',
        };
    }

    /**
     * 踢出群成员
     */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const chatId = params.group_id.string;
        const userId = parseInt(params.user_id.string);
        await bot.banChatMember(chatId, userId);
    }

    /**
     * 设置群名片（Telegram 不支持）
     */
    async setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        // Telegram Bot API 不支持设置群名片
        throw new Error('Telegram Bot API 不支持设置群名片');
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: 'onebots Telegram Adapter',
            app_version: '1.0.0',
            impl: 'telegram',
            version: '1.0.0',
        };
    }

    /**
     * 获取运行状态
     */
    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        return {
            online: account?.status === AccountStatus.Online,
            good: account?.status === AccountStatus.Online,
        };
    }

    // ============================================
    // 账号创建
    // ============================================

    createAccount(config: Account.Config<'telegram'>): Account<'telegram', TelegramBot> {
        const telegramConfig: TelegramConfig = {
            account_id: config.account_id,
            token: config.token,
            webhook: config.webhook,
            polling: config.polling || { enabled: true },
            proxy: config.proxy,
        };

        const bot = new TelegramBot(telegramConfig);
        const account = new Account<'telegram', TelegramBot>(this, bot, config);

        // Webhook 模式：按 bot 注册独立 webhook 路径，供 Telegram 服务器 POST 推送
        if (telegramConfig.webhook?.url) {
            this.app.router.post(`${account.path}/webhook`, async (ctx: import('onebots').RouterContext) => {
                const secretHeader = ctx.request.headers['x-telegram-bot-api-secret-token'] as string | undefined;
                if (!bot.verifyWebhookSecret(secretHeader)) {
                    ctx.status = 401;
                    ctx.body = { ok: false };
                    return;
                }
                try {
                    await bot.handleWebhookUpdate(ctx.request.body);
                    ctx.status = 200;
                    ctx.body = { ok: true };
                } catch (e) {
                    this.logger.error(`Telegram webhook ${config.account_id} 处理失败:`, e);
                    ctx.status = 500;
                    ctx.body = { ok: false };
                }
            });
            this.logger.info(`Telegram Bot ${config.account_id} Webhook 路径: ${account.path}/webhook`);
        }

        // 监听 Bot 事件
        bot.on('ready', () => {
            this.logger.info(`Telegram Bot ${config.account_id} 已就绪`);
        });

        bot.on('error', (error) => {
            this.logger.error(`Telegram Bot ${config.account_id} 错误:`, error);
        });

        // 监听私聊消息
        bot.on('private_message', (event: any) => {
            // 忽略自己发送的消息
            const me = bot.getCachedMe();
            if (me && event.from?.id === me.id) return;

            // 打印消息接收日志
            const content = event.text || event.caption || '';
            const contentPreview = content.length > 100 ? content.substring(0, 100) + '...' : content;
            this.logger.info(
                `[Telegram] 收到私聊消息 | 消息ID: ${event.message_id} | ` +
                `发送者: ${event.from?.username || event.from?.first_name || event.from?.id} | 内容: ${contentPreview}`
            );

            // 构建消息段
            const messageSegments: any[] = [];
            
            if (event.text) {
                messageSegments.push({
                    type: 'text',
                    data: { text: event.text },
                });
            } else if (event.caption) {
                messageSegments.push({
                    type: 'text',
                    data: { text: event.caption },
                });
            }

            if (event.photo) {
                const photo = event.photo[event.photo.length - 1]; // 取最大尺寸
                messageSegments.push({
                    type: 'image',
                    data: { url: photo.file_id },
                });
            }

            if (event.video) {
                messageSegments.push({
                    type: 'video',
                    data: { url: event.video.file_id },
                });
            }

            if (event.audio) {
                messageSegments.push({
                    type: 'audio',
                    data: { url: event.audio.file_id },
                });
            }

            if (event.document) {
                messageSegments.push({
                    type: 'file',
                    data: { url: event.document.file_id },
                });
            }

            // 转换为 CommonEvent 格式
            const commonEvent: CommonEvent.Message = {
                id: this.createId(event.message_id.toString()),
                timestamp: unixSecondsToEventMs(event.date),
                platform: 'telegram',
                bot_id: this.createId(config.account_id),
                type: 'message',
                message_type: 'private',
                sender: {
                    id: this.createId(event.from?.id.toString() || ''),
                    name: event.from?.username || event.from?.first_name || '',
                    avatar: undefined,
                },
                message_id: this.createId(event.message_id.toString()),
                raw_message: event.text || event.caption || '',
                message: messageSegments,
            };

            // 派发到协议层
            account.dispatch(commonEvent);
        });

        // 监听群组消息
        bot.on('group_message', (event: any) => {
            // 忽略自己发送的消息
            const me = bot.getCachedMe();
            if (me && event.from?.id === me.id) return;

            // 打印消息接收日志
            const content = event.text || event.caption || '';
            const contentPreview = content.length > 100 ? content.substring(0, 100) + '...' : content;
            const chatId = event.chat?.id || '';
            this.logger.info(
                `[Telegram] 收到群组消息 | 消息ID: ${event.message_id} | 群组: ${chatId} | ` +
                `发送者: ${event.from?.username || event.from?.first_name || event.from?.id} | 内容: ${contentPreview}`
            );

            // 构建消息段（与私聊相同逻辑）
            const messageSegments: any[] = [];
            
            if (event.text) {
                messageSegments.push({
                    type: 'text',
                    data: { text: event.text },
                });
            } else if (event.caption) {
                messageSegments.push({
                    type: 'text',
                    data: { text: event.caption },
                });
            }

            if (event.photo) {
                const photo = event.photo[event.photo.length - 1];
                messageSegments.push({
                    type: 'image',
                    data: { url: photo.file_id },
                });
            }

            if (event.video) {
                messageSegments.push({
                    type: 'video',
                    data: { url: event.video.file_id },
                });
            }

            if (event.audio) {
                messageSegments.push({
                    type: 'audio',
                    data: { url: event.audio.file_id },
                });
            }

            if (event.document) {
                messageSegments.push({
                    type: 'file',
                    data: { url: event.document.file_id },
                });
            }

            // 转换为 CommonEvent 格式
            const commonEvent: CommonEvent.Message = {
                id: this.createId(event.message_id.toString()),
                timestamp: unixSecondsToEventMs(event.date),
                platform: 'telegram',
                bot_id: this.createId(config.account_id),
                type: 'message',
                message_type: 'group',
                sender: {
                    id: this.createId(event.from?.id.toString() || ''),
                    name: event.from?.username || event.from?.first_name || '',
                    avatar: undefined,
                },
                group: {
                    id: this.createId(event.chat?.id.toString() || ''),
                    name: event.chat?.title || event.chat?.username || '',
                },
                message_id: this.createId(event.message_id.toString()),
                raw_message: event.text || event.caption || '',
                message: messageSegments,
            };

            // 派发到协议层
            account.dispatch(commonEvent);
        });

        // 启动时初始化 Bot
        account.on('start', async () => {
            try {
                await bot.start();
                account.status = AccountStatus.Online;
                const me = bot.getCachedMe();
                account.nickname = me?.username || me?.first_name || 'Telegram Bot';
                account.avatar = undefined;
            } catch (error) {
                this.logger.error(`启动 Telegram Bot 失败:`, error);
                account.status = AccountStatus.OffLine;
            }
        });

        account.on('stop', async () => {
            await bot.stop();
            account.status = AccountStatus.OffLine;
        });

        return account;
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            telegram: TelegramConfig;
        }
    }
}

AdapterRegistry.register('telegram', TelegramAdapter, {
    name: 'telegram',
    displayName: 'Telegram官方机器人',
    description: 'Telegram官方机器人适配器，支持私聊、群组和频道',
    icon: 'https://telegram.org/favicon.ico',
    homepage: 'https://telegram.org/',
    author: '凉菜',
});

