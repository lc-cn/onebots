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
    role: 'owner' | 'admin' | 'member';
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

export interface MockEvent {
    type: 'message' | 'notice' | 'request' | 'meta';
    detail_type: string;
    data: Record<string, unknown>;
}

