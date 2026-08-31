/**
 * Mock Bot 实现
 * 模拟真实机器人行为，用于测试
 */

import { EventEmitter } from "node:events";
import { MockError } from "./errors.js";
import {
    assertMockHeartbeat,
    assertMockMessage,
    assertMockRequest,
    cloneMockGroup,
    collectMockMessages,
    createMockRandom,
    validateMockConfig,
} from "./runtime.js";
import type {
    MockAutoEventType,
    MockConfig,
    MockFriendRequest,
    MockGroup,
    MockHeartbeat,
    MockInboundEvent,
    MockInboundEventMap,
    MockIncomingMessage,
    MockMember,
    MockMessage,
    MockMessageSent,
    MockReadyUser,
    MockUser,
} from "./types.js";

const DEFAULT_AUTO_EVENT_TYPES: readonly MockAutoEventType[] = [
    "private_message",
    "group_message",
    "friend_request",
    "heartbeat",
];
export interface MockBotEvents {
    ready: [user: MockReadyUser];
    stopped: [];
    message: [event: MockIncomingMessage];
    request: [event: MockFriendRequest];
    heartbeat: [event: MockHeartbeat];
    message_sent: [event: MockMessageSent];
    client_error: [error: MockError];
}

export interface MockBotOptions {
    now?: () => number;
    random?: () => number;
    sleep?: (delayMs: number) => Promise<void>;
}

export class MockBot extends EventEmitter<MockBotEvents> {
    private readonly config: MockConfig;
    private messageIdCounter = 0;
    private eventTimer: NodeJS.Timeout | null = null;
    private isRunning = false;
    private generation = 0;
    private readonly now: () => number;
    private readonly random: () => number;
    private readonly sleep: (delayMs: number) => Promise<void>;

    // 模拟数据存储
    private friends: Map<string, MockUser> = new Map();
    private groups: Map<string, MockGroup> = new Map();
    private messages: Map<string, MockMessage> = new Map();
    private readonly sentMessageIds = new Set<string>();
    private readonly receivedMessageIds = new Set<string>();

    constructor(config: MockConfig, options: MockBotOptions = {}) {
        super();
        validateMockConfig(config);
        this.config = {
            ...config,
            auto_event_types: config.auto_event_types && [...config.auto_event_types],
            friends: config.friends?.map(friend => ({ ...friend })),
            groups: config.groups?.map(cloneMockGroup),
        };
        this.now = options.now || Date.now;
        this.random = options.random || createMockRandom(config.random_seed);
        this.sleep =
            options.sleep || (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)));
        this.initMockData();
    }

    private initMockData(): void {
        // 初始化默认好友
        const defaultFriends: MockUser[] = this.config.friends ?? [
            { user_id: "10001", nickname: "测试好友1", avatar: "https://via.placeholder.com/100" },
            { user_id: "10002", nickname: "测试好友2", avatar: "https://via.placeholder.com/100" },
            { user_id: "10003", nickname: "测试好友3", avatar: "https://via.placeholder.com/100" },
        ];
        defaultFriends.forEach(friend => this.friends.set(friend.user_id, { ...friend }));

        // 初始化默认群组
        const defaultGroups: MockGroup[] = this.config.groups ?? [
            {
                group_id: "100001",
                group_name: "测试群1",
                member_count: 50,
                max_member_count: 200,
                members: [
                    { user_id: "10001", nickname: "群主", role: "owner", card: "大佬" },
                    { user_id: "10002", nickname: "管理员", role: "admin" },
                    { user_id: "10003", nickname: "普通成员", role: "member" },
                ],
            },
            {
                group_id: "100002",
                group_name: "测试群2",
                member_count: 100,
                max_member_count: 500,
                members: [{ user_id: this.config.account_id, nickname: "机器人", role: "member" }],
            },
        ];
        defaultGroups.forEach(group => this.groups.set(group.group_id, cloneMockGroup(group)));
    }

    async start(): Promise<void> {
        if (this.isRunning) return;
        const generation = ++this.generation;
        this.isRunning = true;

        // 模拟启动延迟
        await this.delay(this.config.latency ?? 100);
        if (!this.isRunning || generation !== this.generation) return;

        // 触发就绪事件
        this.emit("ready", {
            user_id: this.config.account_id,
            nickname: this.config.nickname ?? "MockBot",
            avatar: this.config.avatar ?? "https://via.placeholder.com/100",
        });

        // 启动自动事件生成
        if (this.config.auto_events) {
            this.startEventGeneration();
        }
    }

    async stop(): Promise<void> {
        this.isRunning = false;
        this.generation += 1;
        if (this.eventTimer) {
            clearInterval(this.eventTimer);
            this.eventTimer = null;
        }
        this.emit("stopped");
    }

    private startEventGeneration(): void {
        const interval = this.config.event_interval ?? 5000;
        this.eventTimer = setInterval(() => {
            if (!this.isRunning) return;
            this.generateRandomEvent();
        }, interval);
    }

    private generateRandomEvent(): void {
        const eventTypes = this.config.auto_event_types?.length
            ? this.config.auto_event_types
            : DEFAULT_AUTO_EVENT_TYPES;
        const type = this.choose(eventTypes);

        switch (type) {
            case "private_message":
                this.emitPrivateMessage();
                break;
            case "group_message":
                this.emitGroupMessage();
                break;
            case "friend_request":
                this.emitFriendRequest();
                break;
            case "heartbeat":
                this.ingest({ type: "heartbeat", data: { time: this.now() } });
                break;
        }
    }

    private emitPrivateMessage(): void {
        const friends = Array.from(this.friends.values());
        if (friends.length === 0) return;
        const friend = this.choose(friends);
        const now = this.now();

        const message: MockMessage = {
            message_id: this.generateMessageId(),
            user_id: friend.user_id,
            content: `这是来自 ${friend.nickname} 的测试消息 #${now}`,
            time: Math.floor(now / 1000),
        };

        this.ingest({
            type: "message",
            data: {
                type: "private",
                message_id: message.message_id,
                user_id: friend.user_id,
                nickname: friend.nickname,
                content: message.content,
                time: message.time,
            },
        });
    }

    private emitGroupMessage(): void {
        const groups = Array.from(this.groups.values());
        if (groups.length === 0) return;
        const group = this.choose(groups);
        const members = group.members || [];
        if (members.length === 0) return;
        const member = this.choose(members);
        const now = this.now();

        const message: MockMessage = {
            message_id: this.generateMessageId(),
            user_id: member.user_id,
            group_id: group.group_id,
            content: `这是来自 ${group.group_name} 的测试消息 #${now}`,
            time: Math.floor(now / 1000),
        };

        this.ingest({
            type: "message",
            data: {
                type: "group",
                message_id: message.message_id,
                group_id: group.group_id,
                group_name: group.group_name,
                user_id: member.user_id,
                nickname: member.nickname,
                content: message.content,
                time: message.time,
            },
        });
    }

    private emitFriendRequest(): void {
        const now = this.now();
        this.ingest({
            type: "request",
            data: {
                type: "friend",
                user_id: String(100000 + Math.floor(this.random() * 10000)),
                nickname: `新好友${now}`,
                comment: "请求添加好友",
                flag: `flag_${now}`,
                time: now,
            },
        });
    }

    private generateMessageId(): string {
        return `mock_msg_${++this.messageIdCounter}_${this.now()}`;
    }

    private delay(ms: number): Promise<void> {
        return this.sleep(ms);
    }

    private choose<T>(values: readonly T[]): T {
        const value = values[Math.floor(this.random() * values.length)];
        if (value === undefined)
            throw new MockError("Mock 随机集合不能为空", { code: "MOCK_EMPTY_RANDOM_SOURCE" });
        return value;
    }

    // ========== API 方法 ==========

    async getLoginInfo(): Promise<{ user_id: string; nickname: string }> {
        await this.delay(this.config.latency ?? 10);
        return {
            user_id: this.config.account_id,
            nickname: this.config.nickname ?? "MockBot",
        };
    }

    async getFriendList(): Promise<MockUser[]> {
        await this.delay(this.config.latency ?? 10);
        return Array.from(this.friends.values(), friend => ({ ...friend }));
    }

    async getGroupList(): Promise<MockGroup[]> {
        await this.delay(this.config.latency ?? 10);
        return Array.from(this.groups.values()).map(g => ({
            group_id: g.group_id,
            group_name: g.group_name,
            member_count: g.member_count,
            max_member_count: g.max_member_count,
        }));
    }

    async getGroupInfo(groupId: string): Promise<MockGroup | null> {
        await this.delay(this.config.latency ?? 10);
        const group = this.groups.get(groupId);
        return group ? cloneMockGroup(group) : null;
    }

    async getGroupMemberList(groupId: string): Promise<MockMember[]> {
        await this.delay(this.config.latency ?? 10);
        const group = this.groups.get(groupId);
        return group?.members?.map(member => ({ ...member })) || [];
    }

    async getGroupMemberInfo(groupId: string, userId: string): Promise<MockMember | null> {
        await this.delay(this.config.latency ?? 10);
        const group = this.groups.get(groupId);
        const member = group?.members?.find(item => item.user_id === userId);
        return member ? { ...member } : null;
    }

    async getUserInfo(userId: string): Promise<MockUser | null> {
        await this.delay(this.config.latency ?? 10);
        const user = this.friends.get(userId);
        return user ? { ...user } : null;
    }

    async sendMessage(
        targetId: string,
        message: string,
        type: "private" | "group" = "private",
    ): Promise<{ message_id: string }> {
        await this.delay(this.config.latency ?? 50);

        const msg: MockMessage = {
            message_id: this.generateMessageId(),
            user_id: this.config.account_id,
            group_id: type === "group" ? targetId : undefined,
            content: message,
            time: Math.floor(this.now() / 1000),
        };

        this.messages.set(msg.message_id, msg);
        this.sentMessageIds.add(msg.message_id);

        if (this.config.auto_events) {
            const generation = this.generation;
            void this.delay(100)
                .then(() => {
                    if (!this.isRunning || generation !== this.generation) return;
                    this.emit("message_sent", {
                        message_id: msg.message_id,
                        target_id: targetId,
                        type,
                    });
                })
                .catch(error => {
                    this.emit("client_error", MockError.wrap(error, "MOCK_ASYNC_EVENT_FAILED"));
                });
        }

        return { message_id: msg.message_id };
    }

    async deleteMessage(messageId: string): Promise<boolean> {
        await this.delay(this.config.latency ?? 10);
        this.sentMessageIds.delete(messageId);
        this.receivedMessageIds.delete(messageId);
        return this.messages.delete(messageId);
    }

    async getMessage(messageId: string): Promise<MockMessage | null> {
        await this.delay(this.config.latency ?? 10);
        const message = this.messages.get(messageId);
        return message ? { ...message } : null;
    }

    // ========== 测试辅助方法 ==========

    /** 将结构化模拟事件交给与自动事件相同的 typed 入口。 */
    ingest(event: MockInboundEvent): void {
        switch (event.type) {
            case "message":
                assertMockMessage(event.data);
                this.messages.set(event.data.message_id, {
                    message_id: event.data.message_id,
                    user_id: event.data.user_id,
                    group_id: event.data.group_id,
                    content: event.data.content,
                    time: event.data.time,
                });
                this.receivedMessageIds.add(event.data.message_id);
                this.emit("message", event.data);
                return;
            case "request":
                assertMockRequest(event.data);
                this.emit("request", { ...event.data, time: event.data.time ?? this.now() });
                return;
            case "heartbeat":
                assertMockHeartbeat(event.data);
                this.emit("heartbeat", event.data);
        }
    }

    /** 按事件名触发 typed 事件；适合 Vitest 等测试代码。 */
    triggerEvent(event: "message", data: MockIncomingMessage): void;
    triggerEvent(event: "request", data: MockFriendRequest): void;
    triggerEvent(event: "heartbeat", data: MockHeartbeat): void;
    triggerEvent(event: keyof MockInboundEventMap, data: unknown): void {
        switch (event) {
            case "message":
                assertMockMessage(data);
                this.ingest({ type: "message", data });
                return;
            case "request":
                assertMockRequest(data);
                this.ingest({ type: "request", data });
                return;
            case "heartbeat":
                assertMockHeartbeat(data);
                this.ingest({ type: "heartbeat", data });
        }
    }

    /**
     * 添加模拟好友
     */
    addFriend(friend: MockUser): void {
        this.friends.set(friend.user_id, { ...friend });
    }

    /**
     * 添加模拟群组
     */
    addGroup(group: MockGroup): void {
        this.groups.set(group.group_id, cloneMockGroup(group));
    }

    /**
     * 获取所有已发送的消息（用于断言）
     */
    getSentMessages(): MockMessage[] {
        return collectMockMessages(this.sentMessageIds, this.messages);
    }

    /** 获取自动生成或手动记录的入站消息。 */
    getReceivedMessages(): MockMessage[] {
        return collectMockMessages(this.receivedMessageIds, this.messages);
    }

    /**
     * 清除所有模拟数据
     */
    clearData(): void {
        this.friends.clear();
        this.groups.clear();
        this.messages.clear();
        this.sentMessageIds.clear();
        this.receivedMessageIds.clear();
    }

    /**
     * 检查是否正在运行
     */
    isActive(): boolean {
        return this.isRunning;
    }
}
