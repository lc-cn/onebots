/**
 * ICQQ Bot 封装
 * 基于 @icqqjs/icqq 库封装的机器人客户端
 */
import { EventEmitter } from 'events';
import { createClient, Client, segment as Segment } from '@icqqjs/icqq';
import type {
    ICQQConfig,
    ICQQProtocol,
    ICQQUser,
    ICQQFriend,
    ICQQGroup,
    ICQQGroupMember,
    ICQQMessageElement,
    Platform,
} from './types.js';

export class ICQQBot extends EventEmitter {
    private config: ICQQConfig;
    private client: Client | null = null;
    private ready: boolean = false;
    private loginInfo: ICQQUser | null = null;

    constructor(config: ICQQConfig) {
        super();
        this.config = config;
    }

    /**
     * 获取 ICQQ 客户端实例
     */
    getClient(): Client | null {
        return this.client;
    }

    /**
     * 是否已就绪
     */
    isReady(): boolean {
        return this.ready;
    }

    /**
     * 获取登录信息
     */
    getLoginInfo(): ICQQUser | null {
        return this.loginInfo;
    }

    /**
     * 启动 Bot
     */
    async start(): Promise<void> {
        const uin = parseInt(this.config.account_id);
        if (isNaN(uin)) {
            throw new Error('account_id 必须是有效的 QQ 号');
        }

        // 构建 ICQQ 配置
        const protocol = this.config.protocol || {};
        const clientConfig: any = {
            platform: protocol.platform || 2,
            sign_api_addr: protocol.sign_api_addr,
            data_dir: protocol.data_dir,
            ignore_self: protocol.ignore_self !== false,
            resend: protocol.resend !== false,
            reconn_interval: protocol.reconn_interval || 5,
            cache_group_member: protocol.cache_group_member !== false,
            auto_server: protocol.auto_server !== false,
        };

        if (protocol.ver) {
            clientConfig.ver = protocol.ver;
        }
        if (protocol.log_config) {
            clientConfig.log_config = protocol.log_config;
        }
        if (protocol.ffmpeg_path) {
            clientConfig.ffmpeg_path = protocol.ffmpeg_path;
        }
        if (protocol.ffprobe_path) {
            clientConfig.ffprobe_path = protocol.ffprobe_path;
        }

        // 创建客户端
        this.client = createClient(clientConfig);

        // 绑定事件
        this.setupEventListeners();

        // 登录
        if (this.config.password) {
            // 密码登录
            this.client.login(uin, this.config.password);
        } else {
            // 扫码登录
            this.client.login(uin);
        }
    }

    /**
     * 停止 Bot
     */
    async stop(): Promise<void> {
        if (this.client) {
            this.client.logout();
            this.client = null;
        }
        this.ready = false;
        this.loginInfo = null;
        this.emit('stop');
    }

    /**
     * 设置事件监听器
     */
    private setupEventListeners(): void {
        if (!this.client) return;

        // 登录成功
        this.client.on('system.login.qrcode', (event) => {
            this.emit('qrcode', event);
        });

        this.client.on('system.login.slider', (event) => {
            this.emit('slider', event);
        });

        this.client.on('system.login.device', (event) => {
            this.emit('device', event);
        });

        this.client.on('system.login.error', (event) => {
            this.emit('login_error', event);
        });

        this.client.on('system.online', () => {
            this.ready = true;
            this.loginInfo = {
                user_id: this.client!.uin,
                nickname: this.client!.nickname,
                avatar: `https://q1.qlogo.cn/g?b=qq&nk=${this.client!.uin}&s=640`,
            };
            this.emit('ready', this.loginInfo);
        });

        this.client.on('system.offline', (event) => {
            this.ready = false;
            this.emit('offline', event);
        });

        // 私聊消息
        this.client.on('message.private', (event) => {
            this.emit('private_message', this.convertPrivateMessage(event));
        });

        // 群消息
        this.client.on('message.group', (event) => {
            this.emit('group_message', this.convertGroupMessage(event));
        });

        // 好友申请
        this.client.on('request.friend', (event) => {
            this.emit('friend_request', {
                request_id: event.flag,
                user_id: event.user_id,
                nickname: event.nickname,
                comment: event.comment,
                source: event.source,
                time: (event as any).time || Date.now() / 1000,
            });
        });

        // 群申请/邀请
        this.client.on('request.group', (event) => {
            this.emit('group_request', {
                request_id: event.flag,
                group_id: event.group_id,
                user_id: event.user_id,
                nickname: event.nickname,
                sub_type: event.sub_type,
                comment: (event as any).comment || '',
                time: (event as any).time || Date.now() / 1000,
            });
        });

        // 群成员增加
        this.client.on('notice.group.increase', (event) => {
            this.emit('group_increase', {
                group_id: event.group_id,
                user_id: event.user_id,
                operator_id: undefined,
                time: Date.now() / 1000,
            });
        });

        // 群成员减少
        this.client.on('notice.group.decrease', (event) => {
            this.emit('group_decrease', {
                group_id: event.group_id,
                user_id: event.user_id,
                operator_id: event.operator_id,
                sub_type: event.dismiss ? 'dismiss' : 'leave',
                time: Date.now() / 1000,
            });
        });

        // 群禁言
        this.client.on('notice.group.ban', (event) => {
            this.emit('group_mute', {
                group_id: event.group_id,
                user_id: event.user_id,
                operator_id: event.operator_id,
                duration: event.duration,
                time: Date.now() / 1000,
            });
        });

        // 群管理员变动
        this.client.on('notice.group.admin', (event) => {
            this.emit('group_admin', {
                group_id: event.group_id,
                user_id: event.user_id,
                sub_type: event.set ? 'set' : 'unset',
                time: Date.now() / 1000,
            });
        });

        // 好友消息撤回
        this.client.on('notice.friend.recall', (event) => {
            this.emit('friend_recall', {
                message_id: event.message_id,
                user_id: event.user_id,
                time: event.time,
            });
        });

        // 群消息撤回
        this.client.on('notice.group.recall', (event) => {
            this.emit('group_recall', {
                message_id: event.message_id,
                group_id: event.group_id,
                user_id: event.user_id,
                operator_id: event.operator_id,
                time: event.time,
            });
        });

        // 戳一戳
        this.client.on('notice.friend.poke', (event) => {
            this.emit('poke', {
                operator_id: event.operator_id,
                target_id: event.target_id,
                action: event.action,
                suffix: event.suffix,
                time: Date.now() / 1000,
            });
        });

        this.client.on('notice.group.poke', (event) => {
            this.emit('poke', {
                group_id: event.group_id,
                operator_id: event.operator_id,
                target_id: event.target_id,
                action: event.action,
                suffix: event.suffix,
                time: Date.now() / 1000,
            });
        });
    }

    /**
     * 转换私聊消息
     */
    private convertPrivateMessage(event: any): any {
        return {
            message_id: event.message_id,
            user_id: event.user_id,
            message: this.convertMessage(event.message),
            raw_message: event.raw_message,
            time: event.time,
            sender: {
                user_id: event.sender.user_id,
                nickname: event.sender.nickname,
                sex: event.sender.sex,
                age: event.sender.age,
            },
            reply: (message: string | any[], quote?: boolean) => {
                return event.reply(message, quote);
            },
        };
    }

    /**
     * 转换群消息
     */
    private convertGroupMessage(event: any): any {
        return {
            message_id: event.message_id,
            group_id: event.group_id,
            user_id: event.user_id,
            message: this.convertMessage(event.message),
            raw_message: event.raw_message,
            time: event.time,
            sender: {
                user_id: event.sender.user_id,
                nickname: event.sender.nickname,
                card: event.sender.card,
                sex: event.sender.sex,
                age: event.sender.age,
                role: event.sender.role,
                title: event.sender.title,
            },
            group: {
                group_id: event.group_id,
                group_name: event.group_name,
            },
            atme: event.atme,
            reply: (message: string | any[], quote?: boolean) => {
                return event.reply(message, quote);
            },
        };
    }

    /**
     * 转换消息段
     */
    private convertMessage(message: any[]): ICQQMessageElement[] {
        return message.map((elem: any) => {
            switch (elem.type) {
                case 'text':
                    return { type: 'text', text: elem.text };
                case 'face':
                    return { type: 'face', id: elem.id };
                case 'image':
                    return { type: 'image', file: elem.file, url: elem.url };
                case 'record':
                    return { type: 'record', file: elem.file, url: elem.url };
                case 'video':
                    return { type: 'video', file: elem.file, url: elem.url };
                case 'at':
                    return { type: 'at', qq: elem.qq };
                case 'share':
                    return { type: 'share', url: elem.url, title: elem.title, content: elem.content, image: elem.image };
                case 'json':
                    return { type: 'json', data: elem.data };
                case 'xml':
                    return { type: 'xml', data: elem.data };
                case 'poke':
                    return { type: 'poke', id: elem.id };
                case 'reply':
                    return { type: 'reply', id: elem.id };
                default:
                    return { type: 'text', text: `[${elem.type}]` };
            }
        });
    }

    // ============================================
    // 消息发送 API
    // ============================================

    /**
     * 发送私聊消息
     */
    async sendPrivateMessage(userId: number, message: string | any[]): Promise<any> {
        if (!this.client) throw new Error('Bot not connected');
        return this.client.sendPrivateMsg(userId, message);
    }

    /**
     * 发送群消息
     */
    async sendGroupMessage(groupId: number, message: string | any[]): Promise<any> {
        if (!this.client) throw new Error('Bot not connected');
        return this.client.sendGroupMsg(groupId, message);
    }

    /**
     * 撤回消息
     */
    async recallMessage(messageId: string): Promise<boolean> {
        if (!this.client) throw new Error('Bot not connected');
        return this.client.deleteMsg(messageId);
    }

    /**
     * 获取消息
     */
    async getMessage(messageId: string): Promise<any> {
        if (!this.client) throw new Error('Bot not connected');
        return this.client.getMsg(messageId);
    }

    // ============================================
    // 好友 API
    // ============================================

    /**
     * 获取好友列表
     */
    async getFriendList(): Promise<ICQQFriend[]> {
        if (!this.client) throw new Error('Bot not connected');
        const friends = this.client.fl;
        return Array.from(friends.values()).map((friend: any) => ({
            user_id: friend.user_id,
            nickname: friend.nickname,
            sex: friend.sex,
            remark: friend.remark,
            class_id: friend.class_id,
        }));
    }

    /**
     * 获取陌生人信息
     */
    async getStrangerInfo(userId: number): Promise<ICQQUser> {
        if (!this.client) throw new Error('Bot not connected');
        const info = await this.client.getStrangerInfo(userId);
        return {
            user_id: info.user_id,
            nickname: info.nickname,
            sex: info.sex,
            age: info.age,
            avatar: `https://q1.qlogo.cn/g?b=qq&nk=${info.user_id}&s=640`,
        };
    }

    /**
     * 处理好友申请
     */
    async handleFriendRequest(flag: string, approve: boolean, remark?: string): Promise<boolean> {
        if (!this.client) throw new Error('Bot not connected');
        return this.client.setFriendAddRequest(flag, approve, remark);
    }

    /**
     * 删除好友
     */
    async deleteFriend(userId: number): Promise<boolean> {
        if (!this.client) throw new Error('Bot not connected');
        return this.client.deleteFriend(userId);
    }

    // ============================================
    // 群组 API
    // ============================================

    /**
     * 获取群列表
     */
    async getGroupList(): Promise<ICQQGroup[]> {
        if (!this.client) throw new Error('Bot not connected');
        const groups = this.client.gl;
        return Array.from(groups.values()).map((group: any) => ({
            group_id: group.group_id,
            group_name: group.group_name,
            owner_id: group.owner_id,
            member_count: group.member_count,
            max_member_count: group.max_member_count,
        }));
    }

    /**
     * 获取群信息
     */
    async getGroupInfo(groupId: number): Promise<ICQQGroup | undefined> {
        if (!this.client) throw new Error('Bot not connected');
        const group = this.client.gl.get(groupId);
        if (!group) return undefined;
        return {
            group_id: group.group_id,
            group_name: group.group_name,
            owner_id: group.owner_id,
            member_count: group.member_count,
            max_member_count: group.max_member_count,
        };
    }

    /**
     * 获取群成员列表
     */
    async getGroupMemberList(groupId: number): Promise<ICQQGroupMember[]> {
        if (!this.client) throw new Error('Bot not connected');
        const members = await this.client.getGroupMemberList(groupId);
        return Array.from(members.values()).map((member: any) => ({
            group_id: groupId,
            user_id: member.user_id,
            nickname: member.nickname,
            card: member.card,
            sex: member.sex,
            age: member.age,
            join_time: member.join_time,
            last_sent_time: member.last_sent_time,
            level: member.level,
            role: member.role,
            title: member.title,
            title_expire_time: member.title_expire_time,
            shutup_time: member.shutup_time,
        }));
    }

    /**
     * 获取群成员信息
     */
    async getGroupMemberInfo(groupId: number, userId: number): Promise<ICQQGroupMember | undefined> {
        if (!this.client) throw new Error('Bot not connected');
        const member = await this.client.getGroupMemberInfo(groupId, userId);
        if (!member) return undefined;
        return {
            group_id: groupId,
            user_id: member.user_id,
            nickname: member.nickname,
            card: member.card,
            sex: member.sex,
            age: member.age,
            join_time: member.join_time,
            last_sent_time: member.last_sent_time,
            level: member.level,
            role: member.role,
            title: member.title,
            title_expire_time: member.title_expire_time,
            shutup_time: member.shutup_time,
        };
    }

    /**
     * 处理群申请/邀请
     */
    async handleGroupRequest(flag: string, approve: boolean, reason?: string): Promise<boolean> {
        if (!this.client) throw new Error('Bot not connected');
        await this.client.setGroupAddRequest(flag, approve, reason);
        return true;
    }

    /**
     * 设置群名片
     */
    async setGroupCard(groupId: number, userId: number, card: string): Promise<boolean> {
        if (!this.client) throw new Error('Bot not connected');
        return this.client.setGroupCard(groupId, userId, card);
    }

    /**
     * 踢出群成员
     */
    async kickGroupMember(groupId: number, userId: number, rejectAddRequest?: boolean): Promise<boolean> {
        if (!this.client) throw new Error('Bot not connected');
        await this.client.setGroupKick(groupId, userId, rejectAddRequest);
        return true;
    }

    /**
     * 禁言群成员
     */
    async muteGroupMember(groupId: number, userId: number, duration: number): Promise<boolean> {
        if (!this.client) throw new Error('Bot not connected');
        return this.client.setGroupBan(groupId, userId, duration);
    }

    /**
     * 全员禁言
     */
    async muteGroupAll(groupId: number, enable: boolean): Promise<boolean> {
        if (!this.client) throw new Error('Bot not connected');
        return this.client.setGroupWholeBan(groupId, enable);
    }

    /**
     * 设置群管理员
     */
    async setGroupAdmin(groupId: number, userId: number, enable: boolean): Promise<boolean> {
        if (!this.client) throw new Error('Bot not connected');
        return this.client.setGroupAdmin(groupId, userId, enable);
    }

    /**
     * 退出群
     */
    async leaveGroup(groupId: number, dismiss?: boolean): Promise<boolean> {
        if (!this.client) throw new Error('Bot not connected');
        return this.client.setGroupLeave(groupId);
    }

    /**
     * 设置群名
     */
    async setGroupName(groupId: number, name: string): Promise<boolean> {
        if (!this.client) throw new Error('Bot not connected');
        return this.client.setGroupName(groupId, name);
    }

    /**
     * 设置群头像
     */
    async setGroupAvatar(groupId: number, file: string): Promise<void> {
        if (!this.client) throw new Error('Bot not connected');
        await this.client.setGroupPortrait(groupId, file);
    }

    // ============================================
    // 工具方法
    // ============================================

    /**
     * 提交滑块 ticket
     */
    submitSlider(ticket: string): void {
        if (!this.client) throw new Error('Bot not connected');
        this.client.submitSlider(ticket);
    }

    /**
     * 请求发送短信验证码（设备锁时可选，先调用此方法再提交验证码）
     */
    sendSmsCode(): Promise<void> {
        if (!this.client) throw new Error('Bot not connected');
        return this.client.sendSmsCode();
    }

    /**
     * 提交短信验证码
     */
    submitSmsCode(code: string): void {
        if (!this.client) throw new Error('Bot not connected');
        this.client.submitSmsCode(code);
    }

    /**
     * 扫码登录
     */
    qrcodeLogin(): void {
        if (!this.client) throw new Error('Bot not connected');
        this.client.login();
    }

    /**
     * 获取消息段构造器
     */
    static get segment() {
        return Segment;
    }
}

// 导出消息段构造器
export { Segment as segment };

