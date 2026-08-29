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
import type { ICQQBotEvents } from "./bot-events.js";
import { ICQQError } from "./errors.js";
import { patchICQQSsoHeartbeat } from "./heartbeat.js";

export class ICQQBot extends EventEmitter<ICQQBotEvents> {
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
        promise = this.startGeneration(generation)
            .catch(error => {
                throw ICQQError.wrap(error, "ICQQ_START_FAILED", "start");
            })
            .finally(() => {
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
        patchICQQSsoHeartbeat(
            client,
            () => this.isCurrentClient(client, generation),
            error => this.safeEmit("heartbeat_error", error),
        );

        wireICQQClientEvents(client, {
            emit: (event, ...args) => {
                if (this.isCurrentClient(client, generation))
                    Reflect.apply(this.safeEmit, this, [event, ...args]);
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
            this.safeEmit("login_error", {
                code: -1,
                message: message || "登录 Promise 被拒绝",
            });
        });
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
                this.safeEmit("stop_error", ICQQError.wrap(error, "ICQQ_STOP_FAILED", "stop"));
            } finally {
                detachICQQClientListeners(client);
            }
        }
        this.ready = false;
        this.loginInfo = null;
        this.safeEmit("stop");
    }

    private isCurrentGeneration(generation: number): boolean {
        return this.desiredRunning && generation === this.lifecycleGeneration;
    }

    private isCurrentClient(client: Client, generation: number): boolean {
        return this.isCurrentGeneration(generation) && this.client === client;
    }

    private requireClient(operation: string): Client {
        if (!this.client)
            throw new ICQQError("ICQQ Bot 尚未连接", {
                code: "ICQQ_NOT_CONNECTED",
                operation,
            });
        return this.client;
    }

    private safeEmit<K extends keyof ICQQBotEvents>(name: K, ...args: ICQQBotEvents[K]): void {
        for (const listener of this.rawListeners(String(name))) {
            try {
                Reflect.apply(listener, this, args);
            } catch (error) {
                if (name !== "client_error")
                    this.safeEmit(
                        "client_error",
                        ICQQError.wrap(error, "ICQQ_LISTENER_FAILED", String(name)),
                    );
            }
        }
    }

    // ============================================
    // 消息发送 API
    // ============================================

    /**
     * 发送私聊消息
     */
    async sendPrivateMessage(userId: number, message: Sendable): Promise<MessageRet> {
        return this.requireClient("sendPrivateMessage").sendPrivateMsg(userId, message);
    }

    /**
     * 发送群消息
     */
    async sendGroupMessage(groupId: number, message: Sendable): Promise<MessageRet> {
        return this.requireClient("sendGroupMessage").sendGroupMsg(groupId, message);
    }

    /** 邀请好友加入群；是否允许邀请仍由 QQ 权限和风控决定。 */
    async inviteFriendToGroup(groupId: number, userId: number): Promise<boolean> {
        return this.requireClient("inviteFriendToGroup").inviteFriend(groupId, userId);
    }

    /**
     * 撤回消息
     */
    async recallMessage(messageId: string): Promise<boolean> {
        return this.requireClient("recallMessage").deleteMsg(messageId);
    }

    /**
     * 获取消息
     */
    async getMessage(messageId: string): Promise<PrivateMessage | GroupMessage | undefined> {
        return this.requireClient("getMessage").getMsg(messageId);
    }

    // 好友 API

    /**
     * 获取好友列表
     */
    async getFriendList(noCache = false): Promise<ICQQFriend[]> {
        const client = this.requireClient("getFriendList");
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
        const client = this.requireClient("getFriendInfo");
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
        return getICQQUserProfile(this.requireClient("getStrangerInfo"), userId);
    }

    /**
     * 处理好友申请
     */
    async handleFriendRequest(flag: string, approve: boolean, remark?: string): Promise<boolean> {
        return this.requireClient("handleFriendRequest").setFriendAddRequest(flag, approve, remark);
    }

    /**
     * 删除好友
     */
    async deleteFriend(userId: number): Promise<boolean> {
        return this.requireClient("deleteFriend").deleteFriend(userId);
    }

    // ============================================
    // 群组 API
    // ============================================

    /**
     * 获取群列表
     */
    async getGroupList(noCache = false): Promise<ICQQGroup[]> {
        const client = this.requireClient("getGroupList");
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
        const client = this.requireClient("getGroupInfo");
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
        const members = await this.requireClient("getGroupMemberList").getGroupMemberList(
            groupId,
            noCache,
        );
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
        const member = await this.requireClient("getGroupMemberInfo").getGroupMemberInfo(
            groupId,
            userId,
            noCache,
        );
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
        await this.requireClient("handleGroupRequest").setGroupAddRequest(flag, approve, reason);
        return true;
    }

    /**
     * 设置群名片
     */
    async setGroupCard(groupId: number, userId: number, card: string): Promise<boolean> {
        return this.requireClient("setGroupCard").setGroupCard(groupId, userId, card);
    }

    /**
     * 踢出群成员
     */
    async kickGroupMember(
        groupId: number,
        userId: number,
        rejectAddRequest?: boolean,
    ): Promise<boolean> {
        await this.requireClient("kickGroupMember").setGroupKick(groupId, userId, rejectAddRequest);
        return true;
    }

    /**
     * 禁言群成员
     */
    async muteGroupMember(groupId: number, userId: number, duration: number): Promise<boolean> {
        return this.requireClient("muteGroupMember").setGroupBan(groupId, userId, duration);
    }

    /**
     * 全员禁言
     */
    async muteGroupAll(groupId: number, enable: boolean): Promise<boolean> {
        return this.requireClient("muteGroupAll").setGroupWholeBan(groupId, enable);
    }

    /**
     * 设置群管理员
     */
    async setGroupAdmin(groupId: number, userId: number, enable: boolean): Promise<boolean> {
        return this.requireClient("setGroupAdmin").setGroupAdmin(groupId, userId, enable);
    }

    /**
     * 退出群
     */
    async leaveGroup(groupId: number): Promise<boolean> {
        return this.requireClient("leaveGroup").setGroupLeave(groupId);
    }

    /**
     * 设置群名
     */
    async setGroupName(groupId: number, name: string): Promise<boolean> {
        return this.requireClient("setGroupName").setGroupName(groupId, name);
    }

    /**
     * 设置群头像
     */
    async setGroupAvatar(groupId: number, file: string): Promise<void> {
        await this.requireClient("setGroupAvatar").setGroupPortrait(groupId, file);
    }

    // ============================================
    // 工具方法
    // ============================================

    /**
     * 提交滑块 ticket
     */
    submitSlider(ticket: string): void {
        this.requireClient("submitSlider").submitSlider(ticket);
    }

    /**
     * 请求发送短信验证码（设备锁时可选，先调用此方法再提交验证码）
     */
    sendSmsCode(): Promise<void> {
        return this.requireClient("sendSmsCode").sendSmsCode();
    }

    /**
     * 提交短信验证码
     */
    submitSmsCode(code: string): void {
        this.requireClient("submitSmsCode").submitSmsCode(code);
    }

    /**
     * 继续登录流程（扫码确认、身份验证完成后调用，等价于 client.login()）
     */
    continueLogin(): void {
        this.requireClient("continueLogin").login();
    }
}

// 导出消息段构造器
export { Segment as segment };
