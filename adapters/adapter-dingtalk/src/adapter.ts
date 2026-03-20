/**
 * 钉钉适配器
 * 继承 Adapter 基类，实现钉钉平台功能
 */
import { Account, AdapterRegistry, AccountStatus } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { DingTalkBot } from "./bot.js";
import { CommonEvent, type CommonTypes } from "onebots";
import type { DingTalkConfig, DingTalkEvent } from "./types.js";

export class DingTalkAdapter extends Adapter<DingTalkBot, "dingtalk"> {
    constructor(app: BaseApp) {
        super(app, "dingtalk");
        this.icon = "https://open.dingtalk.com/favicon.ico";
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
        const content: any = {};

        for (const seg of message) {
            if (typeof seg === 'string') {
                text += seg;
            } else if (seg.type === 'text') {
                text += seg.data.text || '';
            } else if (seg.type === 'at') {
                const userId = seg.data.qq || seg.data.id || seg.data.user_id;
                if (userId === 'all') {
                    if (!content.at) content.at = {};
                    content.at.isAtAll = true;
                } else {
                    if (!content.at) content.at = {};
                    if (!content.at.atUserIds) content.at.atUserIds = [];
                    content.at.atUserIds.push(userId);
                }
            } else if (seg.type === 'image') {
                // 钉钉图片消息需要先上传图片获取 media_id，这里简化处理
                if (seg.data.url || seg.data.file) {
                    text += `[图片: ${seg.data.url || seg.data.file}]`;
                }
            }
        }

        // 构建消息内容
        content.text = text;

        // 根据场景类型发送消息
        let receiveIdType: 'user' | 'chat' = 'user';
        
        if (scene_type === 'private' || scene_type === 'direct') {
            receiveIdType = 'user';
        } else if (scene_type === 'group' || scene_type === 'channel') {
            receiveIdType = 'chat';
        }

        const result = await bot.sendMessage(sceneId.string, receiveIdType, content, 'text');

        // 钉钉返回的是 task_id，不是 message_id，这里使用 task_id
        return {
            message_id: this.createId((result as any).task_id || Date.now().toString()),
        };
    }

    /**
     * 删除/撤回消息
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        // 钉钉不支持撤回消息
        throw new Error('钉钉不支持撤回消息');
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        // 钉钉不支持直接获取消息
        throw new Error('钉钉不支持直接获取消息');
    }

    /**
     * 更新消息
     */
    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        // 钉钉不支持更新消息
        throw new Error('钉钉不支持更新消息');
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
            user_id: this.createId(me?.userid || ''),
            user_name: me?.name || '',
            user_displayname: me?.name || '',
            avatar: me?.avatar,
        };
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        
        if (bot.getMode() === 'webhook') {
            throw new Error('Webhook 模式不支持获取用户信息');
        }

        const userId = params.user_id.string;
        const user = await bot.getUserInfo(userId);

        return {
            user_id: this.createId(user.userid),
            user_name: user.name || '',
            user_displayname: user.name || '',
            avatar: user.avatar,
        };
    }

    // ============================================
    // 好友（私聊会话）相关方法
    // ============================================

    /**
     * 获取好友列表（钉钉不支持）
     */
    async getFriendList(uin: string, params?: Adapter.GetFriendListParams): Promise<Adapter.FriendInfo[]> {
        // 钉钉不提供好友列表 API
        return [];
    }

    /**
     * 获取好友信息
     */
    async getFriendInfo(uin: string, params: Adapter.GetFriendInfoParams): Promise<Adapter.FriendInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        
        if (bot.getMode() === 'webhook') {
            throw new Error('Webhook 模式不支持获取好友信息');
        }

        const userId = params.user_id.string;
        const user = await bot.getUserInfo(userId);

        return {
            user_id: this.createId(user.userid),
            user_name: user.name || '',
            remark: user.name || '',
        };
    }

    // ============================================
    // 群组相关方法
    // ============================================

    /**
     * 获取群列表（钉钉不支持）
     */
    async getGroupList(uin: string, params?: Adapter.GetGroupListParams): Promise<Adapter.GroupInfo[]> {
        // 钉钉不提供群列表 API，需要通过事件订阅获取
        return [];
    }

    /**
     * 获取群信息
     */
    async getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        // 钉钉不提供直接获取群信息的 API
        throw new Error('钉钉不支持直接获取群信息');
    }

    /**
     * 退出群组
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        // 钉钉不支持退出群组
        throw new Error('钉钉不支持退出群组');
    }

    /**
     * 获取群成员列表
     */
    async getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        // 钉钉不提供群成员列表 API
        throw new Error('钉钉不支持获取群成员列表');
    }

    /**
     * 获取群成员信息
     */
    async getGroupMemberInfo(uin: string, params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        
        if (bot.getMode() === 'webhook') {
            throw new Error('Webhook 模式不支持获取群成员信息');
        }

        const userId = params.user_id.string;
        const user = await bot.getUserInfo(userId);

        return {
            group_id: params.group_id,
            user_id: this.createId(user.userid),
            user_name: user.name || '',
            card: user.name || '',
            role: user.is_admin ? 'admin' : 'member',
        };
    }

    /**
     * 踢出群成员
     */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        // 钉钉不支持踢出群成员
        throw new Error('钉钉不支持踢出群成员');
    }

    /**
     * 设置群名片（钉钉不支持）
     */
    async setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        // 钉钉不支持设置群名片
        throw new Error('钉钉不支持设置群名片');
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: 'onebots 钉钉 Adapter',
            app_version: '1.0.0',
            impl: 'dingtalk',
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

    createAccount(config: Account.Config<'dingtalk'>): Account<'dingtalk', DingTalkBot> {
        const dingtalkConfig: DingTalkConfig = {
            account_id: config.account_id,
            app_key: config.app_key,
            app_secret: config.app_secret,
            agent_id: config.agent_id,
            encrypt_key: config.encrypt_key,
            token: config.token,
            webhook_url: config.webhook_url,
        };

        const bot = new DingTalkBot(dingtalkConfig);
        const account = new Account<'dingtalk', DingTalkBot>(this, bot, config);

        // Webhook 路由（事件订阅）
        this.app.router.post(`${account.path}/webhook`, bot.handleWebhook.bind(bot));

        // 监听 Bot 事件
        bot.on('ready', () => {
            this.logger.info(`钉钉 Bot ${config.account_id} 已就绪`);
        });

        bot.on('error', (error) => {
            this.logger.error(`钉钉 Bot ${config.account_id} 错误:`, error);
        });

        // 监听钉钉事件
        bot.on('event', (event: DingTalkEvent) => {
            this.handleDingTalkEvent(account, event);
        });

        // 启动时初始化 Bot
        account.on('start', async () => {
            try {
                await bot.start();
                account.status = AccountStatus.Online;
                const me = bot.getCachedMe();
                account.nickname = me?.name || '钉钉 Bot';
                account.avatar = me?.avatar || this.icon;
            } catch (error) {
                this.logger.error(`启动钉钉 Bot 失败:`, error);
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
     * 处理钉钉事件
     */
    private handleDingTalkEvent(account: Account<'dingtalk', DingTalkBot>, event: DingTalkEvent): void {
        const eventType = event.eventType;

        // 处理消息事件
        if (eventType === 'chat_update_message' || eventType === 'im.message.receive') {
            const message = event.eventData.msg || event.eventData;
            if (!message) return;

            // 忽略自己发送的消息
            const bot = account.client;
            const me = bot.getCachedMe();
            if (me && message.senderId === me.userid) return;

            // 打印消息接收日志
            const content = message.text?.content || message.content || '';
            const contentPreview = content.length > 100 ? content.substring(0, 100) + '...' : content;
            this.logger.info(
                `[钉钉] 收到消息 | 消息ID: ${message.msgId} | ` +
                `发送者: ${message.senderId} | 内容: ${contentPreview}`
            );

            // 构建消息段
            const messageSegments: any[] = [];
            if (content) {
                messageSegments.push({
                    type: 'text',
                    data: { text: content },
                });
            }

            // 判断是私聊还是群聊
            const isGroup = message.conversationType === '2';
            const messageType = isGroup ? 'group' : 'private';

            // 转换为 CommonEvent 格式
            const commonEvent: CommonEvent.Message = {
                id: this.createId(message.msgId),
                timestamp: message.createAt || Date.now(),
                platform: 'dingtalk',
                bot_id: this.createId(account.config.account_id),
                type: 'message',
                message_type: messageType,
                sender: {
                    id: this.createId(message.senderId),
                    name: message.senderNick || message.senderId,
                    avatar: undefined,
                },
                ...(isGroup ? {
                    group: {
                        id: this.createId(message.conversationId || message.chatid || ''),
                        name: '',
                    },
                } : {}),
                message_id: this.createId(message.msgId),
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
            dingtalk: DingTalkConfig;
        }
    }
}

AdapterRegistry.register('dingtalk', DingTalkAdapter, {
    name: 'dingtalk',
    displayName: '钉钉官方机器人',
    description: '钉钉官方机器人适配器，支持企业内部应用和自定义机器人',
    icon: 'https://open.dingtalk.com/favicon.ico',
    homepage: 'https://open.dingtalk.com/',
    author: '凉菜',
});

