import { Dict } from "@zhinjs/shared";

/**
 * OneBot V11 Type Definitions
 * Based on OneBot 11 Standard: https://github.com/botuniverse/onebot-11
 */
export namespace OneBotV11 {
    // ============ Message Types ============
    
    /**
     * Message segment (CQ code)
     */
    export interface Segment {
        type: string;
        data: Dict;
    }

    /**
     * Text segment
     */
    export interface TextSegment extends Segment {
        type: "text";
        data: {
            text: string;
        };
    }

    /**
     * Face segment
     */
    export interface FaceSegment extends Segment {
        type: "face";
        data: {
            id: string;
        };
    }

    /**
     * Image segment
     */
    export interface ImageSegment extends Segment {
        type: "image";
        data: {
            file: string;
            type?: "flash";
            url?: string;
            cache?: 0 | 1;
            proxy?: 0 | 1;
            timeout?: number;
        };
    }

    /**
     * Record/Voice segment
     */
    export interface RecordSegment extends Segment {
        type: "record";
        data: {
            file: string;
            magic?: 0 | 1;
            url?: string;
            cache?: 0 | 1;
            proxy?: 0 | 1;
            timeout?: number;
        };
    }

    /**
     * Video segment
     */
    export interface VideoSegment extends Segment {
        type: "video";
        data: {
            file: string;
            url?: string;
            cache?: 0 | 1;
            proxy?: 0 | 1;
            timeout?: number;
        };
    }

    /**
     * At segment
     */
    export interface AtSegment extends Segment {
        type: "at";
        data: {
            qq: string | "all";
        };
    }

    /**
     * Reply segment
     */
    export interface ReplySegment extends Segment {
        type: "reply";
        data: {
            id: string;
        };
    }

    /**
     * Forward segment
     */
    export interface ForwardSegment extends Segment {
        type: "forward";
        data: {
            id: string;
        };
    }

    /**
     * Node segment (for custom forward)
     */
    export interface NodeSegment extends Segment {
        type: "node";
        data: {
            id?: string;
            user_id?: number;
            nickname?: string;
            content?: Segment[] | string;
        };
    }

    /**
     * Share segment
     */
    export interface ShareSegment extends Segment {
        type: "share";
        data: {
            url: string;
            title: string;
            content?: string;
            image?: string;
        };
    }

    /**
     * Music segment
     */
    export interface MusicSegment extends Segment {
        type: "music";
        data: {
            type: "qq" | "163" | "xm" | "custom";
            id?: string;
            url?: string;
            audio?: string;
            title?: string;
            content?: string;
            image?: string;
        };
    }

    /**
     * Location segment
     */
    export interface LocationSegment extends Segment {
        type: "location";
        data: {
            lat: number;
            lon: number;
            title?: string;
            content?: string;
        };
    }

    /**
     * Poke segment
     */
    export interface PokeSegment extends Segment {
        type: "poke";
        data: {
            type: string;
            id: string;
        };
    }

    /**
     * Anonymous segment
     */
    export interface AnonymousSegment extends Segment {
        type: "anonymous";
        data: {
            ignore?: 0 | 1;
        };
    }

    /**
     * Shake segment
     */
    export interface ShakeSegment extends Segment {
        type: "shake";
        data: {};
    }

    /**
     * JSON/XML segment
     */
    export interface JsonSegment extends Segment {
        type: "json";
        data: {
            data: string;
        };
    }

    export interface XmlSegment extends Segment {
        type: "xml";
        data: {
            data: string;
        };
    }

    // ============ Event Types ============
    
    /**
     * Base event
     */
    export interface BaseEvent {
        time: number;
        self_id: number;
        post_type: string;
    }

    /**
     * Message event
     */
    export interface MessageEvent extends BaseEvent {
        post_type: "message";
        message_type: "private" | "group";
        sub_type: string;
        message_id: number;
        user_id: number;
        message: Segment[];
        raw_message: string;
        font: number;
        sender: Sender;
    }

    /**
     * Private message event
     */
    export interface PrivateMessageEvent extends MessageEvent {
        message_type: "private";
        sub_type: "friend" | "group" | "other";
    }

    /**
     * Group message event
     */
    export interface GroupMessageEvent extends MessageEvent {
        message_type: "group";
        sub_type: "normal" | "anonymous" | "notice";
        group_id: number;
        anonymous?: Anonymous;
    }

    /**
     * Sender info
     */
    export interface Sender {
        user_id: number;
        nickname: string;
        sex?: "male" | "female" | "unknown";
        age?: number;
        card?: string;
        area?: string;
        level?: string;
        role?: "owner" | "admin" | "member";
        title?: string;
    }

    /**
     * Anonymous info
     */
    export interface Anonymous {
        id: number;
        name: string;
        flag: string;
    }

    /**
     * Notice event
     */
    export interface NoticeEvent extends BaseEvent {
        post_type: "notice";
        notice_type: string;
    }

    /**
     * Group upload notice
     */
    export interface GroupUploadNotice extends NoticeEvent {
        notice_type: "group_upload";
        group_id: number;
        user_id: number;
        file: {
            id: string;
            name: string;
            size: number;
            busid: number;
        };
    }

    /**
     * Group admin notice
     */
    export interface GroupAdminNotice extends NoticeEvent {
        notice_type: "group_admin";
        sub_type: "set" | "unset";
        group_id: number;
        user_id: number;
    }

    /**
     * Group member decrease notice
     */
    export interface GroupDecreaseNotice extends NoticeEvent {
        notice_type: "group_decrease";
        sub_type: "leave" | "kick" | "kick_me";
        group_id: number;
        operator_id: number;
        user_id: number;
    }

    /**
     * Group member increase notice
     */
    export interface GroupIncreaseNotice extends NoticeEvent {
        notice_type: "group_increase";
        sub_type: "approve" | "invite";
        group_id: number;
        operator_id: number;
        user_id: number;
    }

    /**
     * Group ban notice
     */
    export interface GroupBanNotice extends NoticeEvent {
        notice_type: "group_ban";
        sub_type: "ban" | "lift_ban";
        group_id: number;
        operator_id: number;
        user_id: number;
        duration: number;
    }

    /**
     * Friend add notice
     */
    export interface FriendAddNotice extends NoticeEvent {
        notice_type: "friend_add";
        user_id: number;
    }

    /**
     * Group recall notice
     */
    export interface GroupRecallNotice extends NoticeEvent {
        notice_type: "group_recall";
        group_id: number;
        user_id: number;
        operator_id: number;
        message_id: number;
    }

    /**
     * Friend recall notice
     */
    export interface FriendRecallNotice extends NoticeEvent {
        notice_type: "friend_recall";
        user_id: number;
        message_id: number;
    }

    /**
     * Notify event
     */
    export interface NotifyEvent extends NoticeEvent {
        notice_type: "notify";
        sub_type: "poke" | "lucky_king" | "honor";
        group_id?: number;
        user_id: number;
        target_id?: number;
        honor_type?: "talkative" | "performer" | "emotion";
    }

    /**
     * Request event
     */
    export interface RequestEvent extends BaseEvent {
        post_type: "request";
        request_type: string;
    }

    /**
     * Friend request event
     */
    export interface FriendRequestEvent extends RequestEvent {
        request_type: "friend";
        user_id: number;
        comment: string;
        flag: string;
    }

    /**
     * Group request event
     */
    export interface GroupRequestEvent extends RequestEvent {
        request_type: "group";
        sub_type: "add" | "invite";
        group_id: number;
        user_id: number;
        comment: string;
        flag: string;
    }

    /**
     * Meta event
     */
    export interface MetaEvent extends BaseEvent {
        post_type: "meta_event";
        meta_event_type: string;
    }

    /**
     * Lifecycle event
     */
    export interface LifecycleEvent extends MetaEvent {
        meta_event_type: "lifecycle";
        sub_type: "enable" | "disable" | "connect";
    }

    /**
     * Heartbeat event
     */
    export interface HeartbeatEvent extends MetaEvent {
        meta_event_type: "heartbeat";
        status: Status;
        interval: number;
    }

    /**
     * Bot status
     */
    export interface Status {
        online: boolean;
        good: boolean;
    }

    // ============ API Response Types ============
    
    /**
     * Standard API response
     */
    export interface Response<T = any> {
        status: "ok" | "async" | "failed";
        retcode: number;
        data?: T;
        msg?: string;
        wording?: string;
        echo?: any;
    }

    /**
     * Send message response
     */
    export interface SendMessageResponse {
        message_id: number;
    }

    /**
     * Get message response
     */
    export interface GetMessageResponse {
        time: number;
        message_type: "private" | "group";
        message_id: number;
        real_id: number;
        sender: Sender;
        message: Segment[];
    }

    /**
     * Login info
     */
    export interface LoginInfo {
        user_id: number;
        nickname: string;
    }

    /**
     * Stranger info
     */
    export interface StrangerInfo {
        user_id: number;
        nickname: string;
        sex: "male" | "female" | "unknown";
        age: number;
    }

    /**
     * Friend info
     */
    export interface FriendInfo {
        user_id: number;
        nickname: string;
        remark: string;
    }

    /**
     * Group info
     */
    export interface GroupInfo {
        group_id: number;
        group_name: string;
        member_count: number;
        max_member_count: number;
    }

    /**
     * Group member info
     */
    export interface GroupMemberInfo {
        group_id: number;
        user_id: number;
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
     * Version info
     */
    export interface VersionInfo {
        app_name: string;
        app_version: string;
        protocol_version: string;
    }

    /**
     * Can send check
     */
    export interface CanSendResponse {
        yes: boolean;
    }

    /**
     * Forward message
     */
    export interface ForwardMessage {
        messages: ForwardNode[];
    }

    /**
     * Forward node
     */
    export interface ForwardNode {
        type: "node";
        data: {
            name: string;
            uin: string;
            content: Segment[] | ForwardNode[];
        };
    }
}

