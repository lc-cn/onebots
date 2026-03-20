/**
 * ICQQ 适配器
 * 继承 Adapter 基类，实现 ICQQ 平台功能
 */
import { Buffer } from "node:buffer";
import { Account, AdapterRegistry, AccountStatus } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { ICQQBot, segment } from "./bot.js";
import { CommonEvent, CommonTypes } from "onebots";
import type {
    ICQQConfig,
    ICQQUser,
    ICQQPrivateMessageEvent,
    ICQQGroupMessageEvent,
    ICQQMessageElement,
} from "./types.js";

export class ICQQAdapter extends Adapter<ICQQBot, "icqq"> {
    constructor(app: BaseApp) {
        super(app, "icqq");
        this.icon = "https://qzonestyle.gtimg.cn/qzone/qzact/act/external/tiqq/logo.png";
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

        // 转换消息格式
        const icqqMessage = this.buildICQQMessage(message);
        const targetId = parseInt(sceneId.string);

        let result: any;
        if (scene_type === 'private') {
            result = await bot.sendPrivateMessage(targetId, icqqMessage);
        } else if (scene_type === 'group') {
            result = await bot.sendGroupMessage(targetId, icqqMessage);
        } else {
            throw new Error(`不支持的消息类型: ${scene_type}`);
        }

        return {
            message_id: this.createId(result.message_id || result.seq?.toString() || ''),
        };
    }

    /**
     * 删除/撤回消息
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        await bot.recallMessage(this.coerceId(params.message_id as CommonTypes.Id | string | number).string);
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msg = await bot.getMessage(this.coerceId(params.message_id as CommonTypes.Id | string | number).string);

        const isGroup = !!msg.group_id;
        return {
            message_id: this.createId(msg.message_id),
            time: msg.time * 1000,
            sender: {
                scene_type: isGroup ? 'group' : 'private',
                sender_id: this.createId(msg.user_id.toString()),
                scene_id: this.createId(isGroup ? msg.group_id.toString() : msg.user_id.toString()),
                sender_name: msg.sender?.nickname || '',
                scene_name: '',
            },
            message: this.convertICQQMessageToSegments(msg.message || []),
        };
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
        const info = bot.getLoginInfo();

        if (!info) throw new Error('Bot not ready');

        return {
            user_id: this.createId(info.user_id.toString()),
            user_name: info.nickname,
            user_displayname: info.nickname,
            avatar: info.avatar,
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
        const info = await bot.getStrangerInfo(userId);

        return {
            user_id: this.createId(info.user_id.toString()),
            user_name: info.nickname,
            user_displayname: info.nickname,
            avatar: info.avatar,
        };
    }

    // ============================================
    // 好友相关方法
    // ============================================

    /**
     * 获取好友列表
     */
    async getFriendList(uin: string, params?: Adapter.GetFriendListParams): Promise<Adapter.FriendInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const friends = await bot.getFriendList();

        return friends.map(friend => ({
            user_id: this.createId(friend.user_id.toString()),
            user_name: friend.nickname,
            remark: friend.remark,
        }));
    }

    /**
     * 获取好友信息
     */
    async getFriendInfo(uin: string, params: Adapter.GetFriendInfoParams): Promise<Adapter.FriendInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = parseInt(params.user_id.string);
        const info = await bot.getStrangerInfo(userId);

        return {
            user_id: this.createId(info.user_id.toString()),
            user_name: info.nickname,
        };
    }

    // ============================================
    // 群组相关方法
    // ============================================

    /**
     * 获取群列表
     */
    async getGroupList(uin: string, params?: Adapter.GetGroupListParams): Promise<Adapter.GroupInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groups = await bot.getGroupList();

        return groups.map(group => ({
            group_id: this.createId(group.group_id.toString()),
            group_name: group.group_name,
            member_count: group.member_count,
            max_member_count: group.max_member_count,
        }));
    }

    /**
     * 获取群信息
     */
    async getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groupId = parseInt(params.group_id.string);
        const info = await bot.getGroupInfo(groupId);

        if (!info) throw new Error(`Group ${groupId} not found`);

        return {
            group_id: this.createId(info.group_id.toString()),
            group_name: info.group_name,
            member_count: info.member_count,
            max_member_count: info.max_member_count,
        };
    }

    /**
     * 退出群组
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groupId = parseInt(params.group_id.string);
        await bot.leaveGroup(groupId);
    }

    /**
     * 获取群成员列表
     */
    async getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groupId = parseInt(params.group_id.string);
        const members = await bot.getGroupMemberList(groupId);

        return members.map(member => ({
            group_id: params.group_id,
            user_id: this.createId(member.user_id.toString()),
            user_name: member.nickname,
            card: member.card || '',
            role: member.role || 'member',
        }));
    }

    /**
     * 获取群成员信息
     */
    async getGroupMemberInfo(uin: string, params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groupId = parseInt(params.group_id.string);
        const userId = parseInt(params.user_id.string);
        const member = await bot.getGroupMemberInfo(groupId, userId);

        if (!member) throw new Error(`Member ${userId} not found in group ${groupId}`);

        return {
            group_id: params.group_id,
            user_id: params.user_id,
            user_name: member.nickname,
            card: member.card || '',
            role: member.role || 'member',
        };
    }

    /**
     * 踢出群成员
     */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groupId = parseInt(params.group_id.string);
        const userId = parseInt(params.user_id.string);
        await bot.kickGroupMember(groupId, userId, params.reject_add_request);
    }

    /**
     * 设置群名片
     */
    async setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const groupId = parseInt(params.group_id.string);
        const userId = parseInt(params.user_id.string);
        await bot.setGroupCard(groupId, userId, params.card);
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: 'onebots ICQQ Adapter',
            app_version: '1.0.0',
            impl: 'icqq',
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

    createAccount(config: Account.Config<'icqq'>): Account<'icqq', ICQQBot> {
        const icqqConfig: ICQQConfig = {
            account_id: config.account_id,
            password: config.password,
            protocol: config.protocol,
        };

        const bot = new ICQQBot(icqqConfig);
        const account = new Account<'icqq', ICQQBot>(this, bot, config);

        // 监听 Bot 事件
        bot.on('ready', (user: ICQQUser) => {
            this.logger.info(`ICQQ Bot ${user.nickname} (${user.user_id}) 已就绪`);
            account.status = AccountStatus.Online;
            account.nickname = user.nickname;
            account.avatar = user.avatar;
        });

        bot.on('offline', (event: any) => {
            this.logger.warn(`ICQQ Bot 离线: ${event.message}`);
            account.status = AccountStatus.OffLine;
        });

        bot.on('qrcode', (event: any) => {
            this.logger.info(`ICQQ 请扫描二维码登录`);
            this.emit('qrcode', { account_id: config.account_id, image: event.image });
            const imageBase64 = event.image instanceof Buffer ? event.image.toString('base64') : event.image;
            this.emit('verification:request', {
                platform: 'icqq',
                account_id: config.account_id,
                type: 'qrcode',
                hint: '请使用手机 QQ 扫描下方二维码登录',
                options: { blocks: [{ type: 'image', base64: imageBase64, alt: '登录二维码' }] },
            } as unknown as Adapter.VerificationRequest);
        });

        bot.on('slider', (event: any) => {
            this.logger.info(`ICQQ 需要滑块验证: ${event.url}`);
            this.emit('slider', { account_id: config.account_id, url: event.url });
            this.emit('verification:request', {
                platform: 'icqq',
                account_id: config.account_id,
                type: 'slider',
                hint: '请在浏览器中打开下方链接完成滑块验证，完成后将获取的 ticket 填入并提交',
                options: {
                    blocks: [
                        { type: 'link', url: event.url, label: event.url },
                        { type: 'input', key: 'ticket', placeholder: '粘贴 ticket' },
                    ],
                },
            } as unknown as Adapter.VerificationRequest);
        });

        bot.on('device', (event: any) => {
            this.logger.info(`ICQQ 需要设备锁验证: ${event.url}`);
            this.emit('device', { account_id: config.account_id, url: event.url, phone: event.phone });
            const blocks: Array<{ type: 'link'; url: string; label?: string } | { type: 'text'; content: string }> = [
                { type: 'link', url: event.url, label: event.url },
            ];
            if (event.phone) blocks.push({ type: 'text', content: `手机号：${event.phone}` });
            this.emit('verification:request', {
                platform: 'icqq',
                account_id: config.account_id,
                type: 'device',
                hint: '请在浏览器中打开下方链接完成设备锁验证',
                options: { blocks },
            } as unknown as Adapter.VerificationRequest);
            if (event.phone) {
                this.emit('verification:request', {
                    platform: 'icqq',
                    account_id: config.account_id,
                    type: 'sms',
                    hint: '使用短信验证：请先点击「发送验证码」，收到后填入 6 位验证码并提交',
                    requestSmsAvailable: true,
                    options: {
                        blocks: [
                            { type: 'input', key: 'code', placeholder: '6 位短信验证码', maxLength: 6 },
                        ],
                    },
                } as unknown as Adapter.VerificationRequest);
            }
        });

        bot.on('login_error', (event: any) => {
            this.logger.error(`ICQQ 登录失败:`, event);
            account.status = AccountStatus.OffLine;
        });

        // 监听私聊消息
        bot.on('private_message', (event: ICQQPrivateMessageEvent) => {
            // 打印消息接收日志
            const contentPreview = event.raw_message.length > 100 
                ? event.raw_message.substring(0, 100) + '...' 
                : event.raw_message;
            this.logger.info(
                `[ICQQ] 收到私聊消息 | 消息ID: ${event.message_id} | ` +
                `发送者: ${event.sender.nickname} (${event.user_id}) | 内容: ${contentPreview}`
            );

            // 转换为 CommonEvent 格式
            const commonEvent: CommonEvent.Message = {
                id: this.createId(event.message_id),
                timestamp: event.time * 1000,
                platform: 'icqq',
                bot_id: this.createId(config.account_id),
                type: 'message',
                message_type: 'private',
                sender: {
                    id: this.createId(event.user_id.toString()),
                    name: event.sender.nickname,
                    avatar: `https://q1.qlogo.cn/g?b=qq&nk=${event.user_id}&s=640`,
                },
                message_id: this.createId(event.message_id),
                raw_message: event.raw_message,
                message: this.convertICQQMessageToSegments(event.message),
            };

            // 派发到协议层
            account.dispatch(commonEvent);
        });

        // 监听群消息
        bot.on('group_message', (event: ICQQGroupMessageEvent) => {
            // 打印消息接收日志
            const contentPreview = event.raw_message.length > 100 
                ? event.raw_message.substring(0, 100) + '...' 
                : event.raw_message;
            this.logger.info(
                `[ICQQ] 收到群消息 | 消息ID: ${event.message_id} | 群: ${event.group.group_name} (${event.group_id}) | ` +
                `发送者: ${event.sender.nickname} (${event.user_id}) | 内容: ${contentPreview}`
            );

            // 转换为 CommonEvent 格式
            const commonEvent: CommonEvent.Message = {
                id: this.createId(event.message_id),
                timestamp: event.time * 1000,
                platform: 'icqq',
                bot_id: this.createId(config.account_id),
                type: 'message',
                message_type: 'group',
                sender: {
                    id: this.createId(event.user_id.toString()),
                    name: event.sender.nickname,
                    avatar: `https://q1.qlogo.cn/g?b=qq&nk=${event.user_id}&s=640`,
                },
                group: {
                    id: this.createId(event.group_id.toString()),
                    name: event.group.group_name,
                },
                message_id: this.createId(event.message_id),
                raw_message: event.raw_message,
                message: this.convertICQQMessageToSegments(event.message),
            };

            // 派发到协议层
            account.dispatch(commonEvent);
        });

        // 监听群成员增加
        bot.on('group_increase', (event: any) => {
            const noticeEvent: CommonEvent.Notice = {
                id: this.createId(`${event.group_id}_${event.user_id}_${event.time}`),
                timestamp: event.time * 1000,
                platform: 'icqq',
                bot_id: this.createId(config.account_id),
                type: 'notice',
                notice_type: 'group_increase',
                sub_type: event.operator_id === event.user_id ? 'approve' : 'invite',
                group: {
                    id: this.createId(event.group_id.toString()),
                },
                user: {
                    id: this.createId(event.user_id.toString()),
                },
                operator: event.operator_id ? {
                    id: this.createId(event.operator_id.toString()),
                } : undefined,
            };
            account.dispatch(noticeEvent);
        });

        // 监听群成员减少
        bot.on('group_decrease', (event: any) => {
            const noticeEvent: CommonEvent.Notice = {
                id: this.createId(`${event.group_id}_${event.user_id}_${event.time}`),
                timestamp: event.time * 1000,
                platform: 'icqq',
                bot_id: this.createId(config.account_id),
                type: 'notice',
                notice_type: 'group_decrease',
                sub_type: event.sub_type,
                group: {
                    id: this.createId(event.group_id.toString()),
                },
                user: {
                    id: this.createId(event.user_id.toString()),
                },
                operator: event.operator_id ? {
                    id: this.createId(event.operator_id.toString()),
                } : undefined,
            };
            account.dispatch(noticeEvent);
        });

        // 启动时初始化 Bot
        account.on('start', async () => {
            try {
                await bot.start();
            } catch (error) {
                this.logger.error(`启动 ICQQ Bot 失败:`, error);
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
     * Web 验证提交：将前端提交的滑块 ticket 或短信验证码转交给 ICQQ Bot
     * 支持 data.ticket / data.code（兼容）或通用 data.value
     */
    override submitVerification(accountId: string, type: string, data: Record<string, unknown>): void {
        const account = this.getAccount(accountId);
        if (!account) {
            this.logger.warn(`submitVerification: 账号不存在 ${accountId}`);
            return;
        }
        const bot = account.client;
        const value = typeof data.value === 'string' ? data.value : undefined;
        if (type === 'slider') {
            const ticket = (data.ticket ?? value) as string | undefined;
            if (typeof ticket === 'string') bot.submitSlider(ticket);
        } else if (type === 'sms') {
            const code = (data.code ?? value) as string | undefined;
            if (typeof code === 'string') bot.submitSmsCode(code);
        } else {
            this.logger.debug(`submitVerification: 忽略类型 ${type} 或缺少参数`);
        }
    }

    /** 请求向密保手机发送短信验证码（设备锁时用户选短信验证前调用） */
    override requestSmsCode(accountId: string): Promise<void> {
        const account = this.getAccount(accountId);
        if (!account) {
            this.logger.warn(`requestSmsCode: 账号不存在 ${accountId}`);
            return Promise.resolve();
        }
        return account.client.sendSmsCode();
    }

    // ============================================
    // 消息转换
    // ============================================

    /**
     * 处理 base64:// 前缀的文件数据
     * 如果是 base64 格式，转换为 Buffer；否则返回原始数据
     */
    private processFileData(file: string | any): string | Buffer | any {
        if (typeof file === 'string' && file.startsWith('base64://')) {
            const base64Data = file.replace(/^base64:\/\//, '');
            
            // Strip whitespace (RFC 4648 allows whitespace in base64)
            const cleanedData = base64Data.replace(/\s/g, '');
            
            // Validate base64 format (basic validation)
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleanedData)) {
                this.logger.warn(`Invalid base64 data format (length: ${cleanedData.length})`);
                return file; // Return original if invalid
            }
            
            try {
                return Buffer.from(cleanedData, 'base64');
            } catch (error) {
                this.logger.error(`Failed to convert base64 to Buffer:`, error);
                return file; // Return original on error
            }
        }
        return file;
    }

    /**
     * 构建 ICQQ 消息
     */
    private buildICQQMessage(message: CommonTypes.Segment[]): any[] {
        const result: any[] = [];

        for (const seg of message) {
            if (typeof seg === 'string') {
                result.push(seg);
            } else if (seg.type === 'text') {
                result.push(seg.data.text || '');
            } else if (seg.type === 'at') {
                const qq = seg.data.qq || seg.data.id || seg.data.user_id;
                if (qq === 'all') {
                    result.push(segment.at('all'));
                } else {
                    result.push(segment.at(parseInt(qq as string)));
                }
            } else if (seg.type === 'image') {
                const file = seg.data.url || seg.data.file;
                if (file) {
                    result.push(segment.image(this.processFileData(file)));
                }
            } else if (seg.type === 'face') {
                const id = seg.data.id;
                if (id !== undefined) {
                    result.push(segment.face(parseInt(id as string)));
                }
            } else if (seg.type === 'record' || seg.type === 'audio') {
                const file = seg.data.url || seg.data.file;
                if (file) {
                    result.push(segment.record(this.processFileData(file)));
                }
            } else if (seg.type === 'video') {
                const file = seg.data.url || seg.data.file;
                if (file) {
                    result.push(segment.video(this.processFileData(file)));
                }
            } else if (seg.type === 'reply') {
                const id = seg.data.id;
                if (id) {
                    result.push({ type: 'reply', id } as any);
                }
            } else if (seg.type === 'share') {
                result.push(segment.share(
                    seg.data.url || '',
                    seg.data.title || '',
                    seg.data.content,
                    seg.data.image
                ));
            } else if (seg.type === 'json') {
                result.push(segment.json(seg.data.data || ''));
            } else if (seg.type === 'xml') {
                result.push(segment.xml(seg.data.data || ''));
            }
        }

        return result;
    }

    /**
     * 转换 ICQQ 消息到 Segment
     */
    private convertICQQMessageToSegments(message: ICQQMessageElement[]): CommonTypes.Segment[] {
        const result: CommonTypes.Segment[] = [];

        for (const elem of message) {
            switch (elem.type) {
                case 'text':
                    result.push({ type: 'text', data: { text: elem.text } });
                    break;
                case 'face':
                    result.push({ type: 'face', data: { id: elem.id.toString() } });
                    break;
                case 'image':
                    result.push({ type: 'image', data: { url: elem.url || elem.file, file: elem.file } });
                    break;
                case 'record':
                    result.push({ type: 'record', data: { url: elem.url || elem.file, file: elem.file } });
                    break;
                case 'video':
                    result.push({ type: 'video', data: { url: elem.url || elem.file, file: elem.file } });
                    break;
                case 'at':
                    result.push({ type: 'at', data: { qq: elem.qq.toString() } });
                    break;
                case 'share':
                    result.push({ type: 'share', data: { url: elem.url, title: elem.title, content: elem.content, image: elem.image } });
                    break;
                case 'json':
                    result.push({ type: 'json', data: { data: elem.data } });
                    break;
                case 'xml':
                    result.push({ type: 'xml', data: { data: elem.data } });
                    break;
                case 'reply':
                    result.push({ type: 'reply', data: { id: elem.id } });
                    break;
                default:
                    result.push({ type: 'text', data: { text: `[${(elem as any).type}]` } });
            }
        }

        return result;
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            icqq: ICQQConfig;
        }
    }
}

AdapterRegistry.register('icqq', ICQQAdapter, {
    name: 'icqq',
    displayName: 'ICQQ 机器人',
    description: '基于 ICQQ 协议的 QQ 机器人适配器，支持扫码登录和密码登录',
    icon: 'https://qzonestyle.gtimg.cn/qzone/qzact/act/external/tiqq/logo.png',
    homepage: 'https://github.com/icqqjs/icqq',
    author: '凉菜',
});

