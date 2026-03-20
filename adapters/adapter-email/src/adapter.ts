/**
 * 邮件适配器
 * 继承 Adapter 基类，实现邮件平台功能
 */
import { Account, AdapterRegistry, AccountStatus } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { EmailBot } from "./bot.js";
import { CommonEvent, type CommonTypes } from "onebots";
import type { EmailConfig, EmailMessage } from "./types.js";

export class EmailAdapter extends Adapter<EmailBot, "email"> {
    constructor(app: BaseApp) {
        super(app, "email");
        this.icon = "https://www.google.com/s2/favicons?domain=mail.google.com&sz=64";
    }

    // ============================================
    // 消息相关方法
    // ============================================

    /**
     * 发送消息（发送邮件）
     */
    async sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const { message } = params;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);

        // 解析消息内容
        let text = '';
        let html = '';
        const attachments: Array<{
            filename: string;
            content: Buffer | string;
            contentType?: string;
        }> = [];

        for (const seg of message) {
            if (typeof seg === 'string') {
                text += seg;
                html += String(seg).replace(/\n/g, '<br>');
            } else if (seg.type === 'text') {
                const content = seg.data.text || '';
                text += content;
                html += content.replace(/\n/g, '<br>');
            } else if (seg.type === 'image') {
                if (seg.data.url || seg.data.file) {
                    // 图片作为附件发送
                    const imageUrl = seg.data.url || seg.data.file;
                    try {
                        const response = await fetch(imageUrl);
                        const buffer = Buffer.from(await response.arrayBuffer());
                        attachments.push({
                            filename: 'image.jpg',
                            content: buffer,
                            contentType: 'image/jpeg',
                        });
                        html += '<img src="cid:image.jpg" alt="Image" />';
                    } catch (error) {
                        this.logger.warn('下载图片失败:', error);
                    }
                }
            } else if (seg.type === 'file') {
                if (seg.data.url || seg.data.file) {
                    const fileUrl = seg.data.url || seg.data.file;
                    try {
                        const response = await fetch(fileUrl);
                        const buffer = Buffer.from(await response.arrayBuffer());
                        attachments.push({
                            filename: seg.data.name || 'file',
                            content: buffer,
                            contentType: seg.data.content_type || 'application/octet-stream',
                        });
                    } catch (error) {
                        this.logger.warn('下载文件失败:', error);
                    }
                }
            }
        }

        // 发送邮件
        const to = sceneId.string; // 收件人邮箱地址
        const messageId = await bot.sendEmail({
            to,
            subject: `来自 ${account.nickname || uin} 的消息`,
            text: text || undefined,
            html: html || undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
        });

        return {
            message_id: this.createId(messageId),
        };
    }

    /**
     * 删除/撤回消息（邮件不支持撤回）
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        // 邮件不支持撤回
        throw new Error('邮件不支持撤回功能');
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        // 邮件适配器不直接支持获取消息
        throw new Error('邮件适配器不支持直接获取消息');
    }

    /**
     * 更新消息（邮件不支持编辑）
     */
    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        // 邮件不支持编辑
        throw new Error('邮件不支持编辑功能');
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

        const config = account.config as EmailConfig;
        return {
            user_id: this.createId(config.from),
            user_name: config.from,
            user_displayname: config.fromName || config.from,
            avatar: undefined,
        };
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        // 邮件适配器不直接支持获取用户信息
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
     * 获取好友列表（邮件不支持）
     */
    async getFriendList(uin: string, params?: Adapter.GetFriendListParams): Promise<Adapter.FriendInfo[]> {
        // 邮件不支持好友列表
        return [];
    }

    /**
     * 获取好友信息
     */
    async getFriendInfo(uin: string, params: Adapter.GetFriendInfoParams): Promise<Adapter.FriendInfo> {
        // 邮件不支持好友信息
        throw new Error('邮件适配器不支持获取好友信息');
    }

    // ============================================
    // 群组相关方法
    // ============================================

    /**
     * 获取群列表（邮件不支持群组）
     */
    async getGroupList(uin: string, params?: Adapter.GetGroupListParams): Promise<Adapter.GroupInfo[]> {
        // 邮件不支持群组
        return [];
    }

    /**
     * 获取群信息（邮件不支持群组）
     */
    async getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        throw new Error('邮件适配器不支持群组功能');
    }

    /**
     * 退出群组（邮件不支持群组）
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        throw new Error('邮件适配器不支持群组功能');
    }

    /**
     * 获取群成员列表（邮件不支持群组）
     */
    async getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        return [];
    }

    /**
     * 获取群成员信息（邮件不支持群组）
     */
    async getGroupMemberInfo(uin: string, params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> {
        throw new Error('邮件适配器不支持群组功能');
    }

    /**
     * 踢出群成员（邮件不支持群组）
     */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        throw new Error('邮件适配器不支持群组功能');
    }

    /**
     * 设置群名片（邮件不支持群组）
     */
    async setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        throw new Error('邮件适配器不支持群组功能');
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: 'onebots Email Adapter',
            app_version: '1.0.0',
            impl: 'email',
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

    createAccount(config: Account.Config<'email'>): Account<'email', EmailBot> {
        const emailConfig: EmailConfig = {
            account_id: config.account_id,
            from: config.from,
            fromName: config.fromName,
            smtp: config.smtp,
            imap: config.imap,
        };

        const bot = new EmailBot(emailConfig);
        const account = new Account<'email', EmailBot>(this, bot, config);

        // 监听 Bot 事件
        bot.on('ready', () => {
            this.logger.info(`邮件 Bot ${config.account_id} 已就绪`);
        });

        bot.on('error', (error) => {
            this.logger.error(`邮件 Bot ${config.account_id} 错误:`, error);
        });

        // 监听新邮件
        bot.on('email', (emailMessage: EmailMessage) => {
            // 忽略自己发送的邮件
            if (emailMessage.from.address === emailConfig.from) {
                return;
            }

            // 打印邮件接收日志
            const contentPreview = (emailMessage.text || emailMessage.html || '').substring(0, 100);
            this.logger.info(
                `[Email] 收到邮件 | 邮件ID: ${emailMessage.id} | ` +
                `发件人: ${emailMessage.from.address} | 主题: ${emailMessage.subject} | 内容: ${contentPreview}...`
            );

            // 构建消息段
            const messageSegments: any[] = [];
            
            if (emailMessage.text) {
                messageSegments.push({
                    type: 'text',
                    data: { text: emailMessage.text },
                });
            } else if (emailMessage.html) {
                // 将 HTML 转换为纯文本（简化处理）
                const text = emailMessage.html.replace(/<[^>]*>/g, '').replace(/\n\s*\n/g, '\n');
                messageSegments.push({
                    type: 'text',
                    data: { text },
                });
            }

            // 处理附件
            if (emailMessage.attachments && emailMessage.attachments.length > 0) {
                for (const att of emailMessage.attachments) {
                    messageSegments.push({
                        type: 'file',
                        data: {
                            name: att.filename,
                            url: `data:${att.contentType};base64,${att.content.toString('base64')}`,
                            content_type: att.contentType,
                        },
                    });
                }
            }

            // 转换为 CommonEvent 格式
            const commonEvent: CommonEvent.Message = {
                id: this.createId(emailMessage.id),
                timestamp: emailMessage.date.getTime(),
                platform: 'email',
                bot_id: this.createId(config.account_id),
                type: 'message',
                message_type: 'private', // 邮件视为私聊
                sender: {
                    id: this.createId(emailMessage.from.address),
                    name: emailMessage.from.name || emailMessage.from.address,
                    avatar: undefined,
                },
                message_id: this.createId(emailMessage.id),
                raw_message: emailMessage.text || emailMessage.html || '',
                message: messageSegments,
            };

            // 派发到协议层
            account.dispatch(commonEvent);
        });

        // 启动时初始化 Bot
        account.on('start', async () => {
            try {
                await bot.start();
                account.status = AccountStatus.Online;
                account.nickname = emailConfig.fromName || emailConfig.from;
                account.avatar = undefined;
            } catch (error) {
                this.logger.error(`启动邮件 Bot 失败:`, error);
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
            email: EmailConfig;
        }
    }
}

AdapterRegistry.register('email', EmailAdapter, {
    name: 'email',
    displayName: '邮件适配器',
    description: '邮件适配器，支持 SMTP 发送和 IMAP 接收邮件',
    icon: 'https://www.google.com/s2/favicons?domain=mail.google.com&sz=64',
    homepage: 'https://en.wikipedia.org/wiki/Email',
    author: '凉菜',
});

