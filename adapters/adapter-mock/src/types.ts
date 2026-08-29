/**
 * Mock 适配器类型定义
 * 用于测试和开发环境
 */

export interface MockConfig {
    account_id: string;
    /** 模拟的用户名 */
    nickname?: string;
    /** 模拟的头像 URL */
    avatar?: string;
    /** 是否自动生成模拟事件 */
    auto_events?: boolean;
    /** 事件生成间隔（毫秒） */
    event_interval?: number;
    /** 模拟延迟（毫秒） */
    latency?: number;
    /** 自动事件伪随机种子；相同种子与数据集产生相同选择序列。 */
    random_seed?: number;
    /** 自动事件类型白名单。 */
    auto_event_types?: MockAutoEventType[];
    /** 预定义的好友列表 */
    friends?: MockUser[];
    /** 预定义的群组列表 */
    groups?: MockGroup[];
}

export interface MockUser {
    user_id: string;
    nickname: string;
    avatar?: string;
    remark?: string;
}

export interface MockGroup {
    group_id: string;
    group_name: string;
    member_count?: number;
    max_member_count?: number;
    members?: MockMember[];
}

export interface MockMember {
    user_id: string;
    nickname: string;
    card?: string;
    role: "owner" | "admin" | "member";
    join_time?: number;
    last_sent_time?: number;
}

export interface MockMessage {
    message_id: string;
    user_id: string;
    group_id?: string;
    content: string;
    time: number;
}

export type MockAutoEventType =
    | "private_message"
    | "group_message"
    | "friend_request"
    | "heartbeat";

export interface MockIncomingMessage {
    type: "private" | "group";
    message_id: string;
    user_id: string;
    nickname?: string;
    group_id?: string;
    group_name?: string;
    content: string;
    time: number;
}

export interface MockFriendRequest {
    type: "friend";
    user_id: string;
    nickname?: string;
    comment?: string;
    flag: string;
    time?: number;
}

export interface MockHeartbeat {
    time: number;
}

export interface MockReadyUser {
    user_id: string;
    nickname: string;
    avatar?: string;
}

export interface MockMessageSent {
    message_id: string;
    target_id: string;
    type: "private" | "group";
}

export interface MockInboundEventMap {
    message: MockIncomingMessage;
    request: MockFriendRequest;
    heartbeat: MockHeartbeat;
}

export type MockInboundEvent = {
    [K in keyof MockInboundEventMap]: { type: K; data: MockInboundEventMap[K] };
}[keyof MockInboundEventMap];

export interface MockEvent {
    type: "message" | "notice" | "request" | "meta";
    detail_type: string;
    data: Record<string, unknown>;
}
