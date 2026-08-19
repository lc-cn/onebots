/**
 * QQ 官方机器人适配器
 *
 * v4 重大变更：不再自带 bot 实现，直接依赖 `qq-official-bot` SDK。
 * SDK Bot 实例直接作为 Account.client 暴露给上层；adapter 只负责：
 *   1. 把用户配置转换为 SDK BotConfig
 *   2. 监听 SDK 事件并翻译为 CommonEvent.Message / CommonEvent.Notice
 *   3. 把 OneBot/Satori 协议层的 sendMessage/deleteMessage 等调用路由到 SDK
 */
import {
    Bot,
    ReceiverMode,
    segment,
    type Sendable,
    type MessageElem,
    type GuildMessageEvent,
    type GroupMessageEvent,
    type PrivateMessageEvent,
    type GuildChangeNoticeEvent,
    type ChannelChangeNoticeEvent,
    type GuildMemberChangeNoticeEvent,
    type MessageReactionNoticeEvent,
    type GuildActionNoticeEvent,
    type GroupActionNoticeEvent,
    type GroupJoinRequestNoticeEvent,
} from 'qq-official-bot';
import { Account, AdapterRegistry, AccountStatus, dateLikeToEventMs } from 'onebots';
import { Adapter } from 'onebots';
import { BaseApp } from 'onebots';
import { CommonEvent, type CommonTypes } from 'onebots';
import type { QQConfig } from './types.js';
import { mapIntents } from './intents.js';

/** 默认 API 根地址（与 SDK 默认对齐） */
const DEFAULT_API_BASE_URL = 'https://api.bot.qq.com';
const SANDBOX_API_BASE_URL = 'https://sandbox.api.sgroup.qq.com';

export class QQAdapter extends Adapter<Bot, 'qq'> {
    constructor(app: BaseApp) {
        super(app, 'qq');
        this.icon = 'https://q.qq.com/favicon.ico';
    }

    // ============================================
    // 消息发送 / 撤回
    // ============================================

    async sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number).string;
        const sendable = this.buildSendable(params.message);

        let res: { id?: string } | undefined;
        switch (params.scene_type) {
            case 'group':
                res = await bot.group(sceneId).send(sendable);
                break;
            case 'private':
                res = await bot.user(sceneId).send(sendable);
                break;
            case 'channel':
                res = await bot.channel(sceneId).send(sendable);
                break;
            case 'direct':
                res = await bot.direct(sceneId).send(sendable);
                break;
            default:
                throw new Error(`不支持的消息场景类型: ${params.scene_type}`);
        }

        return {
            message_id: this.createId(res?.id ?? Date.now().toString()),
        };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const messageId = this.coerceId(params.message_id as CommonTypes.Id | string | number).string;
        const sceneType = params.scene_type;
        const sceneId = params.scene_id != null
            ? this.coerceId(params.scene_id as CommonTypes.Id | string | number).string
            : undefined;

        if (!sceneId || !sceneType) {
            throw new Error('删除消息需要提供 scene_type 和 scene_id');
        }

        switch (sceneType) {
            case 'channel':
                await bot.channel(sceneId).recall(messageId);
                break;
            case 'direct':
                await bot.direct(sceneId).recall(messageId);
                break;
            case 'group':
                await bot.group(sceneId).recall(messageId);
                break;
            case 'private':
                await bot.user(sceneId).recall(messageId);
                break;
            default:
                throw new Error(`QQ官方API暂不支持撤回 ${sceneType} 类型的消息`);
        }
    }

    // ============================================
    // 用户/频道查询
    // ============================================

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const info = await account.client.getSelfInfo();
        return {
            user_id: this.createId(info.id),
            user_name: info.username,
            avatar: info.avatar,
        };
    }

    async getGuildList(uin: string): Promise<Adapter.GuildInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const guilds = await account.client.getGuildList();
        return guilds.map((g) => ({
            guild_id: this.createId(g.guild_id),
            guild_name: g.guild_name,
            guild_display_name: g.guild_name,
        }));
    }

    async getGuildInfo(uin: string, params: Adapter.GetGuildInfoParams): Promise<Adapter.GuildInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const g = await account.client.guild(params.guild_id.string).info();
        return {
            guild_id: this.createId(g.guild_id),
            guild_name: g.guild_name,
            guild_display_name: g.guild_name,
        };
    }

    async getChannelList(uin: string, params?: Adapter.GetChannelListParams): Promise<Adapter.ChannelInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        if (!params?.guild_id) throw new Error('获取子频道列表需要提供 guild_id');
        const list = await account.client.getChannelList(params.guild_id.string);
        return list.map((c) => ({
            channel_id: this.createId(c.channel_id),
            channel_name: c.channel_name,
            channel_type: c.channel_type,
        }));
    }

    async getChannelInfo(uin: string, params: Adapter.GetChannelInfoParams): Promise<Adapter.ChannelInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const c = await account.client.getChannelInfo(params.channel_id.string);
        return {
            channel_id: this.createId(c.channel_id),
            channel_name: c.channel_name,
            channel_type: c.channel_type,
        };
    }

    async createChannel(uin: string, params: Adapter.CreateChannelParams): Promise<Adapter.ChannelInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const ch = await account.client.createChannel(params.guild_id.string, {
            name: params.channel_name,
            type: params.channel_type ?? 0,
            parent_id: params.parent_id?.string,
        } as any);
        return {
            channel_id: this.createId(ch.id),
            channel_name: ch.name,
            channel_type: ch.type as number,
            parent_id: ch.parent_id ? this.createId(ch.parent_id) : undefined,
        };
    }

    async updateChannel(uin: string, params: Adapter.UpdateChannelParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        await account.client.updateChannel(params.channel_id.string, {
            name: params.channel_name,
            parent_id: params.parent_id?.string,
        } as any);
    }

    async deleteChannel(uin: string, params: Adapter.DeleteChannelParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        await account.client.deleteChannel(params.channel_id.string);
    }

    async getGuildMemberInfo(
        uin: string,
        params: Adapter.GetGuildMemberInfoParams,
    ): Promise<Adapter.GuildMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const m = await account.client.getGuildMemberInfo(params.guild_id.string, params.user_id.string);
        return {
            guild_id: params.guild_id,
            user_id: this.createId(m.member_id),
            user_name: m.username,
            nickname: m.card,
            role: m.roles?.[0],
        };
    }

    async kickChannelMember(uin: string, _params: Adapter.KickChannelMemberParams): Promise<void> {
        // 需要 guild_id；保留与旧实现一致的错误，引导调用方使用扩展方法 kickGuildMember
        void this.getAccount(uin);
        throw new Error('踢出频道成员需要提供 guild_id，请使用 kickGuildMember 方法');
    }

    async setChannelMemberMute(uin: string, _params: Adapter.SetChannelMemberMuteParams): Promise<void> {
        void this.getAccount(uin);
        throw new Error('设置频道成员禁言需要提供 guild_id，请使用 muteGuildMember 方法');
    }

    async kickGuildMember(
        uin: string,
        guildId: string,
        userId: string,
        addBlacklist?: boolean,
    ): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        await account.client.kickGuildMember(guildId, userId, undefined, addBlacklist);
    }

    async muteGuildMember(
        uin: string,
        guildId: string,
        userId: string,
        duration: number,
    ): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        await account.client.muteGuildMember(guildId, userId, duration);
    }

    async muteGuild(uin: string, guildId: string, duration: number): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        await account.client.muteGuild(guildId, duration);
    }

    // ============================================
    // 系统
    // ============================================

    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: 'onebots-adapter-qq',
            app_version: '4.0.0',
            impl: 'onebots',
            version: '4.0.0',
            onebot_version: '12',
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        return {
            online: account?.status === AccountStatus.Online,
            good: account?.status === AccountStatus.Online,
        };
    }

    // ============================================
    // 账号创建（核心）
    // ============================================

    createAccount(config: Account.Config<'qq'>): Account<'qq', Bot> {
        const qqConfig: QQConfig = {
            account_id: config.account_id,
            appid: config.appid,
            secret: config.secret,
            sandbox: config.sandbox,
            intents: config.intents,
            mode: config.mode ?? 'websocket',
            apiBaseUrl: config.apiBaseUrl,
            port: config.port,
            path: config.path,
        };

        if (qqConfig.mode === 'webhook' && !qqConfig.port) {
            throw new Error(`[QQ] ${config.account_id} webhook 模式必须配置 port`);
        }

        const sdkIntents = mapIntents(qqConfig.intents, (m) => this.logger.warn(m));
        const apiBaseUrl = qqConfig.apiBaseUrl
            ?? (qqConfig.sandbox ? SANDBOX_API_BASE_URL : DEFAULT_API_BASE_URL);

        // SDK Config 是严格泛型 — 在边界统一 as any
        const sdkConfig: any = {
            appid: qqConfig.appid,
            secret: qqConfig.secret,
            mode: qqConfig.mode === 'webhook' ? ReceiverMode.WEBHOOK : ReceiverMode.WEBSOCKET,
            intents: sdkIntents,
            removeAt: true,
            apiBaseUrl,
        };
        if (qqConfig.mode === 'webhook') {
            sdkConfig.port = qqConfig.port;
            sdkConfig.path = qqConfig.path ?? '/';
        }

        const bot = new Bot(sdkConfig);
        const account = new Account<'qq', Bot>(this, bot, config);

        // ---- 生命周期 ----
        // SDK 的 ready/error 事件由 BaseReceiver 透过 Client EventEmitter 暴露
        bot.on('ready', () => {
            const modeText = qqConfig.mode === 'webhook' ? '(Webhook模式)' : '(WebSocket模式)';
            this.logger.info(`[QQ] ${config.account_id} 已连接 ${modeText}`);
            account.status = AccountStatus.Online;
        });
        bot.on('error', (err: Error) => {
            this.logger.error(`[QQ] ${config.account_id} 错误:`, err);
        });
        bot.on('close', () => {
            if (account.status !== AccountStatus.OffLine) {
                this.logger.warn(`[QQ] ${config.account_id} 连接关闭`);
                account.status = AccountStatus.OffLine;
            }
        });

        // ---- 消息事件 ----
        const safe = (fn: () => void) => {
            try {
                fn();
            } catch (e) {
                this.logger.error(`[QQ] ${config.account_id} 事件处理异常:`, e);
            }
        };

        bot.on('message.guild', (e: GuildMessageEvent) =>
            safe(() => this.handleGuildMessage(account, e, config.account_id)),
        );
        bot.on('message.private.direct', (e: PrivateMessageEvent) =>
            safe(() => this.handleDirectMessage(account, e, config.account_id)),
        );
        bot.on('message.group', (e: GroupMessageEvent) =>
            safe(() => this.handleGroupMessage(account, e, config.account_id)),
        );
        bot.on('message.private', (e: PrivateMessageEvent) =>
            safe(() => this.handleC2CMessage(account, e, config.account_id)),
        );

        // ---- 通知事件 ----
        bot.on('notice.guild.increase', (e: GuildChangeNoticeEvent) =>
            safe(() => this.handleGuildEvent(account, 'create', e, config.account_id)),
        );
        bot.on('notice.guild.update', (e: GuildChangeNoticeEvent) =>
            safe(() => this.handleGuildEvent(account, 'update', e, config.account_id)),
        );
        bot.on('notice.guild.decrease', (e: GuildChangeNoticeEvent) =>
            safe(() => this.handleGuildEvent(account, 'delete', e, config.account_id)),
        );
        bot.on('notice.channel.increase', (e: ChannelChangeNoticeEvent) =>
            safe(() => this.handleChannelEvent(account, 'create', e, config.account_id)),
        );
        bot.on('notice.channel.update', (e: ChannelChangeNoticeEvent) =>
            safe(() => this.handleChannelEvent(account, 'update', e, config.account_id)),
        );
        bot.on('notice.channel.decrease', (e: ChannelChangeNoticeEvent) =>
            safe(() => this.handleChannelEvent(account, 'delete', e, config.account_id)),
        );
        bot.on('notice.guild.member.increase', (e: GuildMemberChangeNoticeEvent) =>
            safe(() => this.handleMemberEvent(account, 'add', e, config.account_id)),
        );
        bot.on('notice.guild.member.update', (e: GuildMemberChangeNoticeEvent) =>
            safe(() => this.handleMemberEvent(account, 'update', e, config.account_id)),
        );
        bot.on('notice.guild.member.decrease', (e: GuildMemberChangeNoticeEvent) =>
            safe(() => this.handleMemberEvent(account, 'remove', e, config.account_id)),
        );
        bot.on('notice.reaction.add', (e: MessageReactionNoticeEvent) =>
            safe(() => this.handleReactionEvent(account, 'add', e, config.account_id)),
        );
        bot.on('notice.reaction.remove', (e: MessageReactionNoticeEvent) =>
            safe(() => this.handleReactionEvent(account, 'remove', e, config.account_id)),
        );
        // 互动 / 加好友 / 加群请求
        bot.on('notice.guild.action', (e: GuildActionNoticeEvent) =>
            safe(() => this.handleInteractionEvent(account, e, config.account_id)),
        );
        bot.on('notice.group.action', (e: GroupActionNoticeEvent) =>
            safe(() => this.handleGroupActionEvent(account, e, config.account_id)),
        );
        bot.on('notice.group.join_request', (e: GroupJoinRequestNoticeEvent) =>
            safe(() => this.handleGroupJoinRequestEvent(account, e, config.account_id)),
        );

        // ---- 账号生命周期 ----
        account.on('start', async () => {
            try {
                await bot.start();
            } catch (error) {
                this.logger.error(`[QQ] ${config.account_id} 启动失败:`, error);
                account.status = AccountStatus.OffLine;
            }
        });
        account.on('stop', async () => {
            try {
                await bot.stop();
            } catch (error) {
                this.logger.error(`[QQ] ${config.account_id} 停止失败:`, error);
            }
            account.status = AccountStatus.OffLine;
        });

        return account;
    }

    // ============================================
    // 事件翻译
    // ============================================

    private handleGuildMessage(
        account: Account<'qq', Bot>,
        e: GuildMessageEvent,
        accountId: string,
    ): void {
        const content = typeof e.raw_message === 'string' ? e.raw_message : '';
        const preview = content.length > 100 ? content.slice(0, 100) + '...' : content;
        this.logger.info(
            `[QQ] 频道消息 | 消息ID: ${e.message_id} | 频道: ${e.channel_id} | ` +
            `发送者: ${e.sender.user_name}(${e.sender.user_id}) | 内容: ${preview}`,
        );

        account.dispatch({
            id: this.createId(e.message_id),
            timestamp: dateLikeToEventMs((e as any).timestamp ?? Date.now()),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'message',
            message_type: 'channel',
            sender: {
                id: this.createId(e.sender.user_id),
                name: e.sender.user_name,
            },
            group: e.guild_id ? { id: this.createId(e.guild_id), name: e.guild_name } : undefined,
            message_id: this.createId(e.message_id),
            raw_message: content,
            message: this.parseSdkMessage(e.message),
        } as CommonEvent.Message);
    }

    private handleDirectMessage(
        account: Account<'qq', Bot>,
        e: PrivateMessageEvent,
        accountId: string,
    ): void {
        const content = typeof e.raw_message === 'string' ? e.raw_message : '';
        const preview = content.length > 100 ? content.slice(0, 100) + '...' : content;
        this.logger.info(
            `[QQ] 频道私信 | 消息ID: ${e.message_id} | ` +
            `发送者: ${e.sender.user_name}(${e.sender.user_id}) | 内容: ${preview}`,
        );

        account.dispatch({
            id: this.createId(e.message_id),
            timestamp: dateLikeToEventMs((e as any).timestamp ?? Date.now()),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'message',
            message_type: 'direct',
            sender: {
                id: this.createId(e.sender.user_id),
                name: e.sender.user_name,
            },
            message_id: this.createId(e.message_id),
            raw_message: content,
            message: this.parseSdkMessage(e.message),
        } as CommonEvent.Message);
    }

    private handleGroupMessage(
        account: Account<'qq', Bot>,
        e: GroupMessageEvent,
        accountId: string,
    ): void {
        const content = typeof e.raw_message === 'string' ? e.raw_message : '';
        const preview = content.length > 100 ? content.slice(0, 100) + '...' : content;
        this.logger.info(
            `[QQ] 群消息 | 消息ID: ${e.message_id} | 群: ${e.group_id} | ` +
            `发送者: ${e.sender.user_name}(${e.sender.user_id}) | 内容: ${preview}`,
        );

        account.dispatch({
            id: this.createId(e.message_id),
            timestamp: dateLikeToEventMs((e as any).timestamp ?? Date.now()),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'message',
            message_type: 'group',
            sender: {
                id: this.createId(e.sender.user_id),
                name: e.sender.user_name,
            },
            group: { id: this.createId(e.group_id), name: e.group_name },
            message_id: this.createId(e.message_id),
            raw_message: content,
            message: this.parseSdkMessage(e.message),
        } as CommonEvent.Message);
    }

    private handleC2CMessage(
        account: Account<'qq', Bot>,
        e: PrivateMessageEvent,
        accountId: string,
    ): void {
        const content = typeof e.raw_message === 'string' ? e.raw_message : '';
        const preview = content.length > 100 ? content.slice(0, 100) + '...' : content;
        this.logger.info(
            `[QQ] 私聊消息 | 消息ID: ${e.message_id} | ` +
            `发送者: ${e.sender.user_name}(${e.sender.user_id}) | 内容: ${preview}`,
        );

        account.dispatch({
            id: this.createId(e.message_id),
            timestamp: dateLikeToEventMs((e as any).timestamp ?? Date.now()),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'message',
            message_type: 'private',
            sender: {
                id: this.createId(e.sender.user_id),
                name: e.sender.user_name,
            },
            message_id: this.createId(e.message_id),
            raw_message: content,
            message: this.parseSdkMessage(e.message),
        } as CommonEvent.Message);
    }

    private handleGuildEvent(
        account: Account<'qq', Bot>,
        action: 'create' | 'update' | 'delete',
        e: GuildChangeNoticeEvent,
        accountId: string,
    ): void {
        account.dispatch({
            id: this.createId(e.event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e as any).time ?? Date.now()),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'notice',
            notice_type: 'custom',
            sub_type: `guild_${action}`,
            group: e.guild_id ? { id: this.createId(e.guild_id), name: e.guild_name } : undefined,
        } as CommonEvent.Notice);
    }

    private handleChannelEvent(
        account: Account<'qq', Bot>,
        action: 'create' | 'update' | 'delete',
        e: ChannelChangeNoticeEvent,
        accountId: string,
    ): void {
        account.dispatch({
            id: this.createId(e.event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e as any).time ?? Date.now()),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'notice',
            notice_type: 'custom',
            sub_type: `channel_${action}`,
            group: e.guild_id ? { id: this.createId(e.guild_id), name: '' } : undefined,
            channel_id: e.channel_id,
            channel_name: e.channel_name,
        } as CommonEvent.Notice);
    }

    private handleMemberEvent(
        account: Account<'qq', Bot>,
        action: 'add' | 'update' | 'remove',
        e: GuildMemberChangeNoticeEvent,
        accountId: string,
    ): void {
        const noticeType: CommonEvent.NoticeType =
            action === 'add' ? 'group_increase'
                : action === 'remove' ? 'group_decrease'
                : 'custom';

        account.dispatch({
            id: this.createId(e.event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e as any).time ?? Date.now()),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'notice',
            notice_type: noticeType,
            sub_type: action,
            user: { id: this.createId(e.user_id), name: e.user_name },
            group: { id: this.createId(e.guild_id), name: '' },
            operator: e.operator_id ? { id: this.createId(e.operator_id), name: '' } : undefined,
        } as CommonEvent.Notice);
    }

    private handleReactionEvent(
        account: Account<'qq', Bot>,
        action: 'add' | 'remove',
        e: MessageReactionNoticeEvent,
        accountId: string,
    ): void {
        account.dispatch({
            id: this.createId(e.event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e as any).time ?? Date.now()),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'notice',
            notice_type: 'custom',
            sub_type: `reaction_${action}`,
            user: { id: this.createId(e.user_id), name: '' },
            group: { id: this.createId(e.guild_id), name: '' },
            channel_id: e.channel_id,
            message_id: e.message_id,
            emoji_id: e.emoji?.id,
            emoji_type: e.emoji?.type,
        } as CommonEvent.Notice);
    }

    private handleInteractionEvent(
        account: Account<'qq', Bot>,
        e: GuildActionNoticeEvent,
        accountId: string,
    ): void {
        const resolved = (e as any).data?.resolved as { button_id?: string; button_data?: string } | undefined;
        account.dispatch({
            id: this.createId((e as any).event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e as any).time ?? Date.now()),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'notice',
            notice_type: 'custom',
            sub_type: 'interaction',
            interaction_type: (e as any).type,
            chat_type: (e as any).chat_type,
            button_id: resolved?.button_id,
            button_data: resolved?.button_data,
            user: (e as any).user_openid
                ? { id: this.createId((e as any).user_openid), name: '' } : undefined,
            group: e.guild_id ? { id: this.createId(e.guild_id), name: '' } : undefined,
        } as CommonEvent.Notice);
    }

    private handleGroupActionEvent(
        account: Account<'qq', Bot>,
        e: GroupActionNoticeEvent,
        accountId: string,
    ): void {
        const resolved = (e as any).data?.resolved as { button_id?: string; button_data?: string } | undefined;
        account.dispatch({
            id: this.createId((e as any).event_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e as any).time ?? Date.now()),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'notice',
            notice_type: 'custom',
            sub_type: 'group_action',
            interaction_type: (e as any).type,
            button_id: resolved?.button_id,
            button_data: resolved?.button_data,
            user: (e as any).user_openid
                ? { id: this.createId((e as any).user_openid), name: '' } : undefined,
            group: e.group_id ? { id: this.createId(e.group_id), name: '' } : undefined,
        } as CommonEvent.Notice);
    }

    private handleGroupJoinRequestEvent(
        account: Account<'qq', Bot>,
        e: GroupJoinRequestNoticeEvent,
        accountId: string,
    ): void {
        account.dispatch({
            id: this.createId((e as any).event_id ?? e.join_request_id ?? Date.now().toString()),
            timestamp: dateLikeToEventMs((e.apply_at as any) ?? Date.now()),
            platform: 'qq',
            bot_id: this.createId(accountId),
            type: 'notice',
            notice_type: 'custom',
            sub_type: 'group_join_request',
            user: { id: this.createId(e.user_id), name: e.username },
            group: { id: this.createId(e.group_id), name: '' },
            request_id: e.join_request_id,
            apply_source: e.apply_source,
            invited_by: e.invited_by,
            flag: e.join_request_id,
        } as CommonEvent.Notice);
    }

    // ============================================
    // 消息段转换
    // ============================================

    /**
     * OneBot / Satori 通用消息段 → SDK Sendable
     */
    private buildSendable(message: CommonTypes.Segment[]): Sendable {
        const elems: MessageElem[] = [];
        for (const seg of message) {
            if (typeof seg === 'string') {
                elems.push(segment.text(seg));
                continue;
            }
            switch (seg.type) {
                case 'text':
                    elems.push(segment.text(String(seg.data.text ?? '')));
                    break;
                case 'at':
                    if (seg.data.qq === 'all') {
                        elems.push(segment.at('all'));
                    } else {
                        elems.push(segment.at(String(seg.data.qq ?? seg.data.id ?? '')));
                    }
                    break;
                case 'face':
                    elems.push(segment.face(Number(seg.data.id), seg.data.text as any));
                    break;
                case 'image': {
                    const src = String(seg.data.url ?? seg.data.file ?? '');
                    elems.push(segment.image(src, { url: src }));
                    break;
                }
                case 'reply':
                    elems.push(segment.reply(String(seg.data.id ?? seg.data.message_id)));
                    break;
                case 'video':
                    elems.push(segment.video(String(seg.data.url ?? seg.data.file)));
                    break;
                case 'audio':
                    elems.push(segment.audio(String(seg.data.url ?? seg.data.file)));
                    break;
                case 'markdown':
                    elems.push(segment.markdown(seg.data as any));
                    break;
                default:
                    if (seg.data?.text) {
                        elems.push(segment.text(String(seg.data.text)));
                    } else if (seg.data?.url) {
                        elems.push(segment.image(String(seg.data.url)));
                    }
                    break;
            }
        }
        return elems.length === 1 ? elems[0] : elems;
    }

    /**
     * SDK Sendable → OneBot 通用消息段
     */
    private parseSdkMessage(sendable: Sendable): CommonTypes.Segment[] {
        const arr = Array.isArray(sendable) ? sendable : [sendable];
        const out: CommonTypes.Segment[] = [];
        for (const el of arr) {
            if (!el || typeof el !== 'object') continue;
            switch (el.type) {
                case 'text':
                    out.push({ type: 'text', data: { text: (el as any).data.text } });
                    break;
                case 'at':
                    out.push({
                        type: 'at',
                        data: {
                            qq: (el as any).data.id === 'all' ? 'all' : String((el as any).data.id),
                        },
                    });
                    break;
                case 'face':
                    out.push({ type: 'face', data: { id: String((el as any).data.id), text: (el as any).data.text } });
                    break;
                case 'image':
                    out.push({
                        type: 'image',
                        data: { url: (el as any).data.url, file: (el as any).data.file },
                    });
                    break;
                case 'reply':
                    out.push({
                        type: 'reply',
                        data: { id: (el as any).data.id, message_id: (el as any).data.id },
                    });
                    break;
                case 'video':
                    out.push({
                        type: 'video',
                        data: { url: (el as any).data.url, file: (el as any).data.file },
                    });
                    break;
                case 'audio':
                    out.push({
                        type: 'audio',
                        data: { url: (el as any).data.url, file: (el as any).data.file },
                    });
                    break;
                case 'markdown':
                    out.push({ type: 'markdown', data: (el as any).data });
                    break;
                // ark/embed/link/button/keyboard 在通用段中没有对应类型，直接丢弃
            }
        }
        return out;
    }
}

// 声明模块扩展
declare module 'onebots' {
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
    description: 'QQ官方机器人适配器（基于 qq-official-bot），支持频道、群聊和私聊',
    icon: 'https://q.qq.com/favicon.ico',
    homepage: 'https://bot.q.qq.com/wiki',
    author: '凉菜',
});