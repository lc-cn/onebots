/**
 * 微信公众号适配器
 * 继承 Adapter 基类，重写支持的方法实现微信公众号功能
 * - 消息收发（sendMessage）
 * - 粉丝管理（getFriendList, getFriendInfo等，对应微信的关注用户）
 * - 标签管理（getGroupList, getGroupInfo等，对应微信的用户标签）
 */
import { Account,AdapterRegistry, AccountStatus } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { WechatBot } from "./bot.js";
import { CommonEvent,CommonTypes } from "onebots";
import type { WechatConfig } from "./types.js";

export default class WechatAdapter extends Adapter<WechatBot, "wechat"> {
    constructor(app: BaseApp) {
        super(app, "wechat");
        this.icon = "https://res.wx.qq.com/a/wx_fed/assets/res/OTE0YTAw.png";
    }

    // ============================================
    // 消息相关方法
    // ============================================

    /**
     * 发送消息
     * 微信公众号只支持私聊消息（给关注用户发消息）
     * 
     * 发送策略：
     * 1. 优先使用被动回复（5秒内收到用户消息）- 无限制，订阅号可用
     * 2. 否则使用客服消息（需要服务号权限）- 48小时内5条
     */
    async sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const { scene_id, scene_type, message } = params;

        if (scene_type !== "private") {
            throw new Error(`微信公众号只支持私聊消息 (private)，不支持 ${scene_type}`);
        }

        const openid = scene_id.string;
        let messageId: string;

        // 检查是否强制使用客服消息
        const forceActive = (params as any).forceActive === true;

        // 解析消息内容
        if (typeof message === 'string') {
            messageId = await bot.sendText(openid, message, forceActive);
        } else if (Array.isArray(message)) {
            // 处理消息段，提取文本和图片
            const textParts: string[] = [];

            for (const seg of message) {
                if (typeof seg === 'string') {
                    textParts.push(seg);
                } else if (seg.type === 'text') {
                    textParts.push(seg.data.text || '');
                } else if (seg.type === 'at') {
                    textParts.push(`@${seg.data.name || seg.data.qq || 'user'}`);
                } else if (seg.type === 'image') {
                    // 微信公众号图片需要先上传获取 media_id，这里简化处理
                    if (seg.data.url) {
                        textParts.push(`[图片: ${seg.data.url}]`);
                    }
                }
            }

            const content = textParts.join('');
            if (content) {
                messageId = await bot.sendText(openid, content, forceActive);
            } else {
                throw new Error('消息内容为空');
            }
        } else {
            throw new Error('不支持的消息格式');
        }

        return {
            message_id: this.createId(messageId),
        };
    }

    // ============================================
    // 用户相关方法
    // ============================================

    /**
     * 获取机器人信息（公众号自身信息）
     */
    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        return {
            user_id: this.createId(uin),
            user_name: account.nickname || '微信公众号',
            avatar: account.avatar,
        };
    }

    /**
     * 获取用户信息（粉丝信息）
     */
    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const openid = params.user_id.string;
        const user = await bot.getUserInfo(openid);

        return {
            user_id: this.createId(user.openid),
            user_name: user.nickname || user.openid,
            user_displayname: user.nickname,
            avatar: user.headimgurl,
        };
    }

    // ============================================
    // 好友（粉丝）相关方法
    // ============================================

    /**
     * 获取好友列表（粉丝列表）
     */
    async getFriendList(uin: string, params?: Adapter.GetFriendListParams): Promise<Adapter.FriendInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const friends: Adapter.FriendInfo[] = [];
        let nextOpenid: string | undefined;

        // 分页获取所有粉丝
        do {
            const userList = await bot.getUserList(nextOpenid);
            
            if (userList.data && userList.data.openid && userList.data.openid.length > 0) {
                // 批量获取用户详细信息
                const users = await bot.batchGetUserInfo(userList.data.openid);
                
                for (const user of users) {
                    if (user.subscribe === 1) {  // 只返回已关注的用户
                        friends.push({
                            user_id: this.createId(user.openid),
                            user_name: user.nickname || user.openid,
                            remark: user.remark,
                        });
                    }
                }
            }

            nextOpenid = userList.next_openid;
        } while (nextOpenid);

        return friends;
    }

    /**
     * 获取好友信息（粉丝信息）
     */
    async getFriendInfo(uin: string, params: Adapter.GetFriendInfoParams): Promise<Adapter.FriendInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const openid = params.user_id.string;
        const user = await bot.getUserInfo(openid);

        return {
            user_id: this.createId(user.openid),
            user_name: user.nickname || user.openid,
            remark: user.remark,
        };
    }

    // ============================================
    // 群组（标签）相关方法
    // 微信公众号使用"标签"来分组管理粉丝
    // ============================================

    /**
     * 获取群列表（标签列表）
     */
    async getGroupList(uin: string, params?: Adapter.GetGroupListParams): Promise<Adapter.GroupInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const tags = await bot.getTags();

        return tags.map(tag => ({
            group_id: this.createId(tag.id),
            group_name: tag.name,
            member_count: tag.count,
        }));
    }

    /**
     * 获取群信息（标签信息）
     */
    async getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const tagId = params.group_id.number;
        const tags = await bot.getTags();
        
        const tag = tags.find(t => t.id === tagId);
        if (!tag) {
            throw new Error(`标签 ${tagId} 不存在`);
        }

        return {
            group_id: this.createId(tag.id),
            group_name: tag.name,
            member_count: tag.count,
        };
    }

    /**
     * 设置群名称（标签名称）
     */
    async setGroupName(uin: string, params: Adapter.SetGroupNameParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const tagId = params.group_id.number;
        await bot.updateTag(tagId, params.group_name);
    }

    /**
     * 获取群成员列表（标签下的粉丝列表）
     */
    async getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const tagId = params.group_id.number;
        const members: Adapter.GroupMemberInfo[] = [];
        let nextOpenid: string | undefined;

        // 分页获取标签下的所有用户
        do {
            const userList = await bot.getTagUsers(tagId, nextOpenid);
            
            if (userList.data && userList.data.openid && userList.data.openid.length > 0) {
                // 批量获取用户详细信息
                const users = await bot.batchGetUserInfo(userList.data.openid);
                
                for (const user of users) {
                    members.push({
                        group_id: params.group_id,
                        user_id: this.createId(user.openid),
                        user_name: user.nickname || user.openid,
                        card: user.remark,
                        role: 'member',
                    });
                }
            }

            nextOpenid = userList.next_openid;
        } while (nextOpenid);

        return members;
    }

    /**
     * 获取群成员信息（粉丝在标签中的信息）
     */
    async getGroupMemberInfo(uin: string, params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const openid = params.user_id.string;
        const user = await bot.getUserInfo(openid);

        return {
            group_id: params.group_id,
            user_id: this.createId(user.openid),
            user_name: user.nickname || user.openid,
            card: user.remark,
            role: 'member',
        };
    }

    /**
     * 设置群名片（设置用户备注）
     */
    async setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const openid = params.user_id.string;
        await bot.updateUserRemark(openid, params.card);
    }

    // ============================================
    // 账号创建
    // ============================================

    createAccount(config: Account.Config<'wechat'>): Account<'wechat', WechatBot> {
        const wechatConfig: WechatConfig = {
            account_id: config.account_id,
            appId: config.appId,
            appSecret: config.appSecret,
            token: config.token,
            encodingAESKey: config.encodingAESKey,
        };

        const bot = new WechatBot(wechatConfig);
        const account = new Account<'wechat', WechatBot>(this, bot, config);
        this.app.router.all(`${account.path}/webhook`,bot.handleWebhook.bind(bot));
        // 监听 Bot 事件
        bot.on('ready', () => {
            this.logger.info(`微信公众号 ${config.account_id} 已就绪`);
        });

        bot.on('error', (error) => {
            this.logger.error(`微信公众号 ${config.account_id} 错误:`, error);
        });

        bot.on('token_refreshed', (token) => {
            this.logger.debug(`Access Token 已刷新`);
        });

        // 监听消息事件
        bot.on('message', (message: any) => {
            this.logger.debug(`收到消息:`, message);
            
            // 构建消息段
            const messageSegments: any[] = [];
            switch (message.MsgType) {
                case 'text':
                    messageSegments.push({
                        type: 'text',
                        data: { text: message.Content || '' }
                    });
                    break;
                case 'image':
                    messageSegments.push({
                        type: 'image',
                        data: { 
                            file: message.MediaId,
                            url: message.PicUrl 
                        }
                    });
                    break;
                case 'voice':
                    messageSegments.push({
                        type: 'voice',
                        data: { 
                            file: message.MediaId,
                            format: message.Format
                        }
                    });
                    break;
                case 'video':
                    messageSegments.push({
                        type: 'video',
                        data: { 
                            file: message.MediaId,
                            thumb: message.ThumbMediaId
                        }
                    });
                    break;
                default:
                    messageSegments.push({
                        type: 'text',
                        data: { text: '[不支持的消息类型]' }
                    });
            }
            
            // 转换为 CommonEvent 格式
            const commonEvent: CommonEvent.Message = {
                id: this.createId(message.MsgId || Date.now().toString()),
                timestamp: (message.CreateTime || Date.now()) * 1000,
                platform: 'wechat',
                bot_id: this.createId(config.account_id),
                type: 'message',
                message_type: 'private' as const,  // 公众号只有私聊
                sender: {
                    id: this.createId(message.FromUserName),
                    name: message.FromUserName,
                },
                message_id: this.createId(message.MsgId),
                raw_message: message.Content || message.MediaId || '',
                message: messageSegments,
            };

            // 派发到协议层
            account.dispatch(commonEvent);
        });

        // 监听关注事件
        bot.on('event.subscribe', (message: any) => {
            this.logger.info(`用户关注: ${message.FromUserName}`);
            
            const commonEvent: CommonEvent.Notice = {
                id: this.createId(Date.now().toString()),
                timestamp: (message.CreateTime || Date.now()) * 1000,
                platform: 'wechat',
                bot_id: this.createId(config.account_id),
                type: 'notice',
                notice_type: 'friend_add' as const,
                user: {
                    id: this.createId(message.FromUserName),
                    name: message.FromUserName,
                },
            };

            account.dispatch(commonEvent);
        });

        // 监听取消关注事件
        bot.on('event.unsubscribe', (message: any) => {
            this.logger.info(`用户取消关注: ${message.FromUserName}`);
            
            const commonEvent: CommonEvent.Notice = {
                id: this.createId(Date.now().toString()),
                timestamp: (message.CreateTime || Date.now()) * 1000,
                platform: 'wechat',
                bot_id: this.createId(config.account_id),
                type: 'notice',
                notice_type: 'custom' as const,
                sub_type: 'unsubscribe',
                user: {
                    id: this.createId(message.FromUserName),
                    name: message.FromUserName,
                },
            };

            account.dispatch(commonEvent);
        });

        // 监听扫码事件
        bot.on('event.scan', (message: any) => {
            this.logger.info(`用户扫码: ${message.FromUserName}, EventKey: ${message.EventKey}`);
            
            const commonEvent: CommonEvent.Notice = {
                id: this.createId(Date.now().toString()),
                timestamp: (message.CreateTime || Date.now()) * 1000,
                platform: 'wechat',
                bot_id: this.createId(config.account_id),
                type: 'notice',
                notice_type: 'custom' as const,
                sub_type: 'scan',
                user: {
                    id: this.createId(message.FromUserName),
                    name: message.FromUserName,
                },
                event_key: message.EventKey,
                ticket: message.Ticket,
            };

            account.dispatch(commonEvent);
        });

        // 监听位置事件
        bot.on('event.location', (message: any) => {
            this.logger.debug(`用户上报位置: ${message.FromUserName}`);
            
            const commonEvent: CommonEvent.Notice = {
                id: this.createId(Date.now().toString()),
                timestamp: (message.CreateTime || Date.now()) * 1000,
                platform: 'wechat',
                bot_id: this.createId(config.account_id),
                type: 'notice',
                notice_type: 'custom' as const,
                sub_type: 'location',
                user: {
                    id: this.createId(message.FromUserName),
                    name: message.FromUserName,
                },
                latitude: message.Latitude,
                longitude: message.Longitude,
                precision: message.Precision,
            };

            account.dispatch(commonEvent);
        });

        // 监听菜单点击事件
        bot.on('event.click', (message: any) => {
            this.logger.debug(`菜单点击: ${message.EventKey}`);
            
            const commonEvent: CommonEvent.Notice = {
                id: this.createId(Date.now().toString()),
                timestamp: (message.CreateTime || Date.now()) * 1000,
                platform: 'wechat',
                bot_id: this.createId(config.account_id),
                type: 'notice',
                notice_type: 'custom' as const,
                sub_type: 'menu_click',
                user: {
                    id: this.createId(message.FromUserName),
                    name: message.FromUserName,
                },
                event_key: message.EventKey,
            };

            account.dispatch(commonEvent);
        });

        // 监听菜单跳转事件
        bot.on('event.view', (message: any) => {
            this.logger.debug(`菜单跳转: ${message.EventKey}`);
            
            const commonEvent: CommonEvent.Notice = {
                id: this.createId(Date.now().toString()),
                timestamp: (message.CreateTime || Date.now()) * 1000,
                platform: 'wechat',
                bot_id: this.createId(config.account_id),
                type: 'notice',
                notice_type: 'custom' as const,
                sub_type: 'menu_view',
                user: {
                    id: this.createId(message.FromUserName),
                    name: message.FromUserName,
                },
                event_key: message.EventKey,
            };

            account.dispatch(commonEvent);
        });

        // 启动时初始化 Bot
        account.on('start', async () => {
            try {
                await bot.start();
                account.status = AccountStatus.Online;
                account.nickname = (config as any).nickname || '微信公众号';
                account.avatar = this.icon;
            } catch (error) {
                this.logger.error(`启动微信公众号失败:`, error);
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
            wechat: WechatConfig;
        }
    }
}
AdapterRegistry.register('wechat', WechatAdapter);
// 导出类型
export type { WechatConfig } from './types.js';
