/**
 * Mock Bot 实现
 * 模拟真实机器人行为，用于测试
 */

import { EventEmitter } from 'events';
import type { MockConfig, MockUser, MockGroup, MockMember, MockMessage } from './types.js';

export class MockBot extends EventEmitter {
    private config: MockConfig;
    private messageIdCounter = 0;
    private eventTimer: NodeJS.Timeout | null = null;
    private isRunning = false;

    // 模拟数据存储
    private friends: Map<string, MockUser> = new Map();
    private groups: Map<string, MockGroup> = new Map();
    private messages: Map<string, MockMessage> = new Map();

    constructor(config: MockConfig) {
        super();
        this.config = config;
        this.initMockData();
    }

    private initMockData(): void {
        // 初始化默认好友
        const defaultFriends: MockUser[] = this.config.friends || [
            { user_id: '10001', nickname: '测试好友1', avatar: 'https://via.placeholder.com/100' },
            { user_id: '10002', nickname: '测试好友2', avatar: 'https://via.placeholder.com/100' },
            { user_id: '10003', nickname: '测试好友3', avatar: 'https://via.placeholder.com/100' },
        ];
        defaultFriends.forEach(f => this.friends.set(f.user_id, f));

        // 初始化默认群组
        const defaultGroups: MockGroup[] = this.config.groups || [
            {
                group_id: '100001',
                group_name: '测试群1',
                member_count: 50,
                max_member_count: 200,
                members: [
                    { user_id: '10001', nickname: '群主', role: 'owner', card: '大佬' },
                    { user_id: '10002', nickname: '管理员', role: 'admin' },
                    { user_id: '10003', nickname: '普通成员', role: 'member' },
                ],
            },
            {
                group_id: '100002',
                group_name: '测试群2',
                member_count: 100,
                max_member_count: 500,
                members: [
                    { user_id: this.config.account_id, nickname: '机器人', role: 'member' },
                ],
            },
        ];
        defaultGroups.forEach(g => this.groups.set(g.group_id, g));
    }

    async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;

        // 模拟启动延迟
        await this.delay(this.config.latency || 100);

        // 触发就绪事件
        this.emit('ready', {
            user_id: this.config.account_id,
            nickname: this.config.nickname || 'MockBot',
            avatar: this.config.avatar || 'https://via.placeholder.com/100',
        });

        // 启动自动事件生成
        if (this.config.auto_events) {
            this.startEventGeneration();
        }
    }

    async stop(): Promise<void> {
        this.isRunning = false;
        if (this.eventTimer) {
            clearInterval(this.eventTimer);
            this.eventTimer = null;
        }
        this.emit('stopped');
    }

    private startEventGeneration(): void {
        const interval = this.config.event_interval || 5000;
        this.eventTimer = setInterval(() => {
            if (!this.isRunning) return;
            this.generateRandomEvent();
        }, interval);
    }

    private generateRandomEvent(): void {
        const eventTypes = ['private_message', 'group_message', 'friend_request', 'heartbeat'];
        const type = eventTypes[Math.floor(Math.random() * eventTypes.length)];

        switch (type) {
            case 'private_message':
                this.emitPrivateMessage();
                break;
            case 'group_message':
                this.emitGroupMessage();
                break;
            case 'friend_request':
                this.emitFriendRequest();
                break;
            case 'heartbeat':
                this.emit('heartbeat', { time: Date.now() });
                break;
        }
    }

    private emitPrivateMessage(): void {
        const friends = Array.from(this.friends.values());
        if (friends.length === 0) return;
        const friend = friends[Math.floor(Math.random() * friends.length)];

        const message: MockMessage = {
            message_id: this.generateMessageId(),
            user_id: friend.user_id,
            content: `这是来自 ${friend.nickname} 的测试消息 #${Date.now()}`,
            time: Math.floor(Date.now() / 1000),
        };

        this.messages.set(message.message_id, message);
        this.emit('message', {
            type: 'private',
            message_id: message.message_id,
            user_id: friend.user_id,
            nickname: friend.nickname,
            content: message.content,
            time: message.time,
        });
    }

    private emitGroupMessage(): void {
        const groups = Array.from(this.groups.values());
        if (groups.length === 0) return;
        const group = groups[Math.floor(Math.random() * groups.length)];
        const members = group.members || [];
        if (members.length === 0) return;
        const member = members[Math.floor(Math.random() * members.length)];

        const message: MockMessage = {
            message_id: this.generateMessageId(),
            user_id: member.user_id,
            group_id: group.group_id,
            content: `这是来自 ${group.group_name} 的测试消息 #${Date.now()}`,
            time: Math.floor(Date.now() / 1000),
        };

        this.messages.set(message.message_id, message);
        this.emit('message', {
            type: 'group',
            message_id: message.message_id,
            group_id: group.group_id,
            group_name: group.group_name,
            user_id: member.user_id,
            nickname: member.nickname,
            card: member.card,
            content: message.content,
            time: message.time,
        });
    }

    private emitFriendRequest(): void {
        this.emit('request', {
            type: 'friend',
            user_id: String(100000 + Math.floor(Math.random() * 10000)),
            nickname: `新好友${Date.now()}`,
            comment: '请求添加好友',
            flag: `flag_${Date.now()}`,
        });
    }

    private generateMessageId(): string {
        return `mock_msg_${++this.messageIdCounter}_${Date.now()}`;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ========== API 方法 ==========

    async getLoginInfo(): Promise<{ user_id: string; nickname: string }> {
        await this.delay(this.config.latency || 10);
        return {
            user_id: this.config.account_id,
            nickname: this.config.nickname || 'MockBot',
        };
    }

    async getFriendList(): Promise<MockUser[]> {
        await this.delay(this.config.latency || 10);
        return Array.from(this.friends.values());
    }

    async getGroupList(): Promise<MockGroup[]> {
        await this.delay(this.config.latency || 10);
        return Array.from(this.groups.values()).map(g => ({
            group_id: g.group_id,
            group_name: g.group_name,
            member_count: g.member_count,
            max_member_count: g.max_member_count,
        }));
    }

    async getGroupInfo(groupId: string): Promise<MockGroup | null> {
        await this.delay(this.config.latency || 10);
        return this.groups.get(groupId) || null;
    }

    async getGroupMemberList(groupId: string): Promise<MockMember[]> {
        await this.delay(this.config.latency || 10);
        const group = this.groups.get(groupId);
        return group?.members || [];
    }

    async getGroupMemberInfo(groupId: string, userId: string): Promise<MockMember | null> {
        await this.delay(this.config.latency || 10);
        const group = this.groups.get(groupId);
        return group?.members?.find(m => m.user_id === userId) || null;
    }

    async getUserInfo(userId: string): Promise<MockUser | null> {
        await this.delay(this.config.latency || 10);
        return this.friends.get(userId) || null;
    }

    async sendMessage(
        targetId: string,
        message: string,
        type: 'private' | 'group' = 'private'
    ): Promise<{ message_id: string }> {
        await this.delay(this.config.latency || 50);

        const msg: MockMessage = {
            message_id: this.generateMessageId(),
            user_id: this.config.account_id,
            group_id: type === 'group' ? targetId : undefined,
            content: message,
            time: Math.floor(Date.now() / 1000),
        };

        this.messages.set(msg.message_id, msg);

        // 模拟回复
        if (this.config.auto_events) {
            setTimeout(() => {
                this.emit('message_sent', {
                    message_id: msg.message_id,
                    target_id: targetId,
                    type,
                });
            }, 100);
        }

        return { message_id: msg.message_id };
    }

    async deleteMessage(messageId: string): Promise<boolean> {
        await this.delay(this.config.latency || 10);
        return this.messages.delete(messageId);
    }

    async getMessage(messageId: string): Promise<MockMessage | null> {
        await this.delay(this.config.latency || 10);
        return this.messages.get(messageId) || null;
    }

    // ========== 测试辅助方法 ==========

    /**
     * 手动触发事件（用于测试）
     */
    triggerEvent(event: string, data: unknown): void {
        this.emit(event, data);
    }

    /**
     * 添加模拟好友
     */
    addFriend(friend: MockUser): void {
        this.friends.set(friend.user_id, friend);
    }

    /**
     * 添加模拟群组
     */
    addGroup(group: MockGroup): void {
        this.groups.set(group.group_id, group);
    }

    /**
     * 获取所有已发送的消息（用于断言）
     */
    getSentMessages(): MockMessage[] {
        return Array.from(this.messages.values());
    }

    /**
     * 清除所有模拟数据
     */
    clearData(): void {
        this.friends.clear();
        this.groups.clear();
        this.messages.clear();
        this.initMockData();
    }

    /**
     * 检查是否正在运行
     */
    isActive(): boolean {
        return this.isRunning;
    }
}

