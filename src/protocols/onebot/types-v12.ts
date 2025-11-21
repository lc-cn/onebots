import { Dict } from "@zhinjs/shared";

/**
 * OneBot V12 Type Definitions
 * Based on OneBot 12 Standard: https://12.onebot.dev
 */
export namespace OneBotV12 {
    // ============ Basic Types ============
    
    /**
     * Bot self information
     */
    export interface BotSelf {
        platform: string;
        user_id: string;
    }

    /**
     * Response status
     */
    export type ResponseStatus = "ok" | "failed";

    /**
     * Retry policy
     */
    export interface Retcode {
        retcode: number;
    }

    // ============ Message Types ============
    
    /**
     * Message segment
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
     * Mention (@) segment
     */
    export interface MentionSegment extends Segment {
        type: "mention";
        data: {
            user_id: string;
        };
    }

    /**
     * Mention all segment
     */
    export interface MentionAllSegment extends Segment {
        type: "mention_all";
        data: {};
    }

    /**
     * Image segment
     */
    export interface ImageSegment extends Segment {
        type: "image";
        data: {
            file_id: string;
        };
    }

    /**
     * Voice segment
     */
    export interface VoiceSegment extends Segment {
        type: "voice";
        data: {
            file_id: string;
        };
    }

    /**
     * Audio segment
     */
    export interface AudioSegment extends Segment {
        type: "audio";
        data: {
            file_id: string;
        };
    }

    /**
     * Video segment
     */
    export interface VideoSegment extends Segment {
        type: "video";
        data: {
            file_id: string;
        };
    }

    /**
     * File segment
     */
    export interface FileSegment extends Segment {
        type: "file";
        data: {
            file_id: string;
        };
    }

    /**
     * Location segment
     */
    export interface LocationSegment extends Segment {
        type: "location";
        data: {
            latitude: number;
            longitude: number;
            title: string;
            content: string;
        };
    }

    /**
     * Reply segment
     */
    export interface ReplySegment extends Segment {
        type: "reply";
        data: {
            message_id: string;
            user_id?: string;
        };
    }

    // ============ Event Types ============
    
    /**
     * Base event
     */
    export interface BaseEvent {
        id: string;
        time: number;
        type: string;
        detail_type: string;
        sub_type: string;
        self: BotSelf;
    }

    /**
     * Message event
     */
    export interface MessageEvent extends BaseEvent {
        type: "message";
        detail_type: "private" | "group" | "channel";
        message_id: string;
        message: Segment[];
        alt_message?: string;
        user_id: string;
    }

    /**
     * Private message event
     */
    export interface PrivateMessageEvent extends MessageEvent {
        detail_type: "private";
    }

    /**
     * Group message event
     */
    export interface GroupMessageEvent extends MessageEvent {
        detail_type: "group";
        group_id: string;
    }

    /**
     * Channel message event
     */
    export interface ChannelMessageEvent extends MessageEvent {
        detail_type: "channel";
        guild_id: string;
        channel_id: string;
    }

    /**
     * Notice event
     */
    export interface NoticeEvent extends BaseEvent {
        type: "notice";
    }

    /**
     * Group member increase notice
     */
    export interface GroupMemberIncreaseNotice extends NoticeEvent {
        detail_type: "group_member_increase";
        sub_type: "join" | "invite";
        group_id: string;
        user_id: string;
        operator_id: string;
    }

    /**
     * Group member decrease notice
     */
    export interface GroupMemberDecreaseNotice extends NoticeEvent {
        detail_type: "group_member_decrease";
        sub_type: "leave" | "kick";
        group_id: string;
        user_id: string;
        operator_id: string;
    }

    /**
     * Group message delete notice
     */
    export interface GroupMessageDeleteNotice extends NoticeEvent {
        detail_type: "group_message_delete";
        sub_type: "";
        group_id: string;
        message_id: string;
        user_id: string;
        operator_id: string;
    }

    /**
     * Private message delete notice
     */
    export interface PrivateMessageDeleteNotice extends NoticeEvent {
        detail_type: "private_message_delete";
        sub_type: "";
        message_id: string;
        user_id: string;
    }

    /**
     * Friend increase notice
     */
    export interface FriendIncreaseNotice extends NoticeEvent {
        detail_type: "friend_increase";
        sub_type: "";
        user_id: string;
    }

    /**
     * Friend decrease notice
     */
    export interface FriendDecreaseNotice extends NoticeEvent {
        detail_type: "friend_decrease";
        sub_type: "";
        user_id: string;
    }

    /**
     * Request event
     */
    export interface RequestEvent extends BaseEvent {
        type: "request";
    }

    /**
     * Meta event
     */
    export interface MetaEvent extends BaseEvent {
        type: "meta";
    }

    /**
     * Connect meta event
     */
    export interface ConnectMetaEvent extends MetaEvent {
        detail_type: "connect";
        sub_type: "";
        version: VersionInfo;
    }

    /**
     * Heartbeat meta event
     */
    export interface HeartbeatMetaEvent extends MetaEvent {
        detail_type: "heartbeat";
        sub_type: "";
        interval: number;
    }

    /**
     * Status update meta event
     */
    export interface StatusUpdateMetaEvent extends MetaEvent {
        detail_type: "status_update";
        sub_type: "";
        status: Status;
    }

    // ============ API Request/Response Types ============
    
    /**
     * Standard API response
     */
    export interface Response<T = any> {
        status: ResponseStatus;
        retcode: number;
        data: T;
        message: string;
    }

    /**
     * Send message response
     */
    export interface SendMessageResponse {
        message_id: string;
        time: number;
    }

    /**
     * Get message response
     */
    export interface Message {
        message_id: string;
        message: Segment[];
        alt_message?: string;
    }

    /**
     * User info
     */
    export interface UserInfo {
        user_id: string;
        user_name: string;
        user_displayname?: string;
        user_remark?: string;
    }

    /**
     * Group info
     */
    export interface GroupInfo {
        group_id: string;
        group_name: string;
    }

    /**
     * Guild info
     */
    export interface GuildInfo {
        guild_id: string;
        guild_name: string;
    }

    /**
     * Channel info
     */
    export interface ChannelInfo {
        channel_id: string;
        channel_name: string;
    }

    /**
     * Group member info
     */
    export interface GroupMemberInfo {
        user_id: string;
        user_name: string;
        user_displayname?: string;
    }

    /**
     * Guild member info
     */
    export interface GuildMemberInfo {
        user_id: string;
        user_name: string;
        user_displayname?: string;
    }

    /**
     * Channel member info
     */
    export interface ChannelMemberInfo {
        user_id: string;
        user_name: string;
        user_displayname?: string;
    }

    /**
     * Bot status
     */
    export interface Status {
        good: boolean;
        bots: BotStatus[];
    }

    /**
     * Individual bot status
     */
    export interface BotStatus {
        self: BotSelf;
        online: boolean;
    }

    /**
     * Version info
     */
    export interface VersionInfo {
        impl: string;
        version: string;
        onebot_version: string;
    }

    /**
     * File info
     */
    export interface FileInfo {
        file_id: string;
        file_name: string;
        file_size?: number;
        sha256?: string;
        url?: string;
    }

    // ============ Action Parameters ============
    
    /**
     * Send message params
     */
    export interface SendMessageParams {
        detail_type: "private" | "group" | "channel";
        user_id?: string;
        group_id?: string;
        guild_id?: string;
        channel_id?: string;
        message: Segment[];
    }

    /**
     * Delete message params
     */
    export interface DeleteMessageParams {
        message_id: string;
    }

    /**
     * Get self info params
     */
    export interface GetSelfInfoParams {}

    /**
     * Get user info params
     */
    export interface GetUserInfoParams {
        user_id: string;
    }

    /**
     * Get group info params
     */
    export interface GetGroupInfoParams {
        group_id: string;
    }

    /**
     * Get group list params
     */
    export interface GetGroupListParams {}

    /**
     * Get group member info params
     */
    export interface GetGroupMemberInfoParams {
        group_id: string;
        user_id: string;
    }

    /**
     * Get group member list params
     */
    export interface GetGroupMemberListParams {
        group_id: string;
    }

    /**
     * Set group name params
     */
    export interface SetGroupNameParams {
        group_id: string;
        group_name: string;
    }

    /**
     * Leave group params
     */
    export interface LeaveGroupParams {
        group_id: string;
    }

    /**
     * Get guild info params
     */
    export interface GetGuildInfoParams {
        guild_id: string;
    }

    /**
     * Get guild list params
     */
    export interface GetGuildListParams {}

    /**
     * Set guild name params
     */
    export interface SetGuildNameParams {
        guild_id: string;
        guild_name: string;
    }

    /**
     * Get guild member info params
     */
    export interface GetGuildMemberInfoParams {
        guild_id: string;
        user_id: string;
    }

    /**
     * Get guild member list params
     */
    export interface GetGuildMemberListParams {
        guild_id: string;
    }

    /**
     * Leave guild params
     */
    export interface LeaveGuildParams {
        guild_id: string;
    }

    /**
     * Get channel info params
     */
    export interface GetChannelInfoParams {
        guild_id: string;
        channel_id: string;
    }

    /**
     * Get channel list params
     */
    export interface GetChannelListParams {
        guild_id: string;
    }

    /**
     * Set channel name params
     */
    export interface SetChannelNameParams {
        guild_id: string;
        channel_id: string;
        channel_name: string;
    }

    /**
     * Get channel member info params
     */
    export interface GetChannelMemberInfoParams {
        guild_id: string;
        channel_id: string;
        user_id: string;
    }

    /**
     * Get channel member list params
     */
    export interface GetChannelMemberListParams {
        guild_id: string;
        channel_id: string;
    }

    /**
     * Leave channel params
     */
    export interface LeaveChannelParams {
        guild_id: string;
        channel_id: string;
    }

    /**
     * Upload file params
     */
    export interface UploadFileParams {
        type: "url" | "path" | "data";
        name: string;
        url?: string;
        headers?: Dict;
        path?: string;
        data?: string | Uint8Array;
        sha256?: string;
    }

    /**
     * Upload file fragmented prepare params
     */
    export interface UploadFileFragmentedPrepareParams {
        name: string;
        total_size: number;
        sha256?: string;
    }

    /**
     * Upload file fragmented transfer params
     */
    export interface UploadFileFragmentedTransferParams {
        file_id: string;
        offset: number;
        data: string | Uint8Array;
    }

    /**
     * Upload file fragmented finish params
     */
    export interface UploadFileFragmentedFinishParams {
        file_id: string;
        sha256?: string;
    }

    /**
     * Get file params
     */
    export interface GetFileParams {
        file_id: string;
        type: "url" | "path" | "data";
    }

    /**
     * Get file fragmented prepare params
     */
    export interface GetFileFragmentedPrepareParams {
        file_id: string;
    }

    /**
     * Get file fragmented transfer params
     */
    export interface GetFileFragmentedTransferParams {
        file_id: string;
        offset: number;
        size: number;
    }
}

