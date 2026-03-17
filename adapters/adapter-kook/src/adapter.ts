/**
 * KOOK (开黑了) 适配器
 * 继承 Adapter 基类，实现 KOOK 平台功能
 * - 消息收发（sendMessage）
 * - 服务器管理（getGroupList, getGroupInfo 等，对应 KOOK 的服务器）
 * - 频道管理（getChannelList, getChannelInfo 等）
 * - 用户管理（getFriendList, getUserInfo 等）
 */
import { Account, AdapterRegistry, AccountStatus } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { KookBot } from "./bot.js";
import { CommonEvent } from "onebots";
import type { KookConfig, KookEvent, KookMessageType } from "./types.js";
import { parseKMarkdown, mentionUser, mentionAll, mentionHere } from "./utils.js";

export class KookAdapter extends Adapter<KookBot, "kook"> {
    constructor(app: BaseApp) {
        super(app, "kook");
        this.icon = "https://www.kookapp.cn/favicon.ico";
    }

    // ============================================
    // 消息相关方法
    // ============================================

    /**
     * 发送消息
     * KOOK 支持频道消息和私聊消息
     */
    async sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const { scene_id, scene_type, message } = params;

        // 解析消息内容
        let content = '';
        let messageType: KookMessageType = 9;  // 默认使用 KMarkdown

        for (const seg of message) {
            if (typeof seg === 'string') {
                content += seg;
            } else if (seg.type === 'text') {
                content += seg.data.text || '';
            } else if (seg.type === 'at') {
                if (seg.data.qq === 'all') {
                    content += mentionAll();
                } else if (seg.data.qq === 'here') {
                    content += mentionHere();
                } else {
                    content += mentionUser(seg.data.qq || seg.data.id || '');
                }
            } else if (seg.type === 'image') {
                // 图片消息需要单独发送
                if (seg.data.url) {
                    content += `[图片](${seg.data.url})`;
                }
            } else if (seg.type === 'face') {
                // 表情
                content += `:${seg.data.id || 'smile'}:`;
            }
        }

        let result: { msg_id: string; msg_timestamp: number; nonce: string };

        if (scene_type === 'private' || scene_type === 'direct') {
            // 私聊消息
            result = await bot.sendDirectMessage(scene_id.string, content);
        } else if (scene_type === 'channel') {
            // 频道消息
            result = await bot.sendChannelMessage(scene_id.string, content);
        } else if (scene_type === 'group') {
            // 群组消息也发送到频道
            result = await bot.sendChannelMessage(scene_id.string, content);
        } else {
            throw new Error(`KOOK 不支持的消息场景类型: ${scene_type}`);
        }

        return {
            message_id: this.createId(result.msg_id),
        };
    }

    /**
     * 删除/撤回消息
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msgId = params.message_id.string;

        // 根据场景类型删除消息
        // 需要从消息中获取 channel_id，这里简化处理
        // 实际应该从消息缓存或数据库中获取
        const channelId = params.scene_id?.string || '';
        if (channelId) {
            await bot.deleteMessage(channelId, msgId);
        }
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msgId = params.message_id.string;
        const channelId = params.scene_id?.string || '';

        const msg = await bot.getMessage(channelId, msgId);

        return {
            message_id: this.createId(msg.id),
            time: msg.create_at,
            sender: {
                scene_type: 'channel',
                sender_id: this.createId(msg.author.id),
                scene_id: this.createId(msg.id),
                sender_name: msg.author.username,
                scene_name: '',
            },
            message: [{
                type: msg.type === 9 ? 'text' : 'text',
                data: { text: parseKMarkdown(msg.content) },
            }],
        };
    }

    /**
     * 更新消息
     */
    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msgId = params.message_id.string;

        // 解析消息内容
        let content = '';
        for (const seg of params.message) {
            if (typeof seg === 'string') {
                content += seg;
            } else if (seg.type === 'text') {
                content += seg.data.text || '';
            }
        }

        // 更新消息需要 channelId，但参数中没有，尝试从消息中获取
        // 如果无法获取，则使用第一个可用的频道（简化处理）
        const channelId = (params as any).scene_id?.string || '';
        if (!channelId) {
            throw new Error('更新消息需要 channel_id，但参数中未提供');
        }
        await bot.updateMessage(channelId, msgId, content);
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
            user_id: this.createId(me.id),
            user_name: me.username,
            user_displayname: me.nickname,
            avatar: me.avatar,
        };
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = params.user_id.string;
        const user = await bot.getUser(userId);

        return {
            user_id: this.createId(user.id),
            user_name: user.username,
            user_displayname: user.nickname,
            avatar: user.avatar,
        };
    }

    // ============================================
    // 好友（私聊会话）相关方法
    // ============================================

    /**
     * 获取好友列表（私聊会话列表）
     */
    async getFriendList(uin: string, params?: Adapter.GetFriendListParams): Promise<Adapter.FriendInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const friends: Adapter.FriendInfo[] = [];
        let page = 1;

        // KOOK 不提供私聊会话列表 API，返回空数组
        // 如果需要获取私聊用户，需要通过其他方式（如消息记录）
        return [];

        return friends;
    }

    /**
     * 获取好友信息
     */
    async getFriendInfo(uin: string, params: Adapter.GetFriendInfoParams): Promise<Adapter.FriendInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = params.user_id.string;
        const user = await bot.getUser(userId);

        return {
            user_id: this.createId(user.id),
            user_name: user.username,
            remark: user.nickname,
        };
    }

    // ============================================
    // 群组（服务器）相关方法
    // ============================================

    /**
     * 获取群列表（服务器列表）
     */
    async getGroupList(uin: string, params?: Adapter.GetGroupListParams): Promise<Adapter.GroupInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groups: Adapter.GroupInfo[] = [];
        let page = 1;

        do {
            const result = await bot.getGuildList(page, 50);
            
            for (const guild of result.items) {
                groups.push({
                    group_id: this.createId(guild.id),
                    group_name: guild.name,
                });
            }

            if (page >= result.meta.page_total) break;
            page++;
        } while (true);

        return groups;
    }

    /**
     * 获取群信息（服务器信息）
     */
    async getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guildId = params.group_id.string;
        const guild = await bot.getGuild(guildId);
        if (!guild?.id) {
            throw new Error(`获取群信息失败：无效的 guild 响应（guild_id=${guildId}）`);
        }
        return {
            group_id: this.createId(guild.id),
            group_name: guild.name,
        };
    }

    /**
     * 退出群组（退出服务器）
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.leaveGuild(params.group_id.string);
    }

    /**
     * 获取群成员列表（服务器成员列表）
     */
    async getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guildId = params.group_id.string;
        const members: Adapter.GroupMemberInfo[] = [];
        let page = 1;

        do {
            const result = await bot.getGuildMemberList(guildId, undefined, undefined, undefined, undefined, undefined, undefined, page, 50);
            
            for (const user of result.items) {
                members.push({
                    group_id: params.group_id,
                    user_id: this.createId(user.id),
                    user_name: user.username,
                    card: user.nickname,
                    role: 'member',
                });
            }

            if (page >= result.meta.page_total) break;
            page++;
        } while (true);

        return members;
    }

    /**
     * 获取群成员信息
     */
    async getGroupMemberInfo(uin: string, params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guildId = params.group_id.string;
        const userId = params.user_id.string;
        const user = await bot.getUser(userId, guildId);

        return {
            group_id: params.group_id,
            user_id: this.createId(user.id),
            user_name: user.username,
            card: user.nickname,
            role: 'member',
        };
    }

    /**
     * 踢出群成员
     */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.kickGuildMember(params.group_id.string, params.user_id.string);
    }

    /**
     * 设置群名片（设置服务器昵称）
     */
    async setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.setGuildNickname(params.group_id.string, params.card, params.user_id.string);
    }

    // ============================================
    // 频道相关方法
    // ============================================

    /**
     * 获取频道列表
     */
    async getChannelList(uin: string, params?: Adapter.GetChannelListParams): Promise<Adapter.ChannelInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guildId = params?.guild_id?.string;
        if (!guildId) throw new Error('guild_id is required');

        const channels: Adapter.ChannelInfo[] = [];
        let page = 1;

        do {
            const result = await bot.getChannelList(guildId, undefined, page, 50);
            
            for (const channel of result.items) {
                channels.push({
                    channel_id: this.createId(channel.id),
                    channel_name: channel.name,
                    channel_type: channel.type,
                    parent_id: channel.parent_id ? this.createId(channel.parent_id) : undefined,
                });
            }

            if (page >= result.meta.page_total) break;
            page++;
        } while (true);

        return channels;
    }

    /**
     * 获取频道信息
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
     * 创建频道
     */
    async createChannel(uin: string, params: Adapter.CreateChannelParams): Promise<Adapter.ChannelInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channel = await bot.createChannel(
            params.guild_id.string,
            params.channel_name,
            params.channel_type as 1 | 2,
            params.parent_id?.string
        );

        return {
            channel_id: this.createId(channel.id),
            channel_name: channel.name,
            channel_type: channel.type,
            parent_id: channel.parent_id ? this.createId(channel.parent_id) : undefined,
        };
    }

    /**
     * 更新频道
     */
    async updateChannel(uin: string, params: Adapter.UpdateChannelParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.updateChannel(params.channel_id.string, params.channel_name);
    }

    /**
     * 删除频道
     */
    async deleteChannel(uin: string, params: Adapter.DeleteChannelParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.deleteChannel(params.channel_id.string);
    }

    /**
     * 获取频道成员列表
     */
    async getChannelMemberList(uin: string, params: Adapter.GetChannelMemberListParams): Promise<Adapter.ChannelMemberInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const result = await bot.getChannelUserList(params.channel_id.string);

        return result.items.map(user => ({
            channel_id: params.channel_id,
            user_id: this.createId(user.id),
            user_name: user.username,
            role: 'member' as const,
        }));
    }

    // ============================================
    // 服务器（公会）相关方法
    // ============================================

    /**
     * 获取服务器列表
     */
    async getGuildList(uin: string): Promise<Adapter.GuildInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guilds: Adapter.GuildInfo[] = [];
        let page = 1;

        do {
            const result = await bot.getGuildList(page, 50);
            
            for (const guild of result.items) {
                guilds.push({
                    guild_id: this.createId(guild.id),
                    guild_name: guild.name,
                });
            }

            if (page >= result.meta.page_total) break;
            page++;
        } while (true);

        return guilds;
    }

    /**
     * 获取服务器信息
     */
    async getGuildInfo(uin: string, params: Adapter.GetGuildInfoParams): Promise<Adapter.GuildInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const guild = await bot.getGuild(params.guild_id.string);
        if (!guild?.id) {
            throw new Error(`获取服务器信息失败：无效的 guild 响应（guild_id=${params.guild_id.string}）`);
        }
        return {
            guild_id: this.createId(guild.id),
            guild_name: guild.name,
        };
    }

    /**
     * 获取服务器成员信息
     */
    async getGuildMemberInfo(uin: string, params: Adapter.GetGuildMemberInfoParams): Promise<Adapter.GuildMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const user = await bot.getUser(params.user_id.string, params.guild_id.string);

        return {
            guild_id: params.guild_id,
            user_id: this.createId(user.id),
            user_name: user.username,
            nickname: user.nickname,
        };
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: 'onebots KOOK Adapter',
            app_version: '1.0.0',
            impl: 'kook',
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

    createAccount(config: Account.Config<'kook'>): Account<'kook', KookBot> {
        const kookConfig: KookConfig = {
            account_id: config.account_id,
            token: config.token,
            verifyToken: config.verifyToken,
            encryptKey: config.encryptKey,
            mode: config.mode || 'websocket',
        };

        const bot = new KookBot(kookConfig);
        const account = new Account<'kook', KookBot>(this, bot, config);

        // Webhook 路由
        if (kookConfig.mode === 'webhook') {
            this.app.router.post(`${account.path}/webhook`, bot.handleWebhook.bind(bot));
        }

        // 监听 Bot 事件
        bot.on('ready', () => {
            this.logger.info(`KOOK Bot ${config.account_id} 已就绪`);
        });

        bot.on('error', (error) => {
            this.logger.error(`KOOK Bot ${config.account_id} 错误:`, error);
        });

        // 监听频道消息
        bot.on('channel_message', (event: KookEvent) => {
            // 忽略自己发送的消息
            const me = bot.getCachedMe();
            if (me && event.author_id === me.id) return;

            // 打印消息接收日志
            const content = event.content || '';
            const contentPreview = content.length > 100 ? content.substring(0, 100) + '...' : content;
            const channelId = (event as any).channel_id || '';
            this.logger.info(
                `[KOOK] 收到频道消息 | 消息ID: ${event.msg_id} | 频道: ${channelId} | ` +
                `发送者: ${event.extra?.author?.username || event.author_id} | 内容: ${contentPreview}`
            );

            // 构建消息段
            const messageSegments: any[] = [];
            const rawContent = event.content || '';
            
            // 根据消息类型处理
            switch (event.type) {
                case 1:  // 文字消息
                case 9:  // KMarkdown
                    messageSegments.push({
                        type: 'text',
                        data: { text: parseKMarkdown(rawContent) },
                    });
                    break;
                case 2:  // 图片
                    messageSegments.push({
                        type: 'image',
                        data: { url: rawContent },
                    });
                    break;
                case 3:  // 视频
                    messageSegments.push({
                        type: 'video',
                        data: { url: rawContent },
                    });
                    break;
                case 4:  // 文件
                    messageSegments.push({
                        type: 'file',
                        data: { url: rawContent },
                    });
                    break;
                case 8:  // 音频
                    messageSegments.push({
                        type: 'audio',
                        data: { url: rawContent },
                    });
                    break;
                case 10:  // 卡片消息
                    messageSegments.push({
                        type: 'card',
                        data: { content: rawContent },
                    });
                    break;
                default:
                    messageSegments.push({
                        type: 'text',
                        data: { text: rawContent },
                    });
            }

            // 处理 @
            if (event.extra?.mention) {
                for (const userId of event.extra.mention) {
                    messageSegments.unshift({
                        type: 'at',
                        data: { qq: userId },
                    });
                }
            }

            // 转换为 CommonEvent 格式
            const commonEvent: CommonEvent.Message = {
                id: this.createId(event.msg_id),
                timestamp: event.msg_timestamp,
                platform: 'kook',
                bot_id: this.createId(config.account_id),
                type: 'message',
                message_type: 'channel',
                sender: {
                    id: this.createId(event.author_id),
                    name: event.extra?.author?.username || event.author_id,
                    avatar: event.extra?.author?.avatar,
                },
                group: {
                    id: this.createId(event.extra?.guild_id || (event as any).channel_id || ''),
                    name: '',
                },
                message_id: this.createId(event.msg_id),
                raw_message: rawContent,
                message: messageSegments,
            };

            // 派发到协议层
            account.dispatch(commonEvent);
        });

        // 监听私聊消息
        bot.on('direct_message', (event: KookEvent) => {
            // 忽略自己发送的消息
            const me = bot.getCachedMe();
            if (me && event.author_id === me.id) return;

            // 打印消息接收日志
            const content = event.content || '';
            const contentPreview = content.length > 100 ? content.substring(0, 100) + '...' : content;
            this.logger.info(
                `[KOOK] 收到私聊消息 | 消息ID: ${event.msg_id} | ` +
                `发送者: ${event.extra?.author?.username || event.author_id} | 内容: ${contentPreview}`
            );

            // 构建消息段
            const messageSegments: any[] = [];
            const rawContent = event.content || '';
            
            switch (event.type) {
                case 1:
                case 9:
                    messageSegments.push({
                        type: 'text',
                        data: { text: parseKMarkdown(rawContent) },
                    });
                    break;
                case 2:
                    messageSegments.push({
                        type: 'image',
                        data: { url: rawContent },
                    });
                    break;
                default:
                    messageSegments.push({
                        type: 'text',
                        data: { text: rawContent },
                    });
            }

            // 转换为 CommonEvent 格式
            const commonEvent: CommonEvent.Message = {
                id: this.createId(event.msg_id),
                timestamp: event.msg_timestamp,
                platform: 'kook',
                bot_id: this.createId(config.account_id),
                type: 'message',
                message_type: 'private',
                sender: {
                    id: this.createId(event.author_id),
                    name: event.extra?.author?.username || event.author_id,
                    avatar: event.extra?.author?.avatar,
                },
                message_id: this.createId(event.msg_id),
                raw_message: rawContent,
                message: messageSegments,
            };

            // 派发到协议层
            account.dispatch(commonEvent);
        });

        // 监听成员加入服务器
        bot.on('system.joined_guild', (event: KookEvent) => {
            this.logger.info(`用户加入服务器: ${event.extra?.body?.user_id}`);
            
            const commonEvent: CommonEvent.Notice = {
                id: this.createId(event.msg_id),
                timestamp: event.msg_timestamp,
                platform: 'kook',
                bot_id: this.createId(config.account_id),
                type: 'notice',
                notice_type: 'group_increase',
                user: {
                    id: this.createId(event.extra?.body?.user_id || ''),
                    name: '',
                },
                group: {
                    id: this.createId(event.target_id),
                    name: '',
                },
            };

            account.dispatch(commonEvent);
        });

        // 监听成员离开服务器
        bot.on('system.exited_guild', (event: KookEvent) => {
            this.logger.info(`用户离开服务器: ${event.extra?.body?.user_id}`);
            
            const commonEvent: CommonEvent.Notice = {
                id: this.createId(event.msg_id),
                timestamp: event.msg_timestamp,
                platform: 'kook',
                bot_id: this.createId(config.account_id),
                type: 'notice',
                notice_type: 'group_decrease',
                user: {
                    id: this.createId(event.extra?.body?.user_id || ''),
                    name: '',
                },
                group: {
                    id: this.createId(event.target_id),
                    name: '',
                },
            };

            account.dispatch(commonEvent);
        });

        // 监听表情回应
        bot.on('system.added_reaction', (event: KookEvent) => {
            this.logger.debug(`添加表情回应:`, event);
            
            const commonEvent: CommonEvent.Notice = {
                id: this.createId(event.msg_id),
                timestamp: event.msg_timestamp,
                platform: 'kook',
                bot_id: this.createId(config.account_id),
                type: 'notice',
                notice_type: 'custom',
                sub_type: 'reaction_add',
                user: {
                    id: this.createId(event.extra?.body?.user_id || ''),
                    name: '',
                },
                message_id: event.extra?.body?.msg_id,
                emoji: event.extra?.body?.emoji,
            };

            account.dispatch(commonEvent);
        });

        // 监听消息更新
        bot.on('system.updated_message', (event: KookEvent) => {
            this.logger.debug(`消息更新:`, event);
            
            const commonEvent: CommonEvent.Notice = {
                id: this.createId(event.msg_id),
                timestamp: event.msg_timestamp,
                platform: 'kook',
                bot_id: this.createId(config.account_id),
                type: 'notice',
                notice_type: 'custom',
                sub_type: 'message_update',
                message_id: event.extra?.body?.msg_id,
                content: event.extra?.body?.content,
            };

            account.dispatch(commonEvent);
        });

        // 监听消息删除
        bot.on('system.deleted_message', (event: KookEvent) => {
            this.logger.debug(`消息删除:`, event);
            
            const commonEvent: CommonEvent.Notice = {
                id: this.createId(event.msg_id),
                timestamp: event.msg_timestamp,
                platform: 'kook',
                bot_id: this.createId(config.account_id),
                type: 'notice',
                notice_type: 'custom',
                sub_type: 'message_delete',
                message_id: event.extra?.body?.msg_id,
            };

            account.dispatch(commonEvent);
        });

        // 启动时初始化 Bot
        account.on('start', async () => {
            try {
                await bot.start();
                account.status = AccountStatus.Online;
                const me = bot.getCachedMe();
                account.nickname = me?.username || 'KOOK Bot';
                account.avatar = me?.avatar || this.icon;
            } catch (error) {
                this.logger.error(`启动 KOOK Bot 失败:`, error);
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
            kook: KookConfig;
        }
    }
}

AdapterRegistry.register('kook', KookAdapter,{
    name: 'kook',
    displayName: 'KOOK官方机器人',
    description: 'KOOK官方机器人适配器，支持频道、群聊和私聊',
    icon: 'https://www.kookapp.cn/favicon.ico',
    homepage: 'https://www.kookapp.cn/',
    author: '凉菜',
});

declare module '@/adapter.js' {
    namespace Adapter {
        interface Configs {
            kook: KookConfig;
        }
    }
}
