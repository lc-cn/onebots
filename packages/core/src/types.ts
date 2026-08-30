// 导入 koa-body 的类型定义，使 Koa Request 获得 body/rawBody 扩展。
import "koa-body";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dict default must remain `any` for backward compatibility; changing it cascades hundreds of errors across all adapters and protocols
export type Dict<T = any, K extends string | symbol = string> = Record<K, T>;
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "mark" | "off";
export type Dispose = () => unknown;
export type MayBeArray<T> = T | T[];
export namespace CommonTypes {
    export type Id = {
        string: string;
        source: string | number;
        number: number;
    };
    export type Scene = "private" | "group" | "channel" | "direct";
    /**
     * User information
     */
    export interface User {
        /** User ID */
        id: Id;
        /** User nickname */
        name?: string;
        /** User avatar URL */
        avatar?: string;
        /** Additional user data */
        [key: string]: unknown;
    }

    /**
     * Group/Channel information
     */
    export interface Group {
        /** Group ID */
        id: Id;
        /** Group name */
        name?: string;
        /** 频道所属服务器/工作区；仅 channel 场景存在。 */
        guild_id?: Id;
        /** 可直接交给适配器寻址的频道 ID；默认与 id 相同。 */
        channel_id?: Id;
        /** Additional group data */
        [key: string]: unknown;
    }

    export type ResourceType =
        | "guild"
        | "channel"
        | "channel_folder"
        | "navigation_view"
        | "attachment"
        | "scheduled_message"
        | "reminder"
        | "saved_snippet"
        | "draft"
        | "topic"
        | "role"
        | "emoji"
        | "user_group";

    /** 通知所描述的频道、附件、定时消息、角色等平台资源。 */
    export interface Resource {
        type: ResourceType;
        id: Id;
        name?: string;
        [key: string]: unknown;
    }

    /**
     * Message segment
     */
    export interface Segment {
        /** Segment type */
        type: string;
        /** Segment data */
        data: Dict;
    }
}
/**
 * Common event structure that all platform adapters should produce
 * This provides a unified interface for different protocols to consume
 */
export namespace CommonEvent {
    export type MessageScene = "private" | "group" | "channel" | "direct";
    /**
     * Base event structure
     */
    export interface Base<TRawEvent = unknown> {
        /** Event ID */
        id: CommonTypes.Id;
        /** Timestamp in milliseconds */
        timestamp: number;
        type: string;
        /** Platform identifier (qq, wechat, dingtalk, etc.) */
        platform: string;
        /** Bot identifier */
        bot_id: CommonTypes.Id;
        /** 平台原始事件。标准投影不完整时仍可无损访问平台字段。 */
        raw_event?: TRawEvent;
        /** 平台扩展字段；命名应使用平台或功能 namespace，避免污染标准字段。 */
        extensions?: Record<string, unknown>;
    }

    /**
     * Message event
     */
    export interface Message<TRawEvent = unknown> extends Base<TRawEvent> {
        type: "message";
        message_type: MessageScene;
        /** Sender information */
        sender: CommonTypes.User;
        /** Group information (for group/channel messages) */
        group?: CommonTypes.Group;
        /** Message content as segments */
        message: CommonTypes.Segment[];
        /** Raw message text */
        raw_message?: string;
        /** Message ID from platform */
        message_id: CommonTypes.Id;
    }

    /**
     * Notice event types
     */
    export type NoticeType =
        | "group_increase"
        | "group_decrease"
        | "group_admin"
        | "group_ban"
        | "friend_add"
        | "friend_remove"
        | "message_status"
        | "message_updated"
        | "message_deleted"
        | "message_flags_updated"
        | "reaction_added"
        | "reaction_removed"
        | "member_joined"
        | "member_left"
        | "user_added"
        | "user_updated"
        | "user_removed"
        | "guild_created"
        | "guild_updated"
        | "guild_deleted"
        | "channel_created"
        | "channel_updated"
        | "channel_deleted"
        | "channel_subscription_added"
        | "channel_subscription_removed"
        | "channel_subscription_updated"
        | "channel_subscriber_added"
        | "channel_subscriber_removed"
        | "default_channels_updated"
        | "channel_folder_created"
        | "channel_folder_updated"
        | "channel_folders_reordered"
        | "navigation_view_created"
        | "navigation_view_updated"
        | "navigation_view_removed"
        | "attachment_created"
        | "attachment_updated"
        | "attachment_removed"
        | "scheduled_message_created"
        | "scheduled_message_updated"
        | "scheduled_message_removed"
        | "reminder_created"
        | "reminder_removed"
        | "saved_snippet_created"
        | "saved_snippet_updated"
        | "saved_snippet_removed"
        | "draft_created"
        | "draft_updated"
        | "draft_removed"
        | "topic_visibility_updated"
        | "typing_started"
        | "typing_stopped"
        | "guild_role_created"
        | "guild_role_updated"
        | "guild_role_deleted"
        | "emoji_created"
        | "emoji_updated"
        | "emoji_deleted"
        | "user_group_created"
        | "user_group_updated"
        | "user_group_deactivated"
        | "user_group_reactivated"
        | "user_group_member_added"
        | "user_group_member_removed"
        | "user_group_subgroup_added"
        | "user_group_subgroup_removed"
        | "interaction"
        | "custom";

    /**
     * Notice event
     */
    export interface Notice<TRawEvent = unknown> extends Base<TRawEvent> {
        type: "notice";
        /** Notice type */
        notice_type: NoticeType;
        /** User involved in the notice */
        user?: CommonTypes.User;
        /** Operator user */
        operator?: CommonTypes.User;
        /** Group involved in the notice */
        group?: CommonTypes.Group;
        /** Message involved in message/reaction notices. */
        message_id?: CommonTypes.Id;
        /** Updated message content when supplied by the platform. */
        message?: CommonTypes.Segment[];
        /** Guild、Channel、Role、Emoji 等生命周期通知关联的资源。 */
        resource?: CommonTypes.Resource;
        /** Additional notice data */
        [key: string]: unknown;
    }

    /**
     * Request event types
     */
    export type RequestType = "friend" | "group";

    /**
     * Request event
     */
    export interface Request<TRawEvent = unknown> extends Base<TRawEvent> {
        type: "request";
        /** Request type */
        request_type: RequestType;
        /** 平台请求子类型，例如入群申请或邀请。 */
        sub_type?: string;
        /** User making the request */
        user: CommonTypes.User;
        /** Group involved in the request */
        group?: CommonTypes.Group;
        /** Request message/comment */
        comment?: string;
        /** Request flag for approval */
        flag: string;
    }

    /**
     * Meta event types
     */
    export type MetaType = "lifecycle" | "heartbeat";

    /**
     * Meta event
     */
    export interface Meta<TRawEvent = unknown> extends Base<TRawEvent> {
        type: "meta";
        /** Meta event type */
        meta_type: MetaType;
        /** Sub type */
        sub_type?: string;
        /** Additional meta data */
        [key: string]: unknown;
    }

    /**
     * Union type of all events
     */
    export type Event<TRawEvent = unknown> =
        | Message<TRawEvent>
        | Notice<TRawEvent>
        | Request<TRawEvent>
        | Meta<TRawEvent>;
}

/**
 * Common action structure for API calls
 * Platform adapters implement these to handle API requests
 */
export namespace CommonAction {
    /**
     * Send message action
     */
    export interface SendMessage {
        /** Message type */
        message_type: "private" | "group" | "channel";
        /** Target ID (user_id, group_id, or channel_id) */
        target_id: CommonTypes.Id;
        /** Message content */
        message: CommonTypes.Segment[];
        /** Source message ID for reply */
        source?: CommonTypes.Id;
    }

    /**
     * Delete message action
     */
    export interface DeleteMessage {
        /** Message ID to delete */
        message_id: CommonTypes.Id;
    }

    /**
     * Get message action
     */
    export interface GetMessage {
        /** Message ID to retrieve */
        message_id: CommonTypes.Id;
    }

    /**
     * Get user info action
     */
    export interface GetUserInfo {
        /** User ID */
        user_id: CommonTypes.Id;
    }

    /**
     * Get group info action
     */
    export interface GetGroupInfo {
        /** Group ID */
        group_id: CommonTypes.Id;
    }

    /**
     * Get group member list action
     */
    export interface GetGroupMemberList {
        /** Group ID */
        group_id: CommonTypes.Id;
    }

    /**
     * Get group member info action
     */
    export interface GetGroupMemberInfo {
        /** Group ID */
        group_id: CommonTypes.Id;
        /** User ID */
        user_id: CommonTypes.Id;
    }
}
