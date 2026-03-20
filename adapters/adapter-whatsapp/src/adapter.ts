/**
 * WhatsApp 适配器
 * 继承 Adapter 基类，实现 WhatsApp Business API 功能
 */
import { Account, AdapterRegistry, AccountStatus, unixSecondsToEventMs } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { WhatsAppBot } from "./bot.js";
import { CommonEvent, type CommonTypes } from "onebots";
import type { RouterContext, Next } from "onebots";
import type {
    WhatsAppConfig,
    WhatsAppMessageEvent,
    WhatsAppSendMessageParams,
} from "./types.js";

export class WhatsAppAdapter extends Adapter<WhatsAppBot, "whatsapp"> {
    constructor(app: BaseApp) {
        super(app, "whatsapp");
        this.icon = "https://static.whatsapp.net/rsrc.php/v3/yz/r/ujTY9i_Jhs7.png";
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
        const sendParams: WhatsAppSendMessageParams = {
            to: sceneId.string, // WhatsApp 电话号码（带国家代码）
            type: 'text',
        };

        // 处理消息段
        for (const seg of message) {
            if (typeof seg === 'string') {
                text += seg;
            } else if (seg.type === 'text') {
                text += seg.data.text || '';
            } else if (seg.type === 'image') {
                // 如果有文本，先发送文本
                if (text) {
                    sendParams.text = { body: text };
                    sendParams.type = 'text';
                    const textResult = await bot.sendMessage(sendParams);
                    text = '';
                }
                // 发送图片
                const imageUrl = seg.data.url || seg.data.file;
                sendParams.type = 'image';
                sendParams.image = {
                    link: imageUrl,
                    caption: seg.data.caption,
                };
                const result = await bot.sendMessage(sendParams);
                return {
                    message_id: this.createId(result.messages[0]?.id || Date.now().toString()),
                };
            } else if (seg.type === 'video') {
                if (text) {
                    sendParams.text = { body: text };
                    sendParams.type = 'text';
                    await bot.sendMessage(sendParams);
                    text = '';
                }
                const videoUrl = seg.data.url || seg.data.file;
                sendParams.type = 'video';
                sendParams.video = {
                    link: videoUrl,
                    caption: seg.data.caption,
                };
                const result = await bot.sendMessage(sendParams);
                return {
                    message_id: this.createId(result.messages[0]?.id || Date.now().toString()),
                };
            } else if (seg.type === 'audio' || seg.type === 'voice' || seg.type === 'record') {
                if (text) {
                    sendParams.text = { body: text };
                    sendParams.type = 'text';
                    await bot.sendMessage(sendParams);
                    text = '';
                }
                const audioUrl = seg.data.url || seg.data.file;
                sendParams.type = 'audio';
                sendParams.audio = {
                    link: audioUrl,
                };
                const result = await bot.sendMessage(sendParams);
                return {
                    message_id: this.createId(result.messages[0]?.id || Date.now().toString()),
                };
            } else if (seg.type === 'file' || seg.type === 'document') {
                if (text) {
                    sendParams.text = { body: text };
                    sendParams.type = 'text';
                    await bot.sendMessage(sendParams);
                    text = '';
                }
                const fileUrl = seg.data.url || seg.data.file;
                sendParams.type = 'document';
                sendParams.document = {
                    link: fileUrl,
                    filename: seg.data.name,
                    caption: seg.data.caption,
                };
                const result = await bot.sendMessage(sendParams);
                return {
                    message_id: this.createId(result.messages[0]?.id || Date.now().toString()),
                };
            } else if (seg.type === 'location') {
                if (text) {
                    sendParams.text = { body: text };
                    sendParams.type = 'text';
                    await bot.sendMessage(sendParams);
                    text = '';
                }
                sendParams.type = 'location';
                sendParams.location = {
                    latitude: seg.data.lat || seg.data.latitude,
                    longitude: seg.data.lon || seg.data.longitude,
                    name: seg.data.title,
                    address: seg.data.address,
                };
                const result = await bot.sendMessage(sendParams);
                return {
                    message_id: this.createId(result.messages[0]?.id || Date.now().toString()),
                };
            }
        }

        // 发送文本消息
        if (text) {
            sendParams.text = { body: text };
            sendParams.type = 'text';
            const result = await bot.sendMessage(sendParams);
            return {
                message_id: this.createId(result.messages[0]?.id || Date.now().toString()),
            };
        }

        throw new Error('No valid message content');
    }

    /**
     * 删除/撤回消息（WhatsApp 不支持）
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        throw new Error('WhatsApp API 不支持删除消息');
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        throw new Error('WhatsApp API 不支持直接获取消息');
    }

    /**
     * 更新消息（WhatsApp 不支持）
     */
    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        throw new Error('WhatsApp API 不支持编辑消息');
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

        const config = account.config as WhatsAppConfig;
        return {
            user_id: this.createId(config.phoneNumberId),
            user_name: config.phoneNumberId,
            user_displayname: config.phoneNumberId,
            avatar: undefined,
        };
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        // WhatsApp API 不直接支持获取用户信息
        // 返回基本信息
        return {
            user_id: params.user_id,
            user_name: params.user_id.string,
            user_displayname: params.user_id.string,
            avatar: undefined,
        };
    }

    // ============================================
    // 好友（私聊会话）相关方法
    // ============================================

    /**
     * 获取好友列表（WhatsApp 不支持）
     */
    async getFriendList(uin: string, params?: Adapter.GetFriendListParams): Promise<Adapter.FriendInfo[]> {
        return [];
    }

    /**
     * 获取好友信息
     */
    async getFriendInfo(uin: string, params: Adapter.GetFriendInfoParams): Promise<Adapter.FriendInfo> {
        throw new Error('WhatsApp API 不支持获取好友信息');
    }

    // ============================================
    // 群组相关方法
    // ============================================

    /**
     * 获取群列表（WhatsApp 不支持）
     */
    async getGroupList(uin: string, params?: Adapter.GetGroupListParams): Promise<Adapter.GroupInfo[]> {
        return [];
    }

    /**
     * 获取群信息（WhatsApp 不支持）
     */
    async getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        throw new Error('WhatsApp API 不支持群组功能');
    }

    /**
     * 退出群组（WhatsApp 不支持）
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        throw new Error('WhatsApp API 不支持群组功能');
    }

    /**
     * 获取群成员列表（WhatsApp 不支持）
     */
    async getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        return [];
    }

    /**
     * 获取群成员信息（WhatsApp 不支持）
     */
    async getGroupMemberInfo(uin: string, params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> {
        throw new Error('WhatsApp API 不支持群组功能');
    }

    /**
     * 踢出群成员（WhatsApp 不支持）
     */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        throw new Error('WhatsApp API 不支持群组功能');
    }

    /**
     * 设置群名片（WhatsApp 不支持）
     */
    async setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        throw new Error('WhatsApp API 不支持群组功能');
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: 'onebots WhatsApp Adapter',
            app_version: '1.0.0',
            impl: 'whatsapp',
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

    createAccount(config: Account.Config<'whatsapp'>): Account<'whatsapp', WhatsAppBot> {
        const whatsappConfig: WhatsAppConfig = {
            account_id: config.account_id,
            businessAccountId: config.businessAccountId,
            phoneNumberId: config.phoneNumberId,
            accessToken: config.accessToken,
            webhookVerifyToken: config.webhookVerifyToken,
            apiVersion: config.apiVersion,
            proxy: config.proxy,
            webhook: config.webhook,
        };

        const bot = new WhatsAppBot(whatsappConfig);
        const account = new Account<'whatsapp', WhatsAppBot>(this, bot, config);

        // 监听 Bot 事件
        bot.on('ready', () => {
            this.logger.info(`WhatsApp Bot ${config.account_id} 已就绪`);
        });

        bot.on('error', (error) => {
            this.logger.error(`WhatsApp Bot ${config.account_id} 错误:`, error);
        });

        // 监听收到的消息
        bot.on('message', (message: WhatsAppMessageEvent, metadata: any) => {
            // 打印消息接收日志
            const content = message.text?.body || message.image?.caption || message.video?.caption || 
                          message.document?.caption || '[媒体消息]';
            const contentPreview = content.length > 100 ? content.substring(0, 100) + '...' : content;
            this.logger.info(
                `[WhatsApp] 收到消息 | 消息ID: ${message.id} | ` +
                `发送者: ${message.from} | 类型: ${message.type} | 内容: ${contentPreview}`
            );

            // 构建消息段
            const messageSegments: any[] = [];
            
            if (message.text) {
                messageSegments.push({
                    type: 'text',
                    data: { text: message.text.body },
                });
            } else if (message.image) {
                messageSegments.push({
                    type: 'image',
                    data: {
                        url: `whatsapp://media/${message.image.id}`,
                        caption: message.image.caption,
                    },
                });
            } else if (message.video) {
                messageSegments.push({
                    type: 'video',
                    data: {
                        url: `whatsapp://media/${message.video.id}`,
                        caption: message.video.caption,
                    },
                });
            } else if (message.audio) {
                messageSegments.push({
                    type: 'audio',
                    data: {
                        url: `whatsapp://media/${message.audio.id}`,
                    },
                });
            } else if (message.document) {
                messageSegments.push({
                    type: 'file',
                    data: {
                        url: `whatsapp://media/${message.document.id}`,
                        name: message.document.filename || 'document',
                        caption: message.document.caption,
                    },
                });
            } else if (message.location) {
                messageSegments.push({
                    type: 'location',
                    data: {
                        lat: message.location.latitude,
                        lon: message.location.longitude,
                        title: message.location.name,
                        address: message.location.address,
                    },
                });
            }

            // 转换为 CommonEvent 格式
            const commonEvent: CommonEvent.Message = {
                id: this.createId(message.id),
                timestamp: unixSecondsToEventMs(message.timestamp),
                platform: 'whatsapp',
                bot_id: this.createId(config.account_id),
                type: 'message',
                message_type: 'private', // WhatsApp 主要支持私聊
                sender: {
                    id: this.createId(message.from),
                    name: message.from,
                    avatar: undefined,
                },
                message_id: this.createId(message.id),
                raw_message: message.text?.body || '',
                message: messageSegments,
            };

            // 派发到协议层
            account.dispatch(commonEvent);
        });

        // 监听消息状态
        bot.on('status', (status: any) => {
            this.logger.debug(`[WhatsApp] 消息状态更新: ${status.id} -> ${status.status}`);
        });

        // 设置 Webhook 路由
        if (whatsappConfig.webhook?.url) {
            const router = this.app.router;
            
            // Webhook 验证路由（GET）
            router.get(`/whatsapp/${config.account_id}/webhook`, async (ctx: RouterContext, next: Next) => {
                const mode = ctx.query.mode as string;
                const token = ctx.query.token as string;
                const challenge = ctx.query.challenge as string;

                const result = bot.verifyWebhook(mode, token, challenge);
                if (result) {
                    ctx.body = result;
                } else {
                    ctx.status = 403;
                    ctx.body = 'Forbidden';
                }
            });

            // Webhook 事件接收路由（POST）
            router.post(`/whatsapp/${config.account_id}/webhook`, async (ctx: RouterContext, next: Next) => {
                try {
                    const event = ctx.request.body;
                    bot.handleWebhook(event);
                    ctx.body = { success: true };
                } catch (error) {
                    this.logger.error('[WhatsApp] Webhook 处理失败:', error);
                    ctx.status = 500;
                    ctx.body = { error: 'Internal Server Error' };
                }
            });
        }

        // 启动时初始化 Bot
        account.on('start', async () => {
            try {
                await bot.start();
                account.status = AccountStatus.Online;
                account.nickname = whatsappConfig.phoneNumberId;
                account.avatar = undefined;
            } catch (error) {
                this.logger.error(`启动 WhatsApp Bot 失败:`, error);
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
            whatsapp: WhatsAppConfig;
        }
    }
}

AdapterRegistry.register('whatsapp', WhatsAppAdapter, {
    name: 'whatsapp',
    displayName: 'WhatsApp 适配器',
    description: 'WhatsApp Business API 适配器，支持消息收发、媒体文件、位置等',
    icon: 'https://static.whatsapp.net/rsrc.php/v3/yz/r/ujTY9i_Jhs7.png',
    homepage: 'https://developers.facebook.com/docs/whatsapp',
    author: '凉菜',
});

