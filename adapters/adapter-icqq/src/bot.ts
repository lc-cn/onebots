/**
 * ICQQ Bot 封装
 * 基于 @icqqjs/icqq 库封装的机器人客户端
 */
import { EventEmitter } from "node:events";
import { createClient, Client, segment as Segment } from "@icqqjs/icqq";
import type { FriendInfo, GroupInfo, MemberInfo } from "@icqqjs/icqq/lib/entities";
import type { Sendable, PrivateMessage, GroupMessage } from "@icqqjs/icqq/lib/message";
import type { MessageRet } from "@icqqjs/icqq/lib/events";
import type { ICQQConfig, ICQQUser, ICQQFriend, ICQQGroup, ICQQGroupMember } from "./types.js";
import { detachICQQClientListeners, wireICQQClientEvents } from "./client-events.js";
import { buildICQQClientConfig, parseICQQUin } from "./client-config.js";
import { getICQQUserProfile } from "./user-profile.js";

export class ICQQBot extends EventEmitter {
    private config: ICQQConfig;
    private client: Client | null = null;
    private ready: boolean = false;
    private loginInfo: ICQQUser | null = null;
    private desiredRunning = false;
    private lifecycleGeneration = 0;
    private startPromise: Promise<void> | null = null;
    private readonly clientFactory: typeof createClient;

    constructor(config: ICQQConfig, deps?: { createClient?: typeof createClient }) {
        super();
        this.config = config;
        this.clientFactory = deps?.createClient ?? createClient;
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
        if (this.startPromise) return this.startPromise;
        if (this.desiredRunning && this.client) return;

        this.desiredRunning = true;
        const generation = ++this.lifecycleGeneration;
        let promise: Promise<void>;
        promise = this.startGeneration(generation).finally(() => {
            if (this.startPromise === promise) this.startPromise = null;
        });
        this.startPromise = promise;
        return promise;
    }

    private async startGeneration(generation: number): Promise<void> {
        const uin = parseICQQUin(this.config.account_id);
        const clientConfig = buildICQQClientConfig(this.config);

        const client = this.clientFactory(clientConfig);
        if (!this.isCurrentGeneration(generation)) return;
        this.client = client;
        // icqq 内部 setTimeout 调用 sendSsoHeartBeat 未 catch，超时会变成 UnhandledPromiseRejection 并拖垮进程
        this.patchSsoHeartBeat(client, generation);

        wireICQQClientEvents(client, {
            emit: (event, payload) => {
                if (this.isCurrentClient(client, generation)) this.emit(event, payload);
            },
            online: user => {
                if (!this.isCurrentClient(client, generation)) return;
                this.ready = true;
                this.loginInfo = user;
            },
            offline: () => {
                if (!this.isCurrentClient(client, generation)) return;
                this.ready = false;
            },
        });

        // 登录（login 返回 Promise，必须吞掉 rejection，避免未处理导致进程退出）
        let loginResult: ReturnType<Client["login"]>;
        try {
            loginResult = this.config.password
                ? client.login(uin, this.config.password)
                : client.login(uin);
        } catch (error) {
            if (this.isCurrentClient(client, generation)) {
                this.desiredRunning = false;
                this.client = null;
                detachICQQClientListeners(client);
            }
            throw error;
        }
        void Promise.resolve(loginResult).catch((error: unknown) => {
            if (!this.isCurrentClient(client, generation)) return;
            const message = error instanceof Error ? error.message : String(error);
            this.emit("login_error", { code: -1, message: message || "登录 Promise 被拒绝" });
        });
    }

    /**
     * 包裹 SSO 心跳：超时后记录并继续下一轮，避免未处理 rejection 导致进程退出
     */
    private patchSsoHeartBeat(client: Client, generation: number): void {
        type HeartbeatClient = Omit<Client, "sendSsoHeartBeat" | "startSsoHeartBeat"> & {
            sendSsoHeartBeat?: () => boolean | Promise<boolean>;
            startSsoHeartBeat?: () => void;
        };
        const hb = client as HeartbeatClient;
        const original = hb.sendSsoHeartBeat?.bind(hb);
        if (!original) return;

        hb.sendSsoHeartBeat = () => {
            if (!this.isCurrentClient(client, generation)) return false;
            try {
                const result = original();
                if (result && typeof (result as Promise<boolean>).then === "function") {
                    return (result as Promise<boolean>).catch((error: unknown) => {
                        if (!this.isCurrentClient(client, generation)) return false;
                        this.emit("heartbeat_error", error);
                        try {
                            hb.startSsoHeartBeat?.();
                        } catch {
                            // 忽略重启心跳失败
                        }
                        return false;
                    });
                }
                return result;
            } catch (error) {
                if (!this.isCurrentClient(client, generation)) return false;
                this.emit("heartbeat_error", error);
                try {
                    hb.startSsoHeartBeat?.();
                } catch {
                    // 忽略重启心跳失败
                }
                return false;
            }
        };
    }

    /**
     * 停止 Bot
     */
    async stop(): Promise<void> {
        this.desiredRunning = false;
        this.lifecycleGeneration += 1;
        const client = this.client;
        this.client = null;
        if (client) {
            try {
                await Promise.resolve(client.logout());
            } catch (error) {
                this.emit("stop_error", error);
            } finally {
                detachICQQClientListeners(client);
            }
        }
        this.ready = false;
        this.loginInfo = null;
        this.emit("stop");
    }

    private isCurrentGeneration(generation: number): boolean {
        return this.desiredRunning && generation === this.lifecycleGeneration;
    }

    private isCurrentClient(client: Client, generation: number): boolean {
        return this.isCurrentGeneration(generation) && this.client === client;
    }

    // ============================================
    // 消息发送 API
    // ============================================

    /**
     * 发送私聊消息
     */
    async sendPrivateMessage(userId: number, message: Sendable): Promise<MessageRet> {
        if (!this.client) throw new Error("Bot not connected");
        return this.client.sendPrivateMsg(userId, message);
    }

    /**
     * 发送群消息
     */
    async sendGroupMessage(groupId: number, message: Sendable): Promise<MessageRet> {
        if (!this.client) throw new Error("Bot not connected");
        return this.client.sendGroupMsg(groupId, message);
    }

    /** 邀请好友加入群；是否允许邀请仍由 QQ 权限和风控决定。 */
    async inviteFriendToGroup(groupId: number, userId: number): Promise<boolean> {
        if (!this.client) throw new Error("Bot not connected");
        return this.client.inviteFriend(groupId, userId);
    }

    /**
     * 撤回消息
     */
    async recallMessage(messageId: string): Promise<boolean> {
        if (!this.client) throw new Error("Bot not connected");
        return this.client.deleteMsg(messageId);
    }

    /**
     * 获取消息
     */
    async getMessage(messageId: string): Promise<PrivateMessage | GroupMessage | undefined> {
        if (!this.client) throw new Error("Bot not connected");
        return this.client.getMsg(messageId);
    }

    // ============================================
    // 好友 API
    // ============================================

    /**
     * 获取好友列表
     */
    async getFriendList(noCache = false): Promise<ICQQFriend[]> {
        const client = this.client;
        if (!client) throw new Error("Bot not connected");
        if (noCache) await client.reloadFriendList();
        const friends = client.fl;
        return Array.from(friends.values()).map((friend: FriendInfo) => ({
            user_id: friend.user_id,
            nickname: friend.nickname,
            sex: friend.sex,
            remark: friend.remark,
            class_id: friend.class_id,
            class_name: client.classes.get(friend.class_id) ?? "",
        }));
    }

    /** 获取好友资料；不存在时不降级为陌生人资料。 */
    async getFriendInfo(userId: number, noCache = false): Promise<ICQQFriend | undefined> {
        const client = this.client;
        if (!client) throw new Error("Bot not connected");
        if (noCache) await client.reloadFriendList();
        const friend = client.fl.get(userId);
        if (!friend) return undefined;
        return {
            user_id: friend.user_id,
            nickname: friend.nickname,
            sex: friend.sex,
            remark: friend.remark,
            class_id: friend.class_id,
            class_name: client.classes.get(friend.class_id) ?? "",
        };
    }

    /**
     * 获取陌生人信息
     */
    async getStrangerInfo(userId: number): Promise<ICQQUser> {
        if (!this.client) throw new Error("Bot not connected");
        return getICQQUserProfile(this.client, userId);
    }

    /**
     * 处理好友申请
     */
    async handleFriendRequest(flag: string, approve: boolean, remark?: string): Promise<boolean> {
        if (!this.client) throw new Error("Bot not connected");
        return this.client.setFriendAddRequest(flag, approve, remark);
    }

    /**
     * 删除好友
     */
    async deleteFriend(userId: number): Promise<boolean> {
        if (!this.client) throw new Error("Bot not connected");
        return this.client.deleteFriend(userId);
    }

    // ============================================
    // 群组 API
    // ============================================

    /**
     * 获取群列表
     */
    async getGroupList(noCache = false): Promise<ICQQGroup[]> {
        const client = this.client;
        if (!client) throw new Error("Bot not connected");
        if (noCache) await client.reloadGroupList();
        const groups = client.gl;
        return Array.from(groups.values()).map((group: GroupInfo) => ({
            group_id: group.group_id,
            group_name: group.group_name,
            owner_id: group.owner_id,
            member_count: group.member_count,
            max_member_count: group.max_member_count,
            created_time: group.create_time,
        }));
    }

    /**
     * 获取群信息
     */
    async getGroupInfo(groupId: number, noCache = false): Promise<ICQQGroup | undefined> {
        const client = this.client;
        if (!client) throw new Error("Bot not connected");
        const group = noCache ? await client.getGroupInfo(groupId, true) : client.gl.get(groupId);
        if (!group) return undefined;
        return {
            group_id: group.group_id,
            group_name: group.group_name,
            owner_id: group.owner_id,
            member_count: group.member_count,
            max_member_count: group.max_member_count,
            created_time: group.create_time,
        };
    }

    /**
     * 获取群成员列表
     */
    async getGroupMemberList(groupId: number, noCache = false): Promise<ICQQGroupMember[]> {
        if (!this.client) throw new Error("Bot not connected");
        const members = await this.client.getGroupMemberList(groupId, noCache);
        return Array.from(members.values()).map((member: MemberInfo) => ({
            group_id: groupId,
            user_id: member.user_id,
            nickname: member.nickname,
            card: member.card,
            sex: member.sex,
            age: member.age,
            area: member.area,
            join_time: member.join_time,
            last_sent_time: member.last_sent_time,
            level: member.level,
            role: member.role,
            title: member.title,
            title_expire_time: member.title_expire_time,
            shut_up_end_time: member.shutup_time || undefined,
        }));
    }

    /**
     * 获取群成员信息
     */
    async getGroupMemberInfo(
        groupId: number,
        userId: number,
        noCache = false,
    ): Promise<ICQQGroupMember | undefined> {
        if (!this.client) throw new Error("Bot not connected");
        const member = await this.client.getGroupMemberInfo(groupId, userId, noCache);
        if (!member) return undefined;
        return {
            group_id: groupId,
            user_id: member.user_id,
            nickname: member.nickname,
            card: member.card,
            sex: member.sex,
            age: member.age,
            area: member.area,
            join_time: member.join_time,
            last_sent_time: member.last_sent_time,
            level: member.level,
            role: member.role,
            title: member.title,
            title_expire_time: member.title_expire_time,
            shut_up_end_time: member.shutup_time || undefined,
        };
    }

    /**
     * 处理群申请/邀请
     */
    async handleGroupRequest(flag: string, approve: boolean, reason?: string): Promise<boolean> {
        if (!this.client) throw new Error("Bot not connected");
        await this.client.setGroupAddRequest(flag, approve, reason);
        return true;
    }

    /**
     * 设置群名片
     */
    async setGroupCard(groupId: number, userId: number, card: string): Promise<boolean> {
        if (!this.client) throw new Error("Bot not connected");
        return this.client.setGroupCard(groupId, userId, card);
    }

    /**
     * 踢出群成员
     */
    async kickGroupMember(
        groupId: number,
        userId: number,
        rejectAddRequest?: boolean,
    ): Promise<boolean> {
        if (!this.client) throw new Error("Bot not connected");
        await this.client.setGroupKick(groupId, userId, rejectAddRequest);
        return true;
    }

    /**
     * 禁言群成员
     */
    async muteGroupMember(groupId: number, userId: number, duration: number): Promise<boolean> {
        if (!this.client) throw new Error("Bot not connected");
        return this.client.setGroupBan(groupId, userId, duration);
    }

    /**
     * 全员禁言
     */
    async muteGroupAll(groupId: number, enable: boolean): Promise<boolean> {
        if (!this.client) throw new Error("Bot not connected");
        return this.client.setGroupWholeBan(groupId, enable);
    }

    /**
     * 设置群管理员
     */
    async setGroupAdmin(groupId: number, userId: number, enable: boolean): Promise<boolean> {
        if (!this.client) throw new Error("Bot not connected");
        return this.client.setGroupAdmin(groupId, userId, enable);
    }

    /**
     * 退出群
     */
    async leaveGroup(groupId: number): Promise<boolean> {
        if (!this.client) throw new Error("Bot not connected");
        return this.client.setGroupLeave(groupId);
    }

    /**
     * 设置群名
     */
    async setGroupName(groupId: number, name: string): Promise<boolean> {
        if (!this.client) throw new Error("Bot not connected");
        return this.client.setGroupName(groupId, name);
    }

    /**
     * 设置群头像
     */
    async setGroupAvatar(groupId: number, file: string): Promise<void> {
        if (!this.client) throw new Error("Bot not connected");
        await this.client.setGroupPortrait(groupId, file);
    }

    // ============================================
    // 工具方法
    // ============================================

    /**
     * 提交滑块 ticket
     */
    submitSlider(ticket: string): void {
        if (!this.client) throw new Error("Bot not connected");
        this.client.submitSlider(ticket);
    }

    /**
     * 请求发送短信验证码（设备锁时可选，先调用此方法再提交验证码）
     */
    sendSmsCode(): Promise<void> {
        if (!this.client) throw new Error("Bot not connected");
        return this.client.sendSmsCode();
    }

    /**
     * 提交短信验证码
     */
    submitSmsCode(code: string): void {
        if (!this.client) throw new Error("Bot not connected");
        this.client.submitSmsCode(code);
    }

    /**
     * 继续登录流程（扫码确认、身份验证完成后调用，等价于 client.login()）
     */
    continueLogin(): void {
        if (!this.client) throw new Error("Bot not connected");
        this.client.login();
    }
}

// 导出消息段构造器
export { Segment as segment };
