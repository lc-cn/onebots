/**
 * Line 适配器
 * 继承 Adapter 基类，实现 Line Messaging API 功能
 */
import { Account, AdapterRegistry, AccountStatus } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { LineBot } from "./bot.js";
import { CommonEvent, CommonTypes } from "onebots";
import type { RouterContext, Next } from "onebots";
import type {
    LineConfig,
    MessageEvent,
    FollowEvent,
    UnfollowEvent,
    JoinEvent,
    LeaveEvent,
    MemberJoinedEvent,
    MemberLeftEvent,
    PostbackEvent,
    WebhookEvent,
    TextMessage,
    ImageMessage,
    VideoMessage,
    AudioMessage,
    FileMessage,
    LocationMessage,
    StickerMessage,
} from "./types.js";

export class LineAdapter extends Adapter<LineBot, "line"> {
    constructor(app: BaseApp) {
        super(app, "line");
        this.icon = "https://line.me/favicon.ico";
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
        const messages: any[] = [];
        let textContent = '';

        for (const seg of message) {
            if (typeof seg === 'string') {
                textContent += seg;
            } else if (seg.type === 'text') {
                textContent += seg.data.text || '';
            } else if (seg.type === 'image') {
                if (textContent) {
                    messages.push({ type: 'text', text: textContent });
                    textContent = '';
                }
                const url = seg.data.url || seg.data.file;
                if (url) {
                    messages.push({
                        type: 'image',
                        originalContentUrl: url,
                        previewImageUrl: url,
                    });
                }
            } else if (seg.type === 'video') {
                if (textContent) {
                    messages.push({ type: 'text', text: textContent });
                    textContent = '';
                }
                const url = seg.data.url || seg.data.file;
                if (url) {
                    messages.push({
                        type: 'video',
                        originalContentUrl: url,
                        previewImageUrl: seg.data.thumbnail || url,
                    });
                }
            } else if (seg.type === 'audio' || seg.type === 'voice' || seg.type === 'record') {
                if (textContent) {
                    messages.push({ type: 'text', text: textContent });
                    textContent = '';
                }
                const url = seg.data.url || seg.data.file;
                if (url) {
                    messages.push({
                        type: 'audio',
                        originalContentUrl: url,
                        duration: seg.data.duration || 60000,
                    });
                }
            } else if (seg.type === 'location') {
                if (textContent) {
                    messages.push({ type: 'text', text: textContent });
                    textContent = '';
                }
                messages.push({
                    type: 'location',
                    title: seg.data.title || '位置',
                    address: seg.data.address || '',
                    latitude: seg.data.lat || seg.data.latitude,
                    longitude: seg.data.lon || seg.data.longitude,
                });
            }
        }

        // 添加剩余文本
        if (textContent) {
            messages.push({ type: 'text', text: textContent });
        }

        // 如果没有消息，返回空
        if (messages.length === 0) {
            throw new Error('No valid message content');
        }

        // 发送消息
        const targetId = sceneId.string;
        const result = await bot.pushMessage(targetId, messages);

        return {
            message_id: this.createId(result.sentMessages?.[0]?.id || Date.now().toString()),
        };
    }

    /**
     * 删除/撤回消息
     * Line 不支持删除消息
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        throw new Error('Line API 不支持删除消息');
    }

    /**
     * 获取消息
     * Line 不支持直接获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        throw new Error('Line API 不支持获取消息');
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
        const info = await bot.getBotInfo();

        return {
            user_id: this.createId(info.userId),
            user_name: info.basicId,
            user_displayname: info.displayName,
            avatar: info.pictureUrl,
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

        const profile = await bot.getProfile(userId);

        return {
            user_id: this.createId(profile.userId),
            user_name: profile.displayName,
            user_displayname: profile.displayName,
            avatar: profile.pictureUrl,
        };
    }

    // ============================================
    // 好友相关方法
    // ============================================

    /**
     * 获取好友列表
     * Line 不提供好友列表 API
     */
    async getFriendList(uin: string, params?: Adapter.GetFriendListParams): Promise<Adapter.FriendInfo[]> {
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

        const profile = await bot.getProfile(userId);

        return {
            user_id: this.createId(profile.userId),
            user_name: profile.displayName,
        };
    }

    // ============================================
    // 群组相关方法
    // ============================================

    /**
     * 获取群组列表
     * Line 不提供群组列表 API
     */
    async getGroupList(uin: string, params?: Adapter.GetGroupListParams): Promise<Adapter.GroupInfo[]> {
        return [];
    }

    /**
     * 获取群组信息
     */
    async getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groupId = params.group_id.string;

        const summary = await bot.getGroupSummary(groupId);
        const count = await bot.getGroupMemberCount(groupId);

        return {
            group_id: this.createId(summary.groupId),
            group_name: summary.groupName,
            member_count: count.count,
        };
    }

    /**
     * 离开群组
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groupId = params.group_id.string;

        await bot.leaveGroup(groupId);
    }

    /**
     * 获取群组成员列表
     */
    async getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groupId = params.group_id.string;

        // 获取所有成员 ID
        const memberIds: string[] = [];
        let next: string | undefined;

        do {
            const result = await bot.getGroupMemberIds(groupId, next);
            memberIds.push(...result.memberIds);
            next = result.next;
        } while (next);

        // 获取每个成员的详细信息
        const members: Adapter.GroupMemberInfo[] = [];
        for (const userId of memberIds) {
            try {
                const profile = await bot.getGroupMemberProfile(groupId, userId);
                members.push({
                    group_id: params.group_id,
                    user_id: this.createId(profile.userId),
                    user_name: profile.displayName,
                    role: 'member',
                });
            } catch {
                // 忽略获取失败的成员
            }
        }

        return members;
    }

    /**
     * 获取群组成员信息
     */
    async getGroupMemberInfo(uin: string, params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groupId = params.group_id.string;
        const userId = params.user_id.string;

        const profile = await bot.getGroupMemberProfile(groupId, userId);

        return {
            group_id: params.group_id,
            user_id: this.createId(profile.userId),
            user_name: profile.displayName,
            role: 'member',
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
            app_name: 'onebots-line',
            app_version: '1.0.0',
            impl: 'line-messaging-api',
            version: 'v2',
        };
    }

    /**
     * 获取运行状态
     */
    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        if (!account) {
            return { good: false };
        }

        return {
            online: true,
            good: true,
        };
    }

    /**
     * 检查是否可以发送图片
     */
    async canSendImage(uin: string): Promise<boolean> {
        return true;
    }

    /**
     * 检查是否可以发送语音
     */
    async canSendRecord(uin: string): Promise<boolean> {
        return true;
    }

    // ============================================
    // 账号创建
    // ============================================

    createAccount(config: Account.Config<'line'>): Account<'line', LineBot> {
        const lineConfig: LineConfig = {
            account_id: config.account_id,
            channel_access_token: config.channel_access_token,
            channel_secret: config.channel_secret,
            proxy: config.proxy,
        };

        const bot = new LineBot(lineConfig);
        const account = new Account<'line', LineBot>(this, bot, config);

        // 设置 Webhook 路由
        const webhookPath = `/line/${config.account_id}/webhook`;
        this.app.router.post(webhookPath, async (ctx: RouterContext, next: Next) => {
            try {
                const signature = ctx.get('x-line-signature') || '';
                const body = ctx.request.rawBody || JSON.stringify(ctx.request.body);

                await bot.handleWebhook(body, signature);
                ctx.body = 'OK';
            } catch (error: any) {
                this.logger.error(`Webhook 处理错误:`, error);
                ctx.status = 400;
                ctx.body = error.message;
            }
        });

        this.logger.info(`Line Webhook 已注册: ${webhookPath}`);

        // 监听消息事件
        bot.on('message', (event: MessageEvent) => {
            const message = event.message;
            const source = event.source;

            // 构建消息段
            const messageSegments: CommonTypes.Segment[] = [];

            switch (message.type) {
                case 'text':
                    const textMsg = message as TextMessage;
                    messageSegments.push({
                        type: 'text',
                        data: { text: textMsg.text }
                    });
                    break;

                case 'image':
                    const imageMsg = message as ImageMessage;
                    messageSegments.push({
                        type: 'image',
                        data: {
                            file: imageMsg.id,
                            url: imageMsg.contentProvider.originalContentUrl,
                        }
                    });
                    break;

                case 'video':
                    const videoMsg = message as VideoMessage;
                    messageSegments.push({
                        type: 'video',
                        data: {
                            file: videoMsg.id,
                            url: videoMsg.contentProvider.originalContentUrl,
                        }
                    });
                    break;

                case 'audio':
                    const audioMsg = message as AudioMessage;
                    messageSegments.push({
                        type: 'voice',
                        data: {
                            file: audioMsg.id,
                            url: audioMsg.contentProvider.originalContentUrl,
                        }
                    });
                    break;

                case 'file':
                    const fileMsg = message as FileMessage;
                    messageSegments.push({
                        type: 'file',
                        data: {
                            file: fileMsg.id,
                            filename: fileMsg.fileName,
                        }
                    });
                    break;

                case 'location':
                    const locMsg = message as LocationMessage;
                    messageSegments.push({
                        type: 'location',
                        data: {
                            lat: locMsg.latitude,
                            lon: locMsg.longitude,
                            title: locMsg.title,
                            address: locMsg.address,
                        }
                    });
                    break;

                case 'sticker':
                    const stickerMsg = message as StickerMessage;
                    messageSegments.push({
                        type: 'face',
                        data: {
                            id: `${stickerMsg.packageId}:${stickerMsg.stickerId}`,
                        }
                    });
                    break;
            }

            // 确定消息类型
            let messageType: CommonEvent.MessageScene;
            let group: CommonTypes.Group | undefined;

            if (source.type === 'user') {
                messageType = 'private';
            } else if (source.type === 'group') {
                messageType = 'group';
                group = {
                    id: this.createId(source.groupId),
                    name: '',
                };
            } else {
                messageType = 'group';
                group = {
                    id: this.createId((source as any).roomId),
                    name: 'Room',
                };
            }

            // 打印日志
            const textContent = message.type === 'text' ? (message as TextMessage).text : `[${message.type}]`;
            const preview = textContent.length > 50 ? textContent.substring(0, 50) + '...' : textContent;
            this.logger.info(
                `[LINE] 收到${messageType === 'private' ? '私聊' : '群组'}消息 | ` +
                `消息ID: ${message.id} | 发送者: ${source.userId || 'unknown'} | 内容: ${preview}`
            );

            // 构建事件
            const commonEvent: CommonEvent.Message = {
                id: this.createId(event.webhookEventId),
                timestamp: event.timestamp,
                platform: 'line',
                bot_id: this.createId(config.account_id),
                type: 'message',
                message_type: messageType,
                sender: {
                    id: this.createId(source.userId || 'unknown'),
                    name: '',
                },
                group,
                message_id: this.createId(message.id),
                raw_message: message.type === 'text' ? (message as TextMessage).text : '',
                message: messageSegments,
            };

            // 保存 replyToken 用于快速回复
            (commonEvent as any).replyToken = event.replyToken;

            account.dispatch(commonEvent);
        });

        // 监听关注事件
        bot.on('follow', (event: FollowEvent) => {
            const commonEvent: CommonEvent.Notice = {
                id: this.createId(event.webhookEventId),
                timestamp: event.timestamp,
                platform: 'line',
                bot_id: this.createId(config.account_id),
                type: 'notice',
                notice_type: 'friend_add',
                user: {
                    id: this.createId(event.source.userId || 'unknown'),
                    name: '',
                },
            };

            account.dispatch(commonEvent);
        });

        // 监听取消关注事件
        bot.on('unfollow', (event: UnfollowEvent) => {
            this.logger.info(`[LINE] 用户取消关注: ${event.source.userId}`);
        });

        // 监听加入群组事件
        bot.on('join', (event: JoinEvent) => {
            const source = event.source;
            const groupId = source.type === 'group' ? source.groupId : (source as any).roomId;

            this.logger.info(`[LINE] 机器人加入群组: ${groupId}`);
        });

        // 监听离开群组事件
        bot.on('leave', (event: LeaveEvent) => {
            const source = event.source;
            const groupId = source.type === 'group' ? source.groupId : (source as any).roomId;

            this.logger.info(`[LINE] 机器人离开群组: ${groupId}`);
        });

        // 监听成员加入事件
        bot.on('memberJoined', (event: MemberJoinedEvent) => {
            const source = event.source;
            const groupId = source.type === 'group' ? source.groupId : (source as any).roomId;

            for (const member of event.joined.members) {
                const commonEvent: CommonEvent.Notice = {
                    id: this.createId(event.webhookEventId),
                    timestamp: event.timestamp,
                    platform: 'line',
                    bot_id: this.createId(config.account_id),
                    type: 'notice',
                    notice_type: 'group_increase',
                    user: {
                        id: this.createId(member.userId),
                        name: '',
                    },
                    group: {
                        id: this.createId(groupId),
                        name: '',
                    },
                };

                account.dispatch(commonEvent);
            }
        });

        // 监听成员离开事件
        bot.on('memberLeft', (event: MemberLeftEvent) => {
            const source = event.source;
            const groupId = source.type === 'group' ? source.groupId : (source as any).roomId;

            for (const member of event.left.members) {
                const commonEvent: CommonEvent.Notice = {
                    id: this.createId(event.webhookEventId),
                    timestamp: event.timestamp,
                    platform: 'line',
                    bot_id: this.createId(config.account_id),
                    type: 'notice',
                    notice_type: 'group_decrease',
                    user: {
                        id: this.createId(member.userId),
                        name: '',
                    },
                    group: {
                        id: this.createId(groupId),
                        name: '',
                    },
                };

                account.dispatch(commonEvent);
            }
        });

        // 启动时验证配置
        account.on('start', async () => {
            try {
                const info = await bot.getBotInfo();
                this.logger.info(`Line Bot ${info.displayName} 已就绪`);
                account.status = AccountStatus.Online;
                account.nickname = info.displayName;
                account.avatar = info.pictureUrl;
            } catch (error) {
                this.logger.error(`启动 Line Bot 失败:`, error);
                account.status = AccountStatus.OffLine;
            }
        });

        account.on('stop', () => {
            account.status = AccountStatus.OffLine;
        });

        return account;
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            line: LineConfig;
        }
    }
}

AdapterRegistry.register('line', LineAdapter, {
    name: 'line',
    displayName: 'Line Messaging API',
    description: 'Line Messaging API 适配器，支持私聊和群组消息',
    icon: 'https://line.me/favicon.ico',
    homepage: 'https://developers.line.biz/',
    author: '凉菜',
});

