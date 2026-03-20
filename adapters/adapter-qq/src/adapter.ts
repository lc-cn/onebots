/**
 * QQ官方机器人适配器
 * 继承Adapter基类，实现QQ官方机器人的消息收发和管理功能
 */
import { Account, AdapterRegistry, AccountStatus } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { QQBot } from "./bot.js";
import { CommonEvent, type CommonTypes } from "onebots";
import type {
    QQConfig,
    QQMessageEvent,
    QQGroupMessageEvent,
    QQC2CMessageEvent,
    QQDirectMessageEvent,
    QQGuildEvent,
    QQChannelEvent,
    QQGuildMemberEvent,
    QQReactionEvent,
    QQInteractionEvent,
    SendMessageParams,
    ReceiverMode,
} from "./types.js";

export class QQAdapter extends Adapter<QQBot, "qq"> {
    constructor(app: BaseApp) {
        super(app, "qq");
        this.icon = "https://q.qq.com/favicon.ico";
    }

    // ============================================
    // 消息相关方法
    // ============================================

    /**
     * 发送消息
     * 支持群聊、私聊、频道和频道私信
     */
    async sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const { scene_type, message } = params;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);

        // 构建消息内容
        const content = this.buildMessageContent(message);
        const sendParams: SendMessageParams = { content };

        // 提取图片等附件
        const attachments = this.extractAttachments(message);
        if (attachments.image) {
            sendParams.image = attachments.image;
        }

        let result: any;
        
        switch (scene_type) {
            case "group":
                // QQ群消息
                result = await bot.sendGroupMessage(sceneId.string, {
                    ...sendParams,
                    msg_type: 0, // 文本消息
                });
                break;
                
            case "private":
                // 单聊消息 (C2C)
                result = await bot.sendC2CMessage(sceneId.string, {
                    ...sendParams,
                    msg_type: 0,
                });
                break;
                
            case "channel":
                // 频道消息
                result = await bot.sendChannelMessage(sceneId.string, sendParams);
                break;
                
            case "direct":
                // 频道私信
                result = await bot.sendDMSMessage(sceneId.string, sendParams);
                break;
                
            default:
                throw new Error(`不支持的消息场景类型: ${scene_type}`);
        }

        return {
            message_id: this.createId(result.id || result.message_id || Date.now().toString()),
        };
    }

    /**
     * 删除/撤回消息
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const messageId = this.coerceId(params.message_id as CommonTypes.Id | string | number).string;
        const sceneType = params.scene_type;
        const sceneId =
            params.scene_id != null ? this.coerceId(params.scene_id as CommonTypes.Id | string | number).string : undefined;

        if (!sceneId || !sceneType) {
            throw new Error("删除消息需要提供 scene_type 和 scene_id");
        }

        switch (sceneType) {
            case "channel":
                await bot.recallChannelMessage(sceneId, messageId);
                break;
            case "direct":
                await bot.recallDMSMessage(sceneId, messageId);
                break;
            default:
                throw new Error(`QQ官方API暂不支持撤回 ${sceneType} 类型的消息`);
        }
    }

    // ============================================
    // 用户相关方法
    // ============================================

    /**
     * 获取机器人信息
     */
    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const info = await bot.getSelfInfo();

        return {
            user_id: this.createId(info.id),
            user_name: info.username,
            avatar: info.avatar,
        };
    }

    // ============================================
    // 频道相关方法 (Guild/Channel)
    // ============================================

    /**
     * 获取频道列表
     */
    async getGuildList(uin: string): Promise<Adapter.GuildInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guilds = await bot.getGuilds();

        return guilds.map(guild => ({
            guild_id: this.createId(guild.id),
            guild_name: guild.name,
            guild_display_name: guild.name,
        }));
    }

    /**
     * 获取频道信息
     */
    async getGuildInfo(uin: string, params: Adapter.GetGuildInfoParams): Promise<Adapter.GuildInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guild = await bot.getGuild(params.guild_id.string);

        return {
            guild_id: this.createId(guild.id),
            guild_name: guild.name,
            guild_display_name: guild.name,
        };
    }

    /**
     * 获取子频道列表
     */
    async getChannelList(uin: string, params?: Adapter.GetChannelListParams): Promise<Adapter.ChannelInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        if (!params?.guild_id) {
            throw new Error("获取子频道列表需要提供 guild_id");
        }

        const bot = account.client;
        const channels = await bot.getChannels(params.guild_id.string);

        return channels.map(channel => ({
            channel_id: this.createId(channel.id),
            channel_name: channel.name,
            channel_type: channel.type,
            parent_id: channel.parent_id ? this.createId(channel.parent_id) : undefined,
        }));
    }

    /**
     * 获取子频道信息
     */
    async getChannelInfo(uin: string, params: Adapter.GetChannelInfoParams): Promise<Adapter.ChannelInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channel = await bot.getChannel(params.channel_id.string);

        return {
            channel_id: this.createId(channel.id),
            channel_name: channel.name,
            channel_type: channel.type,
            parent_id: channel.parent_id ? this.createId(channel.parent_id) : undefined,
        };
    }

    /**
     * 创建子频道
     */
    async createChannel(uin: string, params: Adapter.CreateChannelParams): Promise<Adapter.ChannelInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channel = await bot.createChannel(params.guild_id.string, {
            name: params.channel_name,
            type: params.channel_type || 0,
            parent_id: params.parent_id?.string,
        });

        return {
            channel_id: this.createId(channel.id),
            channel_name: channel.name,
            channel_type: channel.type,
            parent_id: channel.parent_id ? this.createId(channel.parent_id) : undefined,
        };
    }

    /**
     * 更新子频道
     */
    async updateChannel(uin: string, params: Adapter.UpdateChannelParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.updateChannel(params.channel_id.string, {
            name: params.channel_name,
            parent_id: params.parent_id?.string,
        });
    }

    /**
     * 删除子频道
     */
    async deleteChannel(uin: string, params: Adapter.DeleteChannelParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.deleteChannel(params.channel_id.string);
    }

    // ============================================
    // 频道成员相关方法
    // ============================================

    /**
     * 获取频道成员信息
     */
    async getGuildMemberInfo(uin: string, params: Adapter.GetGuildMemberInfoParams): Promise<Adapter.GuildMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const member = await bot.getGuildMember(params.guild_id.string, params.user_id.string);

        return {
            guild_id: params.guild_id,
            user_id: this.createId(member.user?.id || params.user_id.string),
            user_name: member.user?.username || '',
            nickname: member.nick,
            role: member.roles?.[0],
        };
    }

    /**
     * 踢出频道成员
     */
    async kickChannelMember(uin: string, params: Adapter.KickChannelMemberParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        // 由于QQ API需要guild_id，这里需要从某处获取
        // 暂时抛出错误
        throw new Error("踢出频道成员需要提供 guild_id，请使用 kickGuildMember 方法");
    }

    /**
     * 设置频道成员禁言
     */
    async setChannelMemberMute(uin: string, params: Adapter.SetChannelMemberMuteParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        // 由于QQ API需要guild_id，这里需要从某处获取
        throw new Error("设置频道成员禁言需要提供 guild_id，请使用 muteGuildMember 方法");
    }

    // ============================================
    // 扩展方法：频道成员管理（需要guild_id）
    // ============================================

    /**
     * 踢出频道成员（扩展）
     */
    async kickGuildMember(uin: string, guildId: string, userId: string, addBlacklist?: boolean): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.kickGuildMember(guildId, userId, addBlacklist);
    }

    /**
     * 禁言频道成员（扩展）
     */
    async muteGuildMember(uin: string, guildId: string, userId: string, duration: number): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.muteGuildMember(guildId, userId, undefined, duration.toString());
    }

    /**
     * 全员禁言（扩展）
     */
    async muteGuild(uin: string, guildId: string, duration: number): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.muteGuild(guildId, undefined, duration.toString());
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots-qq-adapter",
            app_version: "1.0.0",
            impl: "onebots",
            version: "1.0.0",
            onebot_version: "12",
        };
    }

    /**
     * 获取运行状态
     */
    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        return {
            online: account?.status === AccountStatus.Online,
            good: !!account,
        };
    }

    // ============================================
    // 辅助方法
    // ============================================

    /**
     * 构建消息内容
     */
    private buildMessageContent(message: any[]): string {
        const textParts: string[] = [];

        for (const seg of message) {
            if (typeof seg === 'string') {
                textParts.push(seg);
            } else if (seg.type === 'text') {
                textParts.push(seg.data.text || '');
            } else if (seg.type === 'at') {
                if (seg.data.qq === 'all') {
                    textParts.push('@everyone');
                } else {
                    textParts.push(`<@${seg.data.qq || seg.data.id}>`);
                }
            } else if (seg.type === 'face') {
                textParts.push(`<emoji:${seg.data.id}>`);
            }
        }

        return textParts.join('');
    }

    /**
     * 提取附件
     */
    private extractAttachments(message: any[]): { image?: string; file?: string } {
        const attachments: { image?: string; file?: string } = {};

        for (const seg of message) {
            if (seg.type === 'image') {
                attachments.image = seg.data.url || seg.data.file;
            } else if (seg.type === 'file') {
                attachments.file = seg.data.url || seg.data.file;
            }
        }

        return attachments;
    }

    /**
     * 解析消息内容为消息段
     */
    private parseMessageContent(content: string, attachments?: any[]): any[] {
        const segments: any[] = [];

        // 解析@
        let text = content.replace(/<@!?(\d+)>/g, (_, id) => {
            segments.push({ type: 'at', data: { qq: id } });
            return '';
        });

        // 解析emoji
        text = text.replace(/<emoji:(\d+)>/g, (_, id) => {
            segments.push({ type: 'face', data: { id } });
            return '';
        });

        // 剩余文本
        if (text.trim()) {
            segments.unshift({ type: 'text', data: { text: text.trim() } });
        }

        // 处理附件
        if (attachments) {
            for (const att of attachments) {
                if (att.content_type?.startsWith('image/')) {
                    segments.push({ type: 'image', data: { url: att.url } });
                }
            }
        }

        return segments;
    }

    // ============================================
    // 账号创建
    // ============================================

    createAccount(config: Account.Config<'qq'>): Account<'qq', QQBot> {
        const qqConfig: QQConfig = {
            account_id: config.account_id,
            appId: config.appId,
            secret: config.secret,
            token: config.token,
            sandbox: config.sandbox,
            intents: config.intents,
            removeAt: config.removeAt ?? true,
            maxRetry: config.maxRetry ?? 10,
            mode: config.mode ?? 'websocket',  // 默认使用WebSocket模式
        };

        const bot = new QQBot(qqConfig);
        const account = new Account<'qq', QQBot>(this, bot, config);

        // 如果是Webhook模式，注册Webhook路由
        if (qqConfig.mode === 'webhook') {
            this.app.router.all(`${account.path}/webhook`, bot.handleWebhook.bind(bot));
            this.logger.info(`QQ机器人 ${config.account_id} Webhook路径: ${account.path}/webhook`);
        }

        // 监听Bot事件
        bot.on('ready', (data) => {
            const modeText = qqConfig.mode === 'webhook' ? '(Webhook模式)' : '(WebSocket模式)';
            this.logger.info(`QQ机器人 ${config.account_id} 已连接 ${modeText}`);
            account.status = AccountStatus.Online;
            account.nickname = data.user?.username || 'QQ机器人';
            account.avatar = data.user?.avatar || this.icon;
        });

        bot.on('error', (error) => {
            this.logger.error(`QQ机器人 ${config.account_id} 错误:`, error);
        });

        bot.on('ws_close', (code, reason) => {
            this.logger.warn(`QQ机器人 ${config.account_id} 连接关闭: ${code} - ${reason}`);
            account.status = AccountStatus.OffLine;
        });

        bot.on('token_refreshed', () => {
            this.logger.debug(`Access Token 已刷新`);
        });

        // 监听频道消息事件
        bot.on('message.guild', (message: QQMessageEvent) => {
            this.handleGuildMessage(account, message, config.account_id);
        });

        // 监听频道私信事件
        bot.on('message.direct', (message: QQDirectMessageEvent) => {
            this.handleDirectMessage(account, message, config.account_id);
        });

        // 监听群消息事件
        bot.on('message.group', (message: QQGroupMessageEvent) => {
            this.handleGroupMessage(account, message, config.account_id);
        });

        // 监听私聊消息事件
        bot.on('message.private', (message: QQC2CMessageEvent) => {
            this.handleC2CMessage(account, message, config.account_id);
        });

        // 监听频道创建事件
        bot.on('GUILD_CREATE', (event: QQGuildEvent) => {
            this.handleGuildEvent(account, 'create', event, config.account_id);
        });

        // 监听频道更新事件
        bot.on('GUILD_UPDATE', (event: QQGuildEvent) => {
            this.handleGuildEvent(account, 'update', event, config.account_id);
        });

        // 监听频道删除事件
        bot.on('GUILD_DELETE', (event: QQGuildEvent) => {
            this.handleGuildEvent(account, 'delete', event, config.account_id);
        });

        // 监听子频道创建事件
        bot.on('CHANNEL_CREATE', (event: QQChannelEvent) => {
            this.handleChannelEvent(account, 'create', event, config.account_id);
        });

        // 监听子频道更新事件
        bot.on('CHANNEL_UPDATE', (event: QQChannelEvent) => {
            this.handleChannelEvent(account, 'update', event, config.account_id);
        });

        // 监听子频道删除事件
        bot.on('CHANNEL_DELETE', (event: QQChannelEvent) => {
            this.handleChannelEvent(account, 'delete', event, config.account_id);
        });

        // 监听成员增加事件
        bot.on('GUILD_MEMBER_ADD', (event: QQGuildMemberEvent) => {
            this.handleMemberEvent(account, 'add', event, config.account_id);
        });

        // 监听成员更新事件
        bot.on('GUILD_MEMBER_UPDATE', (event: QQGuildMemberEvent) => {
            this.handleMemberEvent(account, 'update', event, config.account_id);
        });

        // 监听成员移除事件
        bot.on('GUILD_MEMBER_REMOVE', (event: QQGuildMemberEvent) => {
            this.handleMemberEvent(account, 'remove', event, config.account_id);
        });

        // 监听表态事件
        bot.on('MESSAGE_REACTION_ADD', (event: QQReactionEvent) => {
            this.handleReactionEvent(account, 'add', event, config.account_id);
        });

        bot.on('MESSAGE_REACTION_REMOVE', (event: QQReactionEvent) => {
            this.handleReactionEvent(account, 'remove', event, config.account_id);
        });

        // 监听互动事件
        bot.on('INTERACTION_CREATE', (event: QQInteractionEvent) => {
            this.handleInteractionEvent(account, event, config.account_id);
        });

        // 账号生命周期
        account.on('start', async () => {
            try {
                await bot.start();
            } catch (error) {
                this.logger.error(`启动QQ机器人失败:`, error);
                account.status = AccountStatus.OffLine;
            }
        });

        account.on('stop', async () => {
            await bot.stop();
            account.status = AccountStatus.OffLine;
        });

        return account;
    }

    // ============================================
    // 事件处理方法
    // ============================================

    /**
     * 处理频道消息
     */
    private handleGuildMessage(account: Account<'qq', QQBot>, message: QQMessageEvent, accountId: string): void {
        // 打印消息接收日志
        const content = message.content || '';
        const contentPreview = content.length > 100 ? content.substring(0, 100) + '...' : content;
        this.logger.info(
            `[QQ] 收到频道消息 | 消息ID: ${message.id} | 频道: ${message.channel_id} | ` +
            `发送者: ${message.author.username}(${message.author.id}) | 内容: ${contentPreview}`
        );

        const messageSegments = this.parseMessageContent(message.content || '', message.attachments);

        const commonEvent: CommonEvent.Message = {
            id: this.createId(message.id),
            timestamp: new Date(message.timestamp).getTime(),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'message',
            message_type: 'channel',
            sender: {
                id: this.createId(message.author.id),
                name: message.author.username,
                avatar: message.author.avatar,
            },
            group: message.guild_id ? {
                id: this.createId(message.guild_id),
                name: '',
            } : undefined,
            message_id: this.createId(message.id),
            raw_message: message.content || '',
            message: messageSegments,
        };

        account.dispatch(commonEvent);
    }

    /**
     * 处理频道私信
     */
    private handleDirectMessage(account: Account<'qq', QQBot>, message: QQDirectMessageEvent, accountId: string): void {
        // 打印消息接收日志
        const content = message.content || '';
        const contentPreview = content.length > 100 ? content.substring(0, 100) + '...' : content;
        this.logger.info(
            `[QQ] 收到频道私信 | 消息ID: ${message.id} | ` +
            `发送者: ${message.author?.username || ''}(${message.author?.id || ''}) | 内容: ${contentPreview}`
        );

        const messageSegments = this.parseMessageContent(message.content || '', message.attachments);

        const commonEvent: CommonEvent.Message = {
            id: this.createId(message.id),
            timestamp: new Date(message.timestamp || Date.now()).getTime(),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'message',
            message_type: 'direct',
            sender: {
                id: this.createId(message.author?.id || ''),
                name: message.author?.username || '',
                avatar: message.author?.avatar,
            },
            message_id: this.createId(message.id),
            raw_message: message.content || '',
            message: messageSegments,
        };

        account.dispatch(commonEvent);
    }

    /**
     * 处理群消息
     */
    private handleGroupMessage(account: Account<'qq', QQBot>, message: QQGroupMessageEvent, accountId: string): void {
        // 打印消息接收日志
        const content = message.content || '';
        const contentPreview = content.length > 100 ? content.substring(0, 100) + '...' : content;
        this.logger.info(
            `[QQ] 收到群消息 | 消息ID: ${message.id} | 群: ${message.group_openid} | ` +
            `发送者: ${message.author.member_openid || message.author.id} | 内容: ${contentPreview}`
        );

        const messageSegments = this.parseMessageContent(message.content || '', message.attachments);

        const commonEvent: CommonEvent.Message = {
            id: this.createId(message.id),
            timestamp: new Date(message.timestamp).getTime(),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'message',
            message_type: 'group',
            sender: {
                id: this.createId(message.author.member_openid || message.author.id),
                name: message.author.member_openid || message.author.id,
            },
            group: {
                id: this.createId(message.group_openid),
                name: '',
            },
            message_id: this.createId(message.id),
            raw_message: message.content || '',
            message: messageSegments,
        };

        account.dispatch(commonEvent);
    }

    /**
     * 处理私聊消息 (C2C)
     */
    private handleC2CMessage(account: Account<'qq', QQBot>, message: QQC2CMessageEvent, accountId: string): void {
        // 打印消息接收日志
        const content = message.content || '';
        const contentPreview = content.length > 100 ? content.substring(0, 100) + '...' : content;
        this.logger.info(
            `[QQ] 收到私聊消息 | 消息ID: ${message.id} | ` +
            `发送者: ${message.author.user_openid || message.author.id} | 内容: ${contentPreview}`
        );

        const messageSegments = this.parseMessageContent(message.content || '', message.attachments);

        const commonEvent: CommonEvent.Message = {
            id: this.createId(message.id),
            timestamp: new Date(message.timestamp).getTime(),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'message',
            message_type: 'private',
            sender: {
                id: this.createId(message.author.user_openid || message.author.id),
                name: message.author.user_openid || message.author.id,
            },
            message_id: this.createId(message.id),
            raw_message: message.content || '',
            message: messageSegments,
        };

        account.dispatch(commonEvent);
    }

    /**
     * 处理频道事件
     */
    private handleGuildEvent(account: Account<'qq', QQBot>, action: string, event: QQGuildEvent, accountId: string): void {
        const commonEvent: CommonEvent.Notice = {
            id: this.createId(event.id),
            timestamp: Date.now(),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'notice',
            notice_type: 'custom',
            sub_type: `guild_${action}`,
            group: {
                id: this.createId(event.id),
                name: event.name,
            },
        };

        account.dispatch(commonEvent);
    }

    /**
     * 处理子频道事件
     */
    private handleChannelEvent(account: Account<'qq', QQBot>, action: string, event: QQChannelEvent, accountId: string): void {
        const commonEvent: CommonEvent.Notice = {
            id: this.createId(event.id),
            timestamp: Date.now(),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'notice',
            notice_type: 'custom',
            sub_type: `channel_${action}`,
            group: {
                id: this.createId(event.guild_id),
                name: '',
            },
            channel_id: event.id,
            channel_name: event.name,
        };

        account.dispatch(commonEvent);
    }

    /**
     * 处理成员事件
     */
    private handleMemberEvent(account: Account<'qq', QQBot>, action: string, event: QQGuildMemberEvent, accountId: string): void {
        let noticeType: CommonEvent.NoticeType = 'custom';
        
        if (action === 'add') {
            noticeType = 'group_increase';
        } else if (action === 'remove') {
            noticeType = 'group_decrease';
        }

        const commonEvent: CommonEvent.Notice = {
            id: this.createId(Date.now().toString()),
            timestamp: event.joined_at ? new Date(event.joined_at).getTime() : Date.now(),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'notice',
            notice_type: noticeType,
            sub_type: action,
            user: {
                id: this.createId(event.user.id),
                name: event.user.username,
                avatar: event.user.avatar,
            },
            group: {
                id: this.createId(event.guild_id),
                name: '',
            },
        };

        if (event.op_user_id) {
            commonEvent.operator = {
                id: this.createId(event.op_user_id),
                name: '',
            };
        }

        account.dispatch(commonEvent);
    }

    /**
     * 处理表态事件
     */
    private handleReactionEvent(account: Account<'qq', QQBot>, action: string, event: QQReactionEvent, accountId: string): void {
        const commonEvent: CommonEvent.Notice = {
            id: this.createId(Date.now().toString()),
            timestamp: Date.now(),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'notice',
            notice_type: 'custom',
            sub_type: `reaction_${action}`,
            user: {
                id: this.createId(event.user_id),
                name: '',
            },
            group: {
                id: this.createId(event.guild_id),
                name: '',
            },
            message_id: event.target.id,
            emoji_id: event.emoji.id,
            emoji_type: event.emoji.type,
        };

        account.dispatch(commonEvent);
    }

    /**
     * 处理互动事件
     */
    private handleInteractionEvent(account: Account<'qq', QQBot>, event: QQInteractionEvent, accountId: string): void {
        const commonEvent: CommonEvent.Notice = {
            id: this.createId(event.id),
            timestamp: new Date(event.timestamp).getTime(),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'notice',
            notice_type: 'custom',
            sub_type: 'interaction',
            interaction_type: event.type,
            scene: event.scene,
            chat_type: event.chat_type,
            button_id: event.data?.resolved?.button_id,
            button_data: event.data?.resolved?.button_data,
        };

        if (event.user_openid) {
            commonEvent.user = {
                id: this.createId(event.user_openid),
                name: '',
            };
        }

        if (event.group_openid) {
            commonEvent.group = {
                id: this.createId(event.group_openid),
                name: '',
            };
        }

        account.dispatch(commonEvent);
    }
}

// 声明模块扩展
declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            qq: QQConfig;
        }
    }
}

// 注册适配器
AdapterRegistry.register('qq', QQAdapter, {
    name: 'qq',
    displayName: 'QQ官方机器人',
    description: 'QQ官方机器人适配器，支持频道、群聊和私聊',
    icon: 'https://q.qq.com/favicon.ico',
    homepage: 'https://bot.q.qq.com/wiki',
    author: '凉菜',
});
