/**
 * Milky Protocol Type Declarations
 * Reference: https://milky.ntqqrev.org/
 */

export namespace Milky {
    /**
     * Message segment types
     */
    export type SegmentType =
        | "text"
        | "mention"
        | "mention_all"
        | "image"
        | "face"
        | "record"
        | "video"
        | "file"
        | "reply"
        | "forward"
        | "market_face"
        | "light_app"
        | "xml"
        | "markdown";

    /**
     * Message segment
     */
    export interface Segment {
        type: SegmentType;
        data: Record<string, unknown>;
    }

    /**
     * User information
     */
    export interface User {
        user_id: string;
        nickname?: string;
        sex?: "male" | "female" | "unknown";
        age?: number;
        card?: string;
        area?: string;
        level?: number;
        role?: "owner" | "admin" | "member";
        title?: string;
    }

    /**
     * Group information
     */
    export interface Group {
        group_id: string;
        group_name?: string;
        member_count?: number;
        max_member_count?: number;
    }

    /**
     * Message event
     */
    export interface MessageEvent {
        time: number;
        self_id: number;
        event_type: "message_receive";
        data: {
            message_scene: "friend" | "group" | "temp";
            peer_id: number;
            message_seq: number;
            sender_id: number;
            time: number;
            segments: Segment[];
            friend?: { user_id: number; nickname?: string };
            group?: { group_id: number; group_name?: string };
            group_member?: { user_id: number; nickname?: string; card?: string };
        };
    }

    /**
     * Notice event types
     */
    export type NoticeType =
        | "group_upload"
        | "group_admin"
        | "group_decrease"
        | "group_increase"
        | "group_ban"
        | "friend_add"
        | "group_recall"
        | "friend_recall"
        | "notify";

    /**
     * Notice event
     */
    export interface NoticeEvent {
        time: number;
        self_id: number;
        event_type: string;
        data: Record<string, unknown>;
    }

    /**
     * Request event types
     */
    export type RequestType = "friend" | "group";

    /**
     * Request event
     */
    export interface RequestEvent {
        time: number;
        self_id: number;
        event_type: "friend_request" | "group_join_request" | "group_invited_join_request";
        data: Record<string, unknown>;
    }

    /**
     * Meta event types
     */
    export type MetaEventType = "lifecycle" | "heartbeat";

    /**
     * Meta event
     */
    export interface MetaEvent {
        time: number;
        self_id: number;
        event_type: "bot_offline";
        data: { reason: string };
    }

    /**
     * All event types
     */
    export type Event = MessageEvent | NoticeEvent | RequestEvent | MetaEvent;

    /**
     * API Response
     */
    export interface Response<T = unknown> {
        status: "ok" | "failed";
        retcode: number;
        data?: T;
        message?: string;
        wording?: string;
    }

    /**
     * Send message result
     */
    export interface SendMessageResult {
        message_seq: number;
        time: number;
    }

    /**
     * Message info
     */
    export interface MessageInfoBase {
        time: number;
        peer_id: number;
        message_seq: number;
        sender_id: number;
        segments: Segment[];
    }
    export interface FriendMessageInfo extends MessageInfoBase {
        message_scene: "friend";
        friend: FriendInfo;
    }
    export interface GroupMessageInfo extends MessageInfoBase {
        message_scene: "group";
        group: GroupInfo;
        group_member: GroupMemberInfo;
    }
    export type MessageInfo = FriendMessageInfo | GroupMessageInfo;

    /**
     * Forward message node
     */
    export interface ForwardNode {
        type: "node";
        data: {
            name: string;
            uin: string;
            content: Segment[];
        };
    }

    /**
     * Group member info
     */
    export interface GroupMemberInfo {
        user_id: number;
        nickname: string;
        sex: "male" | "female" | "unknown";
        group_id: number;
        card: string;
        title: string;
        level: number;
        role: "owner" | "admin" | "member";
        join_time: number;
        last_sent_time: number;
        shut_up_end_time?: number;
    }

    /**
     * Group info
     */
    export interface GroupInfo {
        group_id: number;
        group_name: string;
        member_count: number;
        max_member_count: number;
        remark?: string;
        created_time?: number;
        description?: string;
        question?: string;
        announcement?: string;
    }

    /**
     * Friend info
     */
    export interface FriendInfo {
        user_id: number;
        nickname: string;
        sex: "male" | "female" | "unknown";
        qid: string;
        remark: string;
        category: {
            category_id: number;
            category_name: string;
        };
    }

    /**
     * Login info
     */
    export interface LoginInfo {
        uin: number;
        nickname: string;
    }

    /**
     * Version info
     */
    export interface VersionInfo {
        app_name: string;
        app_version: string;
        protocol_version: string;
    }
}
