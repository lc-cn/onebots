import { Dict } from "@zhinjs/shared";

/**
 * Common event structure that all platform adapters should produce
 * This provides a unified interface for different protocols to consume
 */
export namespace CommonEvent {
    export type MessageScene = "private" | "group" | "channel" | "direct";
    /**
     * Base event structure
     */
    export interface Base {
        /** Event ID */
        id: string;
        /** Timestamp in milliseconds */
        timestamp: number;
        /** Platform identifier (qq, wechat, dingtalk, etc.) */
        platform: string;
        /** Bot identifier */
        bot_id: string;
    }

    /**
     * User information
     */
    export interface User {
        /** User ID */
        id: string;
        /** User nickname */
        name?: string;
        /** User avatar URL */
        avatar?: string;
        /** Additional user data */
        [key: string]: any;
    }

    /**
     * Group/Channel information
     */
    export interface Group {
        /** Group ID */
        id: string;
        /** Group name */
        name?: string;
        /** Additional group data */
        [key: string]: any;
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

    /**
     * Message event
     */
    export interface Message extends Base {
        type: "message";
        message_type: MessageScene;
        /** Sender information */
        sender: User;
        /** Group information (for group/channel messages) */
        group?: Group;
        /** Message content as segments */
        message: Segment[];
        /** Raw message text */
        raw_message?: string;
        /** Message ID from platform */
        message_id: string;
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
        | "custom";

    /**
     * Notice event
     */
    export interface Notice extends Base {
        type: "notice";
        /** Notice type */
        notice_type: NoticeType;
        /** User involved in the notice */
        user?: User;
        /** Operator user */
        operator?: User;
        /** Group involved in the notice */
        group?: Group;
        /** Additional notice data */
        [key: string]: any;
    }

    /**
     * Request event types
     */
    export type RequestType = "friend" | "group";

    /**
     * Request event
     */
    export interface Request extends Base {
        type: "request";
        /** Request type */
        request_type: RequestType;
        /** User making the request */
        user: User;
        /** Group involved in the request */
        group?: Group;
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
    export interface Meta extends Base {
        type: "meta";
        /** Meta event type */
        meta_type: MetaType;
        /** Sub type */
        sub_type?: string;
        /** Additional meta data */
        [key: string]: any;
    }

    /**
     * Union type of all events
     */
    export type Event = Message | Notice | Request | Meta;
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
        target_id: string;
        /** Message content */
        message: CommonEvent.Segment[];
        /** Source message ID for reply */
        source?: string;
    }

    /**
     * Delete message action
     */
    export interface DeleteMessage {
        /** Message ID to delete */
        message_id: string;
    }

    /**
     * Get message action
     */
    export interface GetMessage {
        /** Message ID to retrieve */
        message_id: string;
    }

    /**
     * Get user info action
     */
    export interface GetUserInfo {
        /** User ID */
        user_id: string;
    }

    /**
     * Get group info action
     */
    export interface GetGroupInfo {
        /** Group ID */
        group_id: string;
    }

    /**
     * Get group member list action
     */
    export interface GetGroupMemberList {
        /** Group ID */
        group_id: string;
    }

    /**
     * Get group member info action
     */
    export interface GetGroupMemberInfo {
        /** Group ID */
        group_id: string;
        /** User ID */
        user_id: string;
    }
}
