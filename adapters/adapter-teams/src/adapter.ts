/**
 * Microsoft Teams 适配器
 * 继承 Adapter 基类，实现 Microsoft Teams 平台功能
 */
import { Account, AdapterRegistry, AccountStatus } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { TeamsBot } from "./bot.js";
import { CommonEvent, type CommonTypes } from "onebots";
import type { TeamsConfig, TeamsEvent } from "./types.js";

export class TeamsAdapter extends Adapter<TeamsBot, "teams"> {
    constructor(app: BaseApp) {
        super(app, "teams");
        this.icon = "https://teams.microsoft.com/favicon.ico";
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
        const { message } = params;
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
                    text += '<at>所有人</at>';
                } else {
                    text += `<at>${userId}</at>`;
                }
            } else if (seg.type === 'image') {
                // Teams 图片需要作为附件发送
                if (seg.data.url || seg.data.file) {
                    text += `[图片: ${seg.data.url || seg.data.file}]`;
                }
            } else if (seg.type === 'file') {
                if (seg.data.url || seg.data.file) {
                    text += `[文件: ${seg.data.url || seg.data.file}]`;
                }
            }
        }

        // 发送消息
        const conversationId = sceneId.string;
        const result = await bot.sendMessage(conversationId, text, options);

        return {
            message_id: this.createId(result?.id || ''),
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
        const conversationId = params.scene_id?.string || '';

        await bot.deleteMessage(conversationId, msgId);
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        // Teams Bot Framework 不直接支持获取消息 API
        throw new Error('Teams 不支持获取消息');
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
        let text = '';
        for (const seg of params.message) {
            if (typeof seg === 'string') {
                text += seg;
            } else if (seg.type === 'text') {
                text += seg.data.text || '';
            }
        }

        // Teams 更新消息需要 conversationId，但 UpdateMessageParams 没有提供
        // 这里需要从消息 ID 中获取或使用其他方式
        // 暂时抛出错误，因为 Teams Bot Framework 需要 conversation reference
        throw new Error('Teams 更新消息需要 conversationId，请使用其他方式获取');
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
        const config = account.config as TeamsConfig;

        return {
            user_id: this.createId(me?.id || config.app_id || ''),
            user_name: me?.name || '',
            user_displayname: me?.name || '',
            avatar: me?.avatar || '',
        };
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        // Teams Bot Framework 不直接支持获取用户信息 API
        // 通常从活动（Activity）中获取用户信息
        throw new Error('Teams 不支持直接获取用户信息，请从消息事件中获取');
    }

    // ============================================
    // 好友（私聊会话）相关方法
    // ============================================

    /**
     * 获取好友列表（Teams 不支持）
     */
    async getFriendList(uin: string, params?: Adapter.GetFriendListParams): Promise<Adapter.FriendInfo[]> {
        // Teams 不提供好友列表 API
        return [];
    }

    /**
     * 获取好友信息
     */
    async getFriendInfo(uin: string, params: Adapter.GetFriendInfoParams): Promise<Adapter.FriendInfo> {
        // Teams Bot Framework 不直接支持获取好友信息 API
        throw new Error('Teams 不支持获取好友信息');
    }

    // ============================================
    // 群组相关方法
    // ============================================

    /**
     * 获取群列表（Teams 不支持）
     */
    async getGroupList(uin: string, params?: Adapter.GetGroupListParams): Promise<Adapter.GroupInfo[]> {
        // Teams 不提供群列表 API
        return [];
    }

    /**
     * 获取群信息
     */
    async getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        // Teams Bot Framework 不直接支持获取群信息 API
        throw new Error('Teams 不支持获取群信息');
    }

    /**
     * 退出群组
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        // Teams Bot Framework 不直接支持退出群组 API
        throw new Error('Teams 不支持退出群组');
    }

    /**
     * 获取群成员列表
     */
    async getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        // Teams Bot Framework 不直接支持获取群成员列表 API
        throw new Error('Teams 不支持获取群成员列表');
    }

    /**
     * 获取群成员信息
     */
    async getGroupMemberInfo(uin: string, params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> {
        // Teams Bot Framework 不直接支持获取群成员信息 API
        throw new Error('Teams 不支持获取群成员信息');
    }

    /**
     * 踢出群成员
     */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        // Teams Bot Framework 不直接支持踢出群成员 API
        throw new Error('Teams 不支持踢出群成员');
    }

    /**
     * 设置群名片（Teams 不支持）
     */
    async setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        throw new Error('Teams 不支持设置群名片');
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: 'onebots Teams Adapter',
            app_version: '1.0.0',
            impl: 'teams',
            version: '1.0.0',
        };
    }

    // ============================================
    // 账号管理
    // ============================================

    /**
     * 创建账号实例
     */
    createAccount(config: Account.Config<'teams'>): Account<'teams', TeamsBot> {
        const teamsConfig: TeamsConfig = {
            account_id: config.account_id,
            app_id: config.app_id,
            app_password: config.app_password,
            webhook: config.webhook,
            channel_service: config.channel_service,
            open_id_metadata: config.open_id_metadata,
        };

        const bot = new TeamsBot(teamsConfig);
        const account = new Account<'teams', TeamsBot>(this, bot, config);
        
        // 注册 Webhook 路由
        this.app.router.post(`${account.path}/webhook`, bot.handleWebhook.bind(bot));

        // 监听 Bot 事件
        bot.on('ready', () => {
            this.logger.info(`Teams Bot ${config.account_id} 已就绪`);
            account.status = AccountStatus.Online;
        });

        bot.on('error', (error: Error) => {
            this.logger.error(`Teams Bot ${config.account_id} 错误:`, error);
            account.status = AccountStatus.OffLine;
            this.emit('error', { account_id: config.account_id, error });
        });

        bot.on('stopped', () => {
            account.status = AccountStatus.OffLine;
        });

        // 监听 Teams 事件并转换为适配器事件
        bot.on('private_message', (event: TeamsEvent) => {
            this.handlePrivateMessage(account, event);
        });

        bot.on('group_message', (event: TeamsEvent) => {
            this.handleGroupMessage(account, event);
        });

        bot.on('message_edited', (event: TeamsEvent) => {
            this.handleMessageEdited(account, event);
        });

        bot.on('message_deleted', (event: TeamsEvent) => {
            this.handleMessageDeleted(account, event);
        });

        bot.on('member_joined', (event: TeamsEvent) => {
            this.handleMemberJoined(account, event);
        });

        bot.on('member_left', (event: TeamsEvent) => {
            this.handleMemberLeft(account, event);
        });

        // 启动时初始化 Bot
        account.on('start', async () => {
            try {
                await bot.start();
                account.status = AccountStatus.Online;
                const me = bot.getCachedMe();
                account.nickname = me?.name || 'Teams Bot';
                account.avatar = me?.avatar || this.icon;
            } catch (error) {
                this.logger.error(`启动 Teams Bot 失败:`, error);
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
     * 处理私聊消息
     */
    private handlePrivateMessage(account: Account<'teams', TeamsBot>, event: TeamsEvent): void {
        const activity = event.activity;
        const message = this.transformMessage(activity);
        
        // 转换为 CommonEvent 格式
        const commonEvent: CommonEvent.Message = {
            id: this.createId(activity.id),
            timestamp: new Date(activity.timestamp).getTime(),
            platform: 'teams',
            bot_id: this.createId(account.config.account_id),
            type: 'message',
            message_type: 'private',
            sender: {
                id: this.createId(activity.from.id),
                name: activity.from.name || '',
                avatar: undefined,
            },
            message_id: this.createId(activity.id),
            raw_message: activity.text || '',
            message: message.message,
        };

        this.emit('message', commonEvent);
    }

    /**
     * 处理群聊消息
     */
    private handleGroupMessage(account: Account<'teams', TeamsBot>, event: TeamsEvent): void {
        const activity = event.activity;
        const message = this.transformMessage(activity);
        
        // 转换为 CommonEvent 格式
        const commonEvent: CommonEvent.Message = {
            id: this.createId(activity.id),
            timestamp: new Date(activity.timestamp).getTime(),
            platform: 'teams',
            bot_id: this.createId(account.config.account_id),
            type: 'message',
            message_type: 'group',
            sender: {
                id: this.createId(activity.from.id),
                name: activity.from.name || '',
                avatar: undefined,
            },
            message_id: this.createId(activity.id),
            raw_message: activity.text || '',
            message: message.message,
            group: {
                id: this.createId(activity.conversation.id),
                name: activity.conversation.name || '',
            },
        };

        this.emit('message', commonEvent);
    }

    /**
     * 处理消息编辑
     */
    private handleMessageEdited(account: Account<'teams', TeamsBot>, event: TeamsEvent): void {
        const activity = event.activity;
        const message = this.transformMessage(activity);
        
        // 转换为 CommonEvent 格式
        const commonEvent: CommonEvent.Message = {
            id: this.createId(activity.id),
            timestamp: new Date(activity.timestamp).getTime(),
            platform: 'teams',
            bot_id: this.createId(account.config.account_id),
            type: 'message',
            message_type: activity.conversation.isGroup ? 'group' : 'private',
            sender: {
                id: this.createId(activity.from.id),
                name: activity.from.name || '',
                avatar: undefined,
            },
            message_id: this.createId(activity.id),
            raw_message: activity.text || '',
            message: message.message,
        };

        this.emit('message.updated', commonEvent);
    }

    /**
     * 处理消息删除
     */
    private handleMessageDeleted(account: Account<'teams', TeamsBot>, event: TeamsEvent): void {
        const activity = event.activity;
        
        this.emit('message.deleted', {
            id: this.createId(activity.id),
            platform: 'teams',
            bot_id: this.createId(account.config.account_id),
        });
    }

    /**
     * 处理成员加入
     */
    private handleMemberJoined(account: Account<'teams', TeamsBot>, event: TeamsEvent): void {
        const activity = event.activity;
        
        this.emit('member.joined', {
            platform: 'teams',
            bot_id: this.createId(account.config.account_id),
            group: {
                id: this.createId(activity.conversation.id),
                name: activity.conversation.name || '',
            },
            user: {
                id: this.createId(activity.from.id),
                name: activity.from.name || '',
            },
        });
    }

    /**
     * 处理成员离开
     */
    private handleMemberLeft(account: Account<'teams', TeamsBot>, event: TeamsEvent): void {
        const activity = event.activity;
        
        this.emit('member.left', {
            platform: 'teams',
            bot_id: this.createId(account.config.account_id),
            group: {
                id: this.createId(activity.conversation.id),
                name: activity.conversation.name || '',
            },
            user: {
                id: this.createId(activity.from.id),
                name: activity.from.name || '',
            },
        });
    }

    /**
     * 转换消息格式
     */
    private transformMessage(activity: any): Adapter.MessageInfo {
        const segments: any[] = [];
        
        if (activity.text) {
            segments.push({
                type: 'text',
                data: { text: activity.text },
            });
        }

        if (activity.attachments && activity.attachments.length > 0) {
            for (const att of activity.attachments) {
                if (att.contentType?.startsWith('image/')) {
                    segments.push({
                        type: 'image',
                        data: { url: att.contentUrl },
                    });
                } else if (att.contentType?.startsWith('video/')) {
                    segments.push({
                        type: 'video',
                        data: { url: att.contentUrl },
                    });
                } else if (att.contentType?.startsWith('audio/')) {
                    segments.push({
                        type: 'audio',
                        data: { url: att.contentUrl },
                    });
                } else {
                    segments.push({
                        type: 'file',
                        data: { url: att.contentUrl, name: att.name },
                    });
                }
            }
        }

        const sceneType = activity.conversation.isGroup ? 'group' : 'private';

        return {
            message_id: this.createId(activity.id),
            time: new Date(activity.timestamp).getTime(),
            sender: {
                scene_type: sceneType,
                sender_id: this.createId(activity.from.id),
                scene_id: this.createId(activity.conversation.id),
                sender_name: activity.from.name || '',
                scene_name: activity.conversation.name || '',
            },
            message: segments.length > 0 ? segments : [{ type: 'text', data: { text: '' } }],
        };
    }
}

// 声明类型扩展
declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            teams: TeamsConfig;
        }
    }
}

AdapterRegistry.register('teams', TeamsAdapter, {
    name: 'teams',
    displayName: 'Microsoft Teams',
    description: 'Microsoft Teams Bot Framework 适配器，支持频道消息、私聊、自适应卡片',
    icon: 'https://teams.microsoft.com/favicon.ico',
    homepage: 'https://dev.botframework.com/',
    author: '凉菜',
});

