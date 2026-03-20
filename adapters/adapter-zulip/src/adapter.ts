/**
 * Zulip 适配器
 * 继承 Adapter 基类，实现 Zulip 平台功能
 */
import { Account, AdapterRegistry, AccountStatus } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { ZulipBot } from "./bot.js";
import { CommonEvent, type CommonTypes } from "onebots";
import type {
    ZulipConfig,
    ZulipMessageEvent,
    ZulipSendMessageParams,
} from "./types.js";

export class ZulipAdapter extends Adapter<ZulipBot, "zulip"> {
    constructor(app: BaseApp) {
        super(app, "zulip");
        this.icon = "https://zulip.com/static/images/logo/zulip-icon-circle.png";
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
        const { scene_id, scene_type, message } = params;

        // 解析消息内容
        let text = '';
        for (const seg of message) {
            if (typeof seg === 'string') {
                text += seg;
            } else if (seg.type === 'text') {
                text += seg.data.text || '';
            } else if (seg.type === 'image') {
                // Zulip 支持 Markdown 图片语法
                const imageUrl = seg.data.url || seg.data.file;
                text += `\n![${seg.data.caption || 'image'}](${imageUrl})`;
            } else if (seg.type === 'file') {
                const fileUrl = seg.data.url || seg.data.file;
                text += `\n[${seg.data.name || 'file'}](${fileUrl})`;
            }
        }

        if (!text) {
            throw new Error('No valid message content');
        }

        // 解析 scene_id
        // stream 消息格式: "stream_name" 或 "stream_name/topic"
        // private 消息格式: "email" 或 "email1,email2"
        const sceneIdStr = sceneId.string;
        let sendParams: ZulipSendMessageParams;

        if (scene_type === 'group' || sceneIdStr.includes('/')) {
            // 流消息
            const parts = sceneIdStr.split('/');
            const streamName = parts[0];
            const topic = parts[1] || 'general';

            sendParams = {
                type: 'stream',
                to: streamName,
                topic: topic,
                content: text,
            };
        } else {
            // 私聊消息
            const emails = sceneIdStr.includes(',') 
                ? sceneIdStr.split(',').map(e => e.trim())
                : [sceneIdStr];

            sendParams = {
                type: 'private',
                to_emails: emails,
                content: text,
            };
        }

        const result = await bot.sendMessage(sendParams);

        return {
            message_id: this.createId(result.id?.toString() || result.message_id?.toString() || Date.now().toString()),
        };
    }

    /**
     * 删除/撤回消息
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const messageId = parseInt(params.message_id.string);
        await bot.deleteMessage(messageId);
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        // Zulip API 不直接支持获取单条消息
        throw new Error('Zulip API 不支持直接获取消息');
    }

    /**
     * 更新消息
     */
    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const messageId = parseInt(params.message_id.string);

        // 解析消息内容
        let text = '';

        for (const seg of params.message) {
            if (typeof seg === 'string') {
                text += seg;
            } else if (seg.type === 'text') {
                text += seg.data.text || '';
            }
        }

        // Zulip 的 updateMessage 不需要 topic，因为消息已经存在于某个话题中
        await bot.updateMessage(messageId, text);
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
            user_id: this.createId(me.user_id.toString()),
            user_name: me.email,
            user_displayname: me.full_name,
            avatar: me.avatar_url || undefined,
        };
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = parseInt(params.user_id.string);
        const user = await bot.getUserInfo(userId);

        return {
            user_id: params.user_id,
            user_name: user.user.email,
            user_displayname: user.user.full_name,
            avatar: user.user.avatar_url || undefined,
        };
    }

    // ============================================
    // 好友（私聊会话）相关方法
    // ============================================

    /**
     * 获取好友列表（Zulip 不支持）
     */
    async getFriendList(uin: string, params?: Adapter.GetFriendListParams): Promise<Adapter.FriendInfo[]> {
        // Zulip 不提供好友列表概念
        return [];
    }

    /**
     * 获取好友信息
     */
    async getFriendInfo(uin: string, params: Adapter.GetFriendInfoParams): Promise<Adapter.FriendInfo> {
        // 使用 getUserInfo
        const userInfo = await this.getUserInfo(uin, { user_id: params.user_id });
        return {
            user_id: userInfo.user_id,
            user_name: userInfo.user_name,
            // Zulip 不提供备注功能，使用显示名称作为备注
            remark: userInfo.user_displayname,
        };
    }

    // ============================================
    // 群组相关方法
    // ============================================

    /**
     * 获取群列表（流列表）
     */
    async getGroupList(uin: string, params?: Adapter.GetGroupListParams): Promise<Adapter.GroupInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const streams = await bot.getStreams();

        return streams.streams.map((stream: any) => ({
            group_id: this.createId(stream.stream_id.toString()),
            group_name: stream.name,
        }));
    }

    /**
     * 获取群信息（流信息）
     */
    async getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const streams = await bot.getStreams();
        const streamId = parseInt(params.group_id.string);
        const stream = streams.streams.find((s: any) => s.stream_id === streamId);

        if (!stream) {
            throw new Error(`Stream ${streamId} not found`);
        }

        return {
            group_id: params.group_id,
            group_name: stream.name,
        };
    }

    /**
     * 退出群组（Zulip 不支持）
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        throw new Error('Zulip API 不支持退出流');
    }

    /**
     * 获取群成员列表（Zulip 不支持）
     */
    async getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        // Zulip 不提供流成员列表 API
        return [];
    }

    /**
     * 获取群成员信息（Zulip 不支持）
     */
    async getGroupMemberInfo(uin: string, params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> {
        throw new Error('Zulip API 不支持获取流成员信息');
    }

    /**
     * 踢出群成员（Zulip 不支持）
     */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        throw new Error('Zulip API 不支持踢出流成员');
    }

    /**
     * 设置群名片（Zulip 不支持）
     */
    async setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        throw new Error('Zulip API 不支持设置群名片');
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: 'onebots Zulip Adapter',
            app_version: '1.0.0',
            impl: 'zulip',
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

    createAccount(config: Account.Config<'zulip'>): Account<'zulip', ZulipBot> {
        const zulipConfig: ZulipConfig = {
            account_id: config.account_id,
            serverUrl: config.serverUrl,
            email: config.email,
            apiKey: config.apiKey,
            proxy: config.proxy,
            websocket: config.websocket,
        };

        const bot = new ZulipBot(zulipConfig);
        const account = new Account<'zulip', ZulipBot>(this, bot, config);

        // 监听 Bot 事件
        bot.on('ready', () => {
            this.logger.info(`Zulip Bot ${config.account_id} 已就绪`);
        });

        bot.on('error', (error) => {
            this.logger.error(`Zulip Bot ${config.account_id} 错误:`, error);
        });

        // 监听收到的消息
        bot.on('message', (message: ZulipMessageEvent) => {
            // 忽略自己发送的消息
            const config = account.config as ZulipConfig;
            if (message.sender_email === config.email) {
                return;
            }

            // 打印消息接收日志
            const contentPreview = message.content.length > 100 
                ? message.content.substring(0, 100) + '...' 
                : message.content;
            const location = message.message_type === 'stream'
                ? `${message.stream_name}/${message.topic}`
                : 'private';
            this.logger.info(
                `[Zulip] 收到消息 | 消息ID: ${message.id} | 位置: ${location} | ` +
                `发送者: ${message.sender_full_name} | 内容: ${contentPreview}`
            );

            // 构建消息段
            const messageSegments: any[] = [];
            messageSegments.push({
                type: 'text',
                data: { text: message.content },
            });

            // 转换为 CommonEvent 格式
            const commonEvent: CommonEvent.Message = {
                id: this.createId(message.id.toString()),
                timestamp: message.timestamp * 1000,
                platform: 'zulip',
                bot_id: this.createId(config.account_id),
                type: 'message',
                message_type: message.message_type === 'stream' ? 'group' : 'private',
                sender: {
                    id: this.createId(message.sender_id.toString()),
                    name: message.sender_full_name,
                    avatar: undefined,
                },
                message_id: this.createId(message.id.toString()),
                raw_message: message.content,
                message: messageSegments,
            };

            // 添加群组信息（如果是流消息）
            if (message.message_type === 'stream' && message.stream_id) {
                commonEvent.group = {
                    id: this.createId(message.stream_id.toString()),
                    name: message.stream_name || '',
                };
            }

            // 派发到协议层
            account.dispatch(commonEvent);
        });

        // 监听消息更新
        bot.on('update_message', (event: any) => {
            this.logger.debug(`[Zulip] 消息已更新: ${event.message_id}`);
        });

        // 监听消息删除
        bot.on('delete_message', (event: any) => {
            this.logger.debug(`[Zulip] 消息已删除: ${event.message_id}`);
        });

        // 启动时初始化 Bot
        account.on('start', async () => {
            try {
                await bot.start();
                account.status = AccountStatus.Online;
                const me = await bot.getMe();
                account.nickname = me.full_name;
                account.avatar = me.avatar_url || undefined;
            } catch (error) {
                this.logger.error(`启动 Zulip Bot 失败:`, error);
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
            zulip: ZulipConfig;
        }
    }
}

AdapterRegistry.register('zulip', ZulipAdapter, {
    name: 'zulip',
    displayName: 'Zulip 适配器',
    description: 'Zulip 适配器，支持流消息和私聊消息，基于 REST API 和 WebSocket',
    icon: 'https://zulip.com/static/images/logo/zulip-icon-circle.png',
    homepage: 'https://zulip.com/',
    author: '凉菜',
});

