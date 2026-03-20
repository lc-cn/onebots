/**
 * Slack 适配器
 * 继承 Adapter 基类，实现 Slack 平台功能
 */
import { Account, AdapterRegistry, AccountStatus } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { SlackBot } from "./bot.js";
import { CommonEvent, type CommonTypes } from "onebots";
import type { SlackConfig, SlackEvent } from "./types.js";

export class SlackAdapter extends Adapter<SlackBot, "slack"> {
    constructor(app: BaseApp) {
        super(app, "slack");
        this.icon = "https://slack.com/favicon.ico";
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
                    text += '<!channel> ';
                } else {
                    text += `<@${userId}> `;
                }
            } else if (seg.type === 'image') {
                // Slack 图片需要单独发送或作为附件
                if (seg.data.url || seg.data.file) {
                    const imageUrl = seg.data.url || seg.data.file;
                    if (!options.attachments) options.attachments = [];
                    options.attachments.push({
                        image_url: imageUrl,
                        fallback: text || 'Image',
                    });
                }
            } else if (seg.type === 'file') {
                // Slack 文件需要先上传
                if (seg.data.url || seg.data.file) {
                    text += `[文件: ${seg.data.url || seg.data.file}]`;
                }
            }
        }

        // 发送消息
        const channelId = sceneId.string;
        const result = await bot.sendMessage(channelId, text, options);

        return {
            message_id: this.createId(result.ts || Date.now().toString()),
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
        const channelId = params.scene_id?.string || '';

        if (channelId) {
            await bot.deleteMessage(channelId, msgId);
        }
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        // Slack 不支持直接获取消息，需要通过 conversations.history
        throw new Error('Slack 不支持直接获取消息');
    }

    /**
     * 更新消息
     */
    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msgId = params.message_id.string;
        const channelId = (params as any).scene_id?.string || '';

        // 解析消息内容
        let text = '';
        for (const seg of params.message) {
            if (typeof seg === 'string') {
                text += seg;
            } else if (seg.type === 'text') {
                text += seg.data.text || '';
            }
        }

        if (channelId) {
            await bot.updateMessage(channelId, msgId, text);
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
        const me = bot.getCachedMe();

        return {
            user_id: this.createId(me?.id || ''),
            user_name: me?.name || '',
            user_displayname: me?.display_name || me?.real_name || me?.name || '',
            avatar: me?.profile?.image_512 || me?.profile?.image_192,
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
        const user = await bot.getUserInfo(userId);

        return {
            user_id: this.createId(user.id),
            user_name: user.name || '',
            user_displayname: user.display_name || user.real_name || user.name || '',
            avatar: user.profile?.image_512 || user.profile?.image_192,
        };
    }

    // ============================================
    // 好友（私聊会话）相关方法
    // ============================================

    /**
     * 获取好友列表（Slack 不支持）
     */
    async getFriendList(uin: string, params?: Adapter.GetFriendListParams): Promise<Adapter.FriendInfo[]> {
        // Slack 不提供好友列表 API
        return [];
    }

    /**
     * 获取好友信息
     */
    async getFriendInfo(uin: string, params: Adapter.GetFriendInfoParams): Promise<Adapter.FriendInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = params.user_id.string;
        const user = await bot.getUserInfo(userId);

        return {
            user_id: this.createId(user.id),
            user_name: user.name || '',
            remark: user.display_name || user.real_name || user.name || '',
        };
    }

    // ============================================
    // 群组相关方法
    // ============================================

    /**
     * 获取群列表（频道列表）
     */
    async getGroupList(uin: string, params?: Adapter.GetGroupListParams): Promise<Adapter.GroupInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channels = await bot.getChannelList();

        return channels.map((channel) => ({
            group_id: this.createId(channel.id),
            group_name: channel.name || '',
        }));
    }

    /**
     * 获取群信息（频道信息）
     */
    async getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channelId = params.group_id.string;
        const channel = await bot.getChannelInfo(channelId);

        return {
            group_id: this.createId(channel.id),
            group_name: channel.name || '',
        };
    }

    /**
     * 退出群组（离开频道）
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.leaveChannel(params.group_id.string);
    }

    /**
     * 获取群成员列表（频道成员列表）
     */
    async getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const channelId = params.group_id.string;
        const memberIds = await bot.getChannelMembers(channelId);

        // 获取每个成员的详细信息
        const members: Adapter.GroupMemberInfo[] = [];
        for (const memberId of memberIds) {
            try {
                const user = await bot.getUserInfo(memberId);
                members.push({
                    group_id: params.group_id,
                    user_id: this.createId(user.id),
                    user_name: user.name || '',
                    card: user.display_name || user.real_name || user.name || '',
                    role: user.is_admin ? 'admin' : user.is_owner ? 'owner' : 'member',
                });
            } catch (error) {
                // 忽略获取失败的用户
            }
        }

        return members;
    }

    /**
     * 获取群成员信息
     */
    async getGroupMemberInfo(uin: string, params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = params.user_id.string;
        const user = await bot.getUserInfo(userId);

        return {
            group_id: params.group_id,
            user_id: this.createId(user.id),
            user_name: user.name || '',
            card: user.display_name || user.real_name || user.name || '',
            role: user.is_admin ? 'admin' : user.is_owner ? 'owner' : 'member',
        };
    }

    /**
     * 踢出群成员
     */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        // Slack 不支持直接踢出频道成员
        throw new Error('Slack 不支持直接踢出频道成员');
    }

    /**
     * 设置群名片（Slack 不支持）
     */
    async setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        // Slack 不支持设置群名片
        throw new Error('Slack 不支持设置群名片');
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: 'onebots Slack Adapter',
            app_version: '1.0.0',
            impl: 'slack',
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

    createAccount(config: Account.Config<'slack'>): Account<'slack', SlackBot> {
        const slackConfig: SlackConfig = {
            account_id: config.account_id,
            token: config.token,
            signing_secret: config.signing_secret,
            app_token: config.app_token,
            socket_mode: config.socket_mode || false,
        };

        const bot = new SlackBot(slackConfig);
        const account = new Account<'slack', SlackBot>(this, bot, config);

        // Webhook 路由（Events API）
        this.app.router.post(`${account.path}/webhook`, bot.handleWebhook.bind(bot));

        // 监听 Bot 事件
        bot.on('ready', () => {
            this.logger.info(`Slack Bot ${config.account_id} 已就绪`);
        });

        bot.on('error', (error) => {
            this.logger.error(`Slack Bot ${config.account_id} 错误:`, error);
        });

        // 监听 Slack 事件
        bot.on('event', (event: SlackEvent) => {
            this.handleSlackEvent(account, event);
        });

        // 启动时初始化 Bot
        account.on('start', async () => {
            try {
                await bot.start();
                account.status = AccountStatus.Online;
                const me = bot.getCachedMe();
                account.nickname = me?.name || 'Slack Bot';
                account.avatar = me?.profile?.image_512 || me?.profile?.image_192 || this.icon;
            } catch (error) {
                this.logger.error(`启动 Slack Bot 失败:`, error);
                account.status = AccountStatus.OffLine;
            }
        });

        account.on('stop', async () => {
            await bot.stop();
            account.status = AccountStatus.OffLine;
        });

        return account;
    }

    /**
     * 处理 Slack 事件
     */
    private handleSlackEvent(account: Account<'slack', SlackBot>, event: SlackEvent): void {
        const eventType = event.type;

        // 处理消息事件
        if (eventType === 'message') {
            // 忽略子类型消息（如 bot_message, message_changed 等）
            if ((event as any).subtype && (event as any).subtype !== 'thread_broadcast') {
                return;
            }

            // 忽略自己发送的消息
            const bot = account.client;
            const me = bot.getCachedMe();
            if (me && event.user === me.id) return;

            // 打印消息接收日志
            const content = event.text || '';
            const contentPreview = content.length > 100 ? content.substring(0, 100) + '...' : content;
            this.logger.info(
                `[Slack] 收到消息 | 消息ID: ${event.ts} | 频道: ${event.channel} | ` +
                `发送者: ${event.user} | 内容: ${contentPreview}`
            );

            // 构建消息段
            const messageSegments: any[] = [];
            if (content) {
                messageSegments.push({
                    type: 'text',
                    data: { text: content },
                });
            }

            // 判断是私聊还是群聊（通过频道类型判断）
            const isGroup = event.channel && !event.channel.startsWith('D'); // D 开头的通常是私聊
            const messageType = isGroup ? 'group' : 'private';

            // 转换为 CommonEvent 格式
            const commonEvent: CommonEvent.Message = {
                id: this.createId(event.ts || event.event_ts),
                timestamp: parseFloat(event.ts || event.event_ts) * 1000,
                platform: 'slack',
                bot_id: this.createId(account.config.account_id),
                type: 'message',
                message_type: messageType,
                sender: {
                    id: this.createId(event.user || ''),
                    name: event.user || '',
                    avatar: undefined,
                },
                ...(isGroup ? {
                    group: {
                        id: this.createId(event.channel || ''),
                        name: '',
                    },
                } : {}),
                message_id: this.createId(event.ts || event.event_ts),
                raw_message: content,
                message: messageSegments,
            };

            // 派发到协议层
            account.dispatch(commonEvent);
        }
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            slack: SlackConfig;
        }
    }
}

AdapterRegistry.register('slack', SlackAdapter, {
    name: 'slack',
    displayName: 'Slack官方机器人',
    description: 'Slack官方机器人适配器，支持频道消息、私聊、应用命令',
    icon: 'https://slack.com/favicon.ico',
    homepage: 'https://slack.com/',
    author: '凉菜',
});

