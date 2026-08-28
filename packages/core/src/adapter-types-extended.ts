import type { CommonTypes } from "./types.js";

declare module "./adapter.js" {
    /** 较低频的平台扩展动作与系统信息类型。 */
    namespace Adapter {
        // --- 群公告 (3个方法) ---
        export interface GetGroupAnnouncementsParams {
            group_id: CommonTypes.Id;
        }
        export interface SendGroupAnnouncementParams {
            group_id: CommonTypes.Id;
            content: string;
        }
        export interface DeleteGroupAnnouncementParams {
            group_id: CommonTypes.Id;
            announcement_id: CommonTypes.Id;
        }
        export interface GroupAnnouncement {
            announcement_id: CommonTypes.Id;
            group_id: CommonTypes.Id;
            content: string;
            time: number;
            sender_id?: CommonTypes.Id;
        }

        // --- 群精华消息 (3个方法) ---
        export interface GetGroupEssenceMessagesParams {
            group_id: CommonTypes.Id;
        }
        export interface SetGroupEssenceMessageParams {
            group_id: CommonTypes.Id;
            message_id: CommonTypes.Id;
        }
        export interface DeleteGroupEssenceMessageParams {
            group_id: CommonTypes.Id;
            message_id: CommonTypes.Id;
        }

        // --- 频道 (8个方法) ---
        export interface GetGuildInfoParams {
            guild_id: CommonTypes.Id;
        }
        export interface GetGuildMemberInfoParams {
            guild_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
        }
        export interface GetChannelInfoParams {
            channel_id: CommonTypes.Id;
            guild_id?: CommonTypes.Id;
        }
        export interface GetChannelListParams {
            guild_id: CommonTypes.Id;
        }
        export interface CreateChannelParams {
            guild_id: CommonTypes.Id;
            channel_name: string;
            channel_type?: number;
            parent_id?: CommonTypes.Id;
        }
        export interface UpdateChannelParams {
            channel_id: CommonTypes.Id;
            channel_name?: string;
            parent_id?: CommonTypes.Id;
        }
        export interface DeleteChannelParams {
            channel_id: CommonTypes.Id;
        }
        export interface GuildInfo {
            guild_id: CommonTypes.Id;
            guild_name: string;
            guild_display_name?: string;
        }
        export interface GuildMemberInfo {
            guild_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
            user_name: string;
            nickname?: string;
            role?: string;
        }
        export interface ChannelInfo {
            channel_id: CommonTypes.Id;
            channel_name: string;
            channel_type?: number;
            parent_id?: CommonTypes.Id;
        }

        // --- 频道成员 ---
        export interface GetChannelMemberInfoParams {
            channel_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
        }
        export interface GetChannelMemberListParams {
            channel_id: CommonTypes.Id;
        }
        export interface SetChannelMemberCardParams {
            channel_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
            card: string;
        }
        export interface SetChannelMemberRoleParams {
            channel_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
            role: "owner" | "admin" | "member";
        }
        export interface SetChannelMuteParams {
            channel_id: CommonTypes.Id;
            mute: boolean;
        }
        export interface InviteChannelMemberParams {
            channel_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
        }
        export interface KickChannelMemberParams {
            channel_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
        }
        export interface SetChannelMemberMuteParams {
            channel_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
            mute: boolean;
        }
        export interface ChannelMemberInfo {
            channel_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
            user_name: string;
            role?: "owner" | "admin" | "member";
        }

        // --- 文件 (10个方法) ---
        export interface UploadFileParams {
            scene_type: CommonTypes.Scene;
            scene_id: CommonTypes.Id;
            name: string;
            url?: string;
            path?: string;
            data?: string;
            folder_id?: CommonTypes.Id;
        }
        export interface GetFileParams {
            file_id: CommonTypes.Id;
            type?: string;
        }
        export interface DeleteFileParams {
            file_id: CommonTypes.Id;
            scene_type?: CommonTypes.Scene;
            scene_id?: CommonTypes.Id;
        }
        export interface GetGroupFilesParams {
            group_id: CommonTypes.Id;
            parent_folder_id?: CommonTypes.Id;
        }
        export interface CreateGroupFolderParams {
            group_id: CommonTypes.Id;
            folder_name: string;
            parent_folder_id?: CommonTypes.Id;
        }
        export interface GetFileDownloadUrlParams {
            scene_type: CommonTypes.Scene;
            scene_id: CommonTypes.Id;
            file_id: CommonTypes.Id;
        }
        export interface MoveGroupFileParams {
            group_id: CommonTypes.Id;
            file_id: CommonTypes.Id;
            parent_folder_id: CommonTypes.Id;
        }
        export interface RenameGroupFileParams {
            group_id: CommonTypes.Id;
            file_id: CommonTypes.Id;
            new_name: string;
        }
        export interface RenameGroupFolderParams {
            group_id: CommonTypes.Id;
            folder_id: CommonTypes.Id;
            new_name: string;
        }
        export interface DeleteGroupFolderParams {
            group_id: CommonTypes.Id;
            folder_id: CommonTypes.Id;
        }
        export interface FileInfo {
            file_id: CommonTypes.Id;
            file_name: string;
            file_size?: number;
            url?: string;
        }
        export interface FolderInfo {
            folder_id: CommonTypes.Id;
            folder_name: string;
        }
        export interface GroupFilesResult {
            files: FileInfo[];
            folders: FolderInfo[];
        }

        // --- 媒体 (5个方法) ---
        export interface GetImageParams {
            file: string;
        }
        export interface GetRecordParams {
            file: string;
            out_format?: string;
        }
        export interface GetResourceTempUrlParams {
            resource_id: string;
        }
        export interface ImageInfo {
            file: string;
            url?: string;
            file_size?: number;
            filename?: string;
        }
        export interface RecordInfo {
            file: string;
            url?: string;
            file_size?: number;
            filename?: string;
            out_format?: string;
        }

        // --- 系统 (8个方法) ---
        export interface GetCookiesParams {
            domain?: string;
        }
        export interface GetCredentialsParams {
            domain?: string;
        }
        export interface SetRestartParams {
            delay?: number;
        }
        export interface VersionInfo {
            app_name?: string;
            app_version?: string;
            impl?: string;
            version?: string;
            onebot_version?: string;
            milky_version?: string;
            impl_version?: string;
        }
        export interface BotStatus {
            self: CommonTypes.Id;
            online: boolean;
            [key: string]: unknown;
        }
        export interface StatusInfo {
            online?: boolean;
            good: boolean;
            bots?: BotStatus[];
        }
        export interface CredentialsInfo {
            cookies: string;
            csrf_token: number;
        }
    }
}

export {};
