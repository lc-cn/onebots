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
        | "image"
        | "face"
        | "record"
        | "video"
        | "at"
        | "rps"
        | "dice"
        | "shake"
        | "poke"
        | "share"
        | "contact"
        | "location"
        | "music"
        | "reply"
        | "forward"
        | "node"
        | "xml"
        | "json";

    /**
     * Message segment
     */
    export interface Segment {
        type: SegmentType;
        data: Record<string, any>;
    }

    /**
     * User information
     */
    export interface User {
        user_id: string | number;
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
        group_id: string | number;
        group_name?: string;
        member_count?: number;
        max_member_count?: number;
    }

    /**
     * Message event
     */
    export interface MessageEvent {
        time: number;
        self_id: string | number;
        post_type: "message";
        message_type: "private" | "group";
        sub_type?: string;
        message_id: string | number;
        user_id: string | number;
        message: Segment[];
        raw_message: string;
        font: number;
        sender: User;
        group_id?: string | number;
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
        self_id: string | number;
        post_type: "notice";
        notice_type: NoticeType;
        sub_type?: string;
        user_id?: string | number;
        group_id?: string | number;
        operator_id?: string | number;
        duration?: number;
        file?: any;
        message_id?: string | number;
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
        self_id: string | number;
        post_type: "request";
        request_type: RequestType;
        sub_type?: string;
        user_id: string | number;
        comment: string;
        flag: string;
        group_id?: string | number;
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
        self_id: string | number;
        post_type: "meta_event";
        meta_event_type: MetaEventType;
        sub_type?: string;
        interval?: number;
        status?: any;
    }

    /**
     * All event types
     */
    export type Event = MessageEvent | NoticeEvent | RequestEvent | MetaEvent;

    /**
     * API Response
     */
    export interface Response<T = any> {
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
        message_id: string | number;
    }

    /**
     * Message info
     */
    export interface MessageInfo {
        time: number;
        message_type: "private" | "group";
        message_id: string | number;
        real_id: number;
        sender: User;
        message: Segment[];
    }

    /**
     * Forward message node
     */
    export interface ForwardNode {
        type: "node";
        data: {
            name: string;
            uin: string | number;
            content: Segment[];
        };
    }

    /**
     * Group member info
     */
    export interface GroupMemberInfo {
        group_id: string | number;
        user_id: string | number;
        nickname: string;
        card: string;
        sex: "male" | "female" | "unknown";
        age: number;
        area: string;
        join_time: number;
        last_sent_time: number;
        level: string;
        role: "owner" | "admin" | "member";
        unfriendly: boolean;
        title: string;
        title_expire_time: number;
        card_changeable: boolean;
    }

    /**
     * Group info
     */
    export interface GroupInfo {
        group_id: string | number;
        group_name: string;
        member_count: number;
        max_member_count: number;
    }

    /**
     * Friend info
     */
    export interface FriendInfo {
        user_id: string | number;
        nickname: string;
        remark: string;
    }

    /**
     * Login info
     */
    export interface LoginInfo {
        user_id: string | number;
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
