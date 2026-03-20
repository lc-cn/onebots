/**
 * 飞书适配器
 * 继承 Adapter 基类，实现飞书平台功能
 */
import { Account, AdapterRegistry, AccountStatus } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { FeishuBot } from "./bot.js";
import { CommonEvent, type CommonTypes } from "onebots";
import { FeishuEndpoint, type FeishuConfig, type FeishuEvent } from "./types.js";

export class FeishuAdapter extends Adapter<FeishuBot, "feishu"> {
    constructor(app: BaseApp) {
        super(app, "feishu");
        this.icon = "https://open.feishu.cn/favicon.ico";
    }

    /**
     * 根据端点获取对应的图标
     */
    private getIconForEndpoint(endpoint: string): string {
        if (endpoint.includes('larksuite.com')) {
            return 'https://open.larksuite.com/favicon.ico';
        }
        return 'https://open.feishu.cn/favicon.ico';
    }

    /**
     * 判断是否为 Lark（国际版）
     */
    private isLarkEndpoint(endpoint: string): boolean {
        return endpoint.includes('larksuite.com');
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
                    text += '<at user_id="all">所有人</at>';
                } else {
                    text += `<at user_id="${userId}">${seg.data.name || userId}</at>`;
                }
            } else if (seg.type === 'image') {
                // 飞书图片消息需要先上传图片，这里简化处理
                if (seg.data.url || seg.data.file) {
                    text += `[图片: ${seg.data.url || seg.data.file}]`;
                }
            }
        }

        // 构建飞书消息内容
        content.text = text;

        // 根据场景类型发送消息
        let receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id' = 'open_id';
        
        if (scene_type === 'private' || scene_type === 'direct') {
            receiveIdType = 'open_id';
        } else if (scene_type === 'group' || scene_type === 'channel') {
            receiveIdType = 'chat_id';
        }

        const result = await bot.sendMessage(sceneId.string, receiveIdType, content, 'text');

        return {
            message_id: this.createId(result.data.message_id),
        };
    }

    /**
     * 删除/撤回消息
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msgId = this.coerceId(params.message_id as CommonTypes.Id | string | number).string;
        const chatId = params.scene_id != null ? this.coerceId(params.scene_id as CommonTypes.Id | string | number).string : '';

        // 飞书删除消息 API
        const http = bot.getHttpClient();
        await http.delete(`/im/v1/messages/${msgId}`);
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msgId = this.coerceId(params.message_id as CommonTypes.Id | string | number).string;

        // 飞书获取消息 API
        const http = bot.getHttpClient();
        const response = await http.get(`/im/v1/messages/${msgId}`);

        if (response.data.code !== 0) {
            throw new Error(`获取消息失败: ${response.data.msg}`);
        }

        const msg = response.data.data.items[0];

        return {
            message_id: this.createId(msg.message_id),
            time: parseInt(msg.create_time),
            sender: {
                scene_type: msg.chat_id ? 'group' : 'private',
                sender_id: this.createId(msg.sender.id),
                scene_id: this.createId(msg.chat_id || msg.sender.id),
                sender_name: msg.sender.id,
                scene_name: '',
            },
            message: [{
                type: 'text',
                data: { text: JSON.parse(msg.body.content).text || '' },
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
        const msgId = this.coerceId(params.message_id as CommonTypes.Id | string | number).string;

        // 解析消息内容
        let text = '';
        for (const seg of params.message) {
            if (typeof seg === 'string') {
                text += seg;
            } else if (seg.type === 'text') {
                text += seg.data.text || '';
            }
        }

        // 飞书更新消息 API
        const http = bot.getHttpClient();
        await http.put(`/im/v1/messages/${msgId}`, {
            content: JSON.stringify({ text }),
        });
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
            user_id: this.createId(me?.user_id || me?.open_id || ''),
            user_name: me?.name || '',
            user_displayname: me?.nickname || me?.name || '',
            avatar: me?.avatar_url || me?.avatar_big,
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
            user_id: this.createId(user.user_id || user.open_id),
            user_name: user.name || '',
            user_displayname: user.nickname || user.name || '',
            avatar: user.avatar_url || user.avatar_big,
        };
    }

    // ============================================
    // 好友（私聊会话）相关方法
    // ============================================

    /**
     * 获取好友列表（飞书不支持）
     */
    async getFriendList(uin: string, params?: Adapter.GetFriendListParams): Promise<Adapter.FriendInfo[]> {
        // 飞书不提供好友列表 API
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
            user_id: this.createId(user.user_id || user.open_id),
            user_name: user.name || '',
            remark: user.nickname || user.name || '',
        };
    }

    // ============================================
    // 群组相关方法
    // ============================================

    /**
     * 获取群列表（飞书不支持）
     */
    async getGroupList(uin: string, params?: Adapter.GetGroupListParams): Promise<Adapter.GroupInfo[]> {
        // 飞书不提供群列表 API，需要通过事件订阅获取
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
        const chat = await bot.getChatInfo(chatId);

        return {
            group_id: this.createId(chat.chat_id),
            group_name: chat.name || '',
        };
    }

    /**
     * 退出群组
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const chatId = params.group_id.string;

        // 飞书退出群组 API
        const http = bot.getHttpClient();
        await http.delete(`/im/v1/chats/${chatId}/members/me`);
    }

    /**
     * 获取群成员列表
     */
    async getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const chatId = params.group_id.string;
        const members = await bot.getChatMembers(chatId);

        return members.map((user) => ({
            group_id: params.group_id,
            user_id: this.createId(user.user_id || user.open_id),
            user_name: user.name || '',
            card: user.nickname || user.name || '',
            role: 'member',
        }));
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
            user_id: this.createId(user.user_id || user.open_id),
            user_name: user.name || '',
            card: user.nickname || user.name || '',
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
        const chatId = params.group_id.string;
        const userId = params.user_id.string;

        // 飞书踢出群成员 API
        const http = bot.getHttpClient();
        await http.delete(`/im/v1/chats/${chatId}/members/${userId}`);
    }

    /**
     * 设置群名片（飞书不支持）
     */
    async setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        // 飞书不支持设置群名片
        throw new Error('飞书不支持设置群名片');
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        const account = this.getAccount(uin);
        const isLark = account ? this.isLarkEndpoint(account.client.endpoint) : false;
        const platformName = isLark ? 'Lark' : '飞书';
        
        return {
            app_name: `onebots ${platformName} Adapter`,
            app_version: '1.0.0',
            impl: 'feishu',
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

    createAccount(config: Account.Config<'feishu'>): Account<'feishu', FeishuBot> {
        const feishuConfig: FeishuConfig = {
            account_id: config.account_id,
            app_id: config.app_id,
            app_secret: config.app_secret,
            encrypt_key: config.encrypt_key,
            verification_token: config.verification_token,
            endpoint: config.endpoint,
        };

        const bot = new FeishuBot(feishuConfig);
        const account = new Account<'feishu', FeishuBot>(this, bot, config);
        
        // 根据端点判断是飞书还是 Lark
        const isLark = this.isLarkEndpoint(bot.endpoint);
        const platformName = isLark ? 'Lark' : '飞书';
        const accountIcon = this.getIconForEndpoint(bot.endpoint);

        // Webhook 路由
        this.app.router.post(`${account.path}/webhook`, bot.handleWebhook.bind(bot));

        // 监听 Bot 事件
        bot.on('ready', () => {
            this.logger.info(`${platformName} Bot ${config.account_id} 已就绪 (endpoint: ${bot.endpoint})`);
        });

        bot.on('error', (error) => {
            this.logger.error(`${platformName} Bot ${config.account_id} 错误:`, error);
        });

        // 监听飞书事件
        bot.on('event', (event: FeishuEvent) => {
            this.handleFeishuEvent(account, event);
        });

        // 启动时初始化 Bot
        account.on('start', async () => {
            try {
                await bot.start();
                account.status = AccountStatus.Online;
                const me = bot.getCachedMe();
                account.nickname = me?.name || `${platformName} Bot`;
                account.avatar = me?.avatar_url || accountIcon;
            } catch (error) {
                this.logger.error(`启动 ${platformName} Bot 失败:`, error);
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
     * 处理飞书事件
     */
    private handleFeishuEvent(account: Account<'feishu', FeishuBot>, event: FeishuEvent): void {
        const eventType = event.header.event_type;

        // 处理消息事件
        if (eventType === 'im.message.receive_v1') {
            const message = event.event.message;
            if (!message) return;

            // 忽略自己发送的消息
            const bot = account.client;
            const me = bot.getCachedMe();
            if (me && message.sender.id === me.open_id) return;

            // 打印消息接收日志
            const content = JSON.parse(message.body.content || '{}').text || '';
            const contentPreview = content.length > 100 ? content.substring(0, 100) + '...' : content;
            this.logger.info(
                `[飞书] 收到消息 | 消息ID: ${message.message_id} | ` +
                `发送者: ${message.sender.id} | 内容: ${contentPreview}`
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
            const isGroup = message.chat_id && message.chat_id !== message.sender.id;
            const messageType = isGroup ? 'group' : 'private';

            // 转换为 CommonEvent 格式
            const commonEvent: CommonEvent.Message = {
                id: this.createId(message.message_id),
                timestamp: parseInt(message.create_time) * 1000,
                platform: 'feishu',
                bot_id: this.createId(account.config.account_id),
                type: 'message',
                message_type: messageType,
                sender: {
                    id: this.createId(message.sender.id),
                    name: message.sender.id,
                    avatar: undefined,
                },
                ...(isGroup ? {
                    group: {
                        id: this.createId(message.chat_id),
                        name: '',
                    },
                } : {}),
                message_id: this.createId(message.message_id),
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
            feishu: FeishuConfig;
        }
    }
}

AdapterRegistry.register('feishu', FeishuAdapter, {
    name: 'feishu',
    displayName: '飞书官方机器人',
    description: '飞书官方机器人适配器，支持单聊、群聊和富文本消息',
    icon: 'https://open.feishu.cn/favicon.ico',
    homepage: 'https://open.feishu.cn/',
    author: '凉菜',
});

