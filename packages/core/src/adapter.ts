import { EventEmitter } from "events";
import { BaseApp } from "./base-app.js";
import { CommonTypes, CommonEvent } from "./types.js";
import { Account } from "@/account.js";
import { Logger } from "log4js";
import { SqliteDB } from "./db.js";
import { buildTableName, createId, resolveId, coerceId } from "./adapter-id-manager.js";

/**
 * 通用适配器基类
 * 统一定义所有协议需要的 72 个 API 方法
 * 平台适配器继承此类，重写支持的方法，其他方法自动抛出"未实现"异常
 */
export abstract class Adapter<C = any, T extends keyof Adapter.Configs = keyof Adapter.Configs, I extends BaseApp = BaseApp> extends EventEmitter {
    accounts: Map<string, Account<T, C>> = new Map<string, Account<T, C>>();
    #logger: Logger;
    icon: string;

    get db(): SqliteDB { return this.app.db; }

    get tableName() { return buildTableName(String(this.platform)); }

    protected constructor(
        public app: I,
        public platform: T
    ) {
        super();
        this.db.create(this.tableName, {
            string: SqliteDB.Column("TEXT"),
            number: SqliteDB.Column("INTEGER", { unique: true }),
            source: SqliteDB.Column("TEXT")
        });
    }

    // ============================================
    // ID 管理方法
    // ============================================

    createId(id: string | number, _retries: number = 0): CommonTypes.Id {
        return createId(id, this.tableName, this.db, _retries);
    }

    resolveId(id: string | number | CommonTypes.Id): CommonTypes.Id {
        return resolveId(id, this.tableName, this.db);
    }

    protected coerceId(value: CommonTypes.Id | string | number): CommonTypes.Id {
        return coerceId(value, this.tableName, this.db);
    }

    // ============================================
    // 消息相关方法 (Message - 7个)
    // ============================================

    sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> { throw new Error(`${this.platform} adapter: sendMessage not implemented`); }
    deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> { throw new Error(`${this.platform} adapter: deleteMessage not implemented`); }
    getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> { throw new Error(`${this.platform} adapter: getMessage not implemented`); }
    getMessageHistory(uin: string, params: Adapter.GetMessageHistoryParams): Promise<Adapter.MessageInfo[]> { throw new Error(`${this.platform} adapter: getMessageHistory not implemented`); }
    updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> { throw new Error(`${this.platform} adapter: updateMessage not implemented`); }
    getForwardMessage(uin: string, params: Adapter.GetForwardMessageParams): Promise<Adapter.MessageInfo[]> { throw new Error(`${this.platform} adapter: getForwardMessage not implemented`); }
    markMessageAsRead(uin: string, params: Adapter.MarkMessageAsReadParams): Promise<void> { throw new Error(`${this.platform} adapter: markMessageAsRead not implemented`); }

    // ============================================
    // 用户相关方法 (User - 3个)
    // ============================================

    getLoginInfo(uin: string): Promise<Adapter.UserInfo> { throw new Error(`${this.platform} adapter: getLoginInfo not implemented`); }
    getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> { throw new Error(`${this.platform} adapter: getUserInfo not implemented`); }
    createUserChannel(uin: string, params: Adapter.CreateUserChannelParams): Promise<Adapter.ChannelInfo> { throw new Error(`${this.platform} adapter: createUserChannel not implemented`); }

    // ============================================
    // 好友相关方法 (Friend - 7个)
    // ============================================

    getFriendList(uin: string, params?: Adapter.GetFriendListParams): Promise<Adapter.FriendInfo[]> { throw new Error(`${this.platform} adapter: getFriendList not implemented`); }
    getFriendInfo(uin: string, params: Adapter.GetFriendInfoParams): Promise<Adapter.FriendInfo> { throw new Error(`${this.platform} adapter: getFriendInfo not implemented`); }
    deleteFriend(uin: string, params: Adapter.DeleteFriendParams): Promise<void> { throw new Error(`${this.platform} adapter: deleteFriend not implemented`); }
    sendFriendNudge(uin: string, params: Adapter.SendFriendNudgeParams): Promise<void> { throw new Error(`${this.platform} adapter: sendFriendNudge not implemented`); }
    sendLike(uin: string, params: Adapter.SendLikeParams): Promise<void> { throw new Error(`${this.platform} adapter: sendLike not implemented`); }
    getFriendRequests(uin: string, params?: Adapter.GetFriendRequestsParams): Promise<Adapter.FriendRequest[]> { throw new Error(`${this.platform} adapter: getFriendRequests not implemented`); }
    handleFriendRequest(uin: string, params: Adapter.HandleFriendRequestParams): Promise<void> { throw new Error(`${this.platform} adapter: handleFriendRequest not implemented`); }

    // ============================================
    // 群组相关方法 (Group - 18个)
    // ============================================

    getGroupList(uin: string, params?: Adapter.GetGroupListParams): Promise<Adapter.GroupInfo[]> { throw new Error(`${this.platform} adapter: getGroupList not implemented`); }
    getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> { throw new Error(`${this.platform} adapter: getGroupInfo not implemented`); }
    setGroupName(uin: string, params: Adapter.SetGroupNameParams): Promise<void> { throw new Error(`${this.platform} adapter: setGroupName not implemented`); }
    leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> { throw new Error(`${this.platform} adapter: leaveGroup not implemented`); }
    getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> { throw new Error(`${this.platform} adapter: getGroupMemberList not implemented`); }
    getGroupMemberInfo(uin: string, params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> { throw new Error(`${this.platform} adapter: getGroupMemberInfo not implemented`); }
    kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> { throw new Error(`${this.platform} adapter: kickGroupMember not implemented`); }
    muteGroupMember(uin: string, params: Adapter.MuteGroupMemberParams): Promise<void> { throw new Error(`${this.platform} adapter: muteGroupMember not implemented`); }
    muteGroupAll(uin: string, params: Adapter.MuteGroupAllParams): Promise<void> { throw new Error(`${this.platform} adapter: muteGroupAll not implemented`); }
    setGroupAdmin(uin: string, params: Adapter.SetGroupAdminParams): Promise<void> { throw new Error(`${this.platform} adapter: setGroupAdmin not implemented`); }
    setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> { throw new Error(`${this.platform} adapter: setGroupCard not implemented`); }
    setGroupSpecialTitle(uin: string, params: Adapter.SetGroupSpecialTitleParams): Promise<void> { throw new Error(`${this.platform} adapter: setGroupSpecialTitle not implemented`); }
    getGroupHonorInfo(uin: string, params: Adapter.GetGroupHonorInfoParams): Promise<Adapter.GroupHonorInfo> { throw new Error(`${this.platform} adapter: getGroupHonorInfo not implemented`); }
    sendGroupNudge(uin: string, params: Adapter.SendGroupNudgeParams): Promise<void> { throw new Error(`${this.platform} adapter: sendGroupNudge not implemented`); }
    handleGroupRequest(uin: string, params: Adapter.HandleGroupRequestParams): Promise<void> { throw new Error(`${this.platform} adapter: handleGroupRequest not implemented`); }
    getGroupNotifications(uin: string, params?: Adapter.GetGroupNotificationsParams): Promise<Adapter.GroupNotification[]> { throw new Error(`${this.platform} adapter: getGroupNotifications not implemented`); }
    setGroupAvatar(uin: string, params: Adapter.SetGroupAvatarParams): Promise<void> { throw new Error(`${this.platform} adapter: setGroupAvatar not implemented`); }
    sendGroupMessageReaction(uin: string, params: Adapter.SendGroupMessageReactionParams): Promise<void> { throw new Error(`${this.platform} adapter: sendGroupMessageReaction not implemented`); }

    // ============================================
    // 群公告相关方法 (Announcement - 3个)
    // ============================================

    getGroupAnnouncements(uin: string, params: Adapter.GetGroupAnnouncementsParams): Promise<Adapter.GroupAnnouncement[]> { throw new Error(`${this.platform} adapter: getGroupAnnouncements not implemented`); }
    sendGroupAnnouncement(uin: string, params: Adapter.SendGroupAnnouncementParams): Promise<void> { throw new Error(`${this.platform} adapter: sendGroupAnnouncement not implemented`); }
    deleteGroupAnnouncement(uin: string, params: Adapter.DeleteGroupAnnouncementParams): Promise<void> { throw new Error(`${this.platform} adapter: deleteGroupAnnouncement not implemented`); }

    // ============================================
    // 群精华消息相关方法 (Essence - 3个)
    // ============================================

    getGroupEssenceMessages(uin: string, params: Adapter.GetGroupEssenceMessagesParams): Promise<Adapter.MessageInfo[]> { throw new Error(`${this.platform} adapter: getGroupEssenceMessages not implemented`); }
    setGroupEssenceMessage(uin: string, params: Adapter.SetGroupEssenceMessageParams): Promise<void> { throw new Error(`${this.platform} adapter: setGroupEssenceMessage not implemented`); }
    deleteGroupEssenceMessage(uin: string, params: Adapter.DeleteGroupEssenceMessageParams): Promise<void> { throw new Error(`${this.platform} adapter: deleteGroupEssenceMessage not implemented`); }

    // ============================================
    // 频道相关方法 (Channel/Guild - 8个)
    // ============================================

    getGuildInfo(uin: string, params: Adapter.GetGuildInfoParams): Promise<Adapter.GuildInfo> { throw new Error(`${this.platform} adapter: getGuildInfo not implemented`); }
    getGuildList(uin: string): Promise<Adapter.GuildInfo[]> { throw new Error(`${this.platform} adapter: getGuildList not implemented`); }
    getGuildMemberInfo(uin: string, params: Adapter.GetGuildMemberInfoParams): Promise<Adapter.GuildMemberInfo> { throw new Error(`${this.platform} adapter: getGuildMemberInfo not implemented`); }
    getChannelInfo(uin: string, params: Adapter.GetChannelInfoParams): Promise<Adapter.ChannelInfo> { throw new Error(`${this.platform} adapter: getChannelInfo not implemented`); }
    getChannelList(uin: string, params?: Adapter.GetChannelListParams): Promise<Adapter.ChannelInfo[]> { throw new Error(`${this.platform} adapter: getChannelList not implemented`); }
    createChannel(uin: string, params: Adapter.CreateChannelParams): Promise<Adapter.ChannelInfo> { throw new Error(`${this.platform} adapter: createChannel not implemented`); }
    updateChannel(uin: string, params: Adapter.UpdateChannelParams): Promise<void> { throw new Error(`${this.platform} adapter: updateChannel not implemented`); }
    deleteChannel(uin: string, params: Adapter.DeleteChannelParams): Promise<void> { throw new Error(`${this.platform} adapter: deleteChannel not implemented`); }

    // ============================================
    // 频道成员相关方法 (Channel Member - 8个)
    // ============================================

    getChannelMemberInfo(uin: string, params: Adapter.GetChannelMemberInfoParams): Promise<Adapter.ChannelMemberInfo> { throw new Error(`${this.platform} adapter: getChannelMemberInfo not implemented`); }
    getChannelMemberList(uin: string, params: Adapter.GetChannelMemberListParams): Promise<Adapter.ChannelMemberInfo[]> { throw new Error(`${this.platform} adapter: getChannelMemberList not implemented`); }
    setChannelMemberCard(uin: string, params: Adapter.SetChannelMemberCardParams): Promise<void> { throw new Error(`${this.platform} adapter: setChannelMemberCard not implemented`); }
    setChannelMemberRole(uin: string, params: Adapter.SetChannelMemberRoleParams): Promise<void> { throw new Error(`${this.platform} adapter: setChannelMemberRole not implemented`); }
    setChannelMute(uin: string, params: Adapter.SetChannelMuteParams): Promise<void> { throw new Error(`${this.platform} adapter: setChannelMute not implemented`); }
    inviteChannelMember(uin: string, params: Adapter.InviteChannelMemberParams): Promise<void> { throw new Error(`${this.platform} adapter: inviteChannelMember not implemented`); }
    kickChannelMember(uin: string, params: Adapter.KickChannelMemberParams): Promise<void> { throw new Error(`${this.platform} adapter: kickChannelMember not implemented`); }
    setChannelMemberMute(uin: string, params: Adapter.SetChannelMemberMuteParams): Promise<void> { throw new Error(`${this.platform} adapter: setChannelMemberMute not implemented`); }

    // ============================================
    // 文件相关方法 (File - 10个)
    // ============================================

    uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> { throw new Error(`${this.platform} adapter: uploadFile not implemented`); }
    getFile(uin: string, params: Adapter.GetFileParams): Promise<Adapter.FileInfo> { throw new Error(`${this.platform} adapter: getFile not implemented`); }
    deleteFile(uin: string, params: Adapter.DeleteFileParams): Promise<void> { throw new Error(`${this.platform} adapter: deleteFile not implemented`); }
    getGroupFiles(uin: string, params: Adapter.GetGroupFilesParams): Promise<Adapter.GroupFilesResult> { throw new Error(`${this.platform} adapter: getGroupFiles not implemented`); }
    createGroupFolder(uin: string, params: Adapter.CreateGroupFolderParams): Promise<Adapter.FolderInfo> { throw new Error(`${this.platform} adapter: createGroupFolder not implemented`); }
    getFileDownloadUrl(uin: string, params: Adapter.GetFileDownloadUrlParams): Promise<string> { throw new Error(`${this.platform} adapter: getFileDownloadUrl not implemented`); }
    moveGroupFile(uin: string, params: Adapter.MoveGroupFileParams): Promise<void> { throw new Error(`${this.platform} adapter: moveGroupFile not implemented`); }
    renameGroupFile(uin: string, params: Adapter.RenameGroupFileParams): Promise<void> { throw new Error(`${this.platform} adapter: renameGroupFile not implemented`); }
    renameGroupFolder(uin: string, params: Adapter.RenameGroupFolderParams): Promise<void> { throw new Error(`${this.platform} adapter: renameGroupFolder not implemented`); }
    deleteGroupFolder(uin: string, params: Adapter.DeleteGroupFolderParams): Promise<void> { throw new Error(`${this.platform} adapter: deleteGroupFolder not implemented`); }

    // ============================================
    // 媒体资源相关方法 (Media - 5个)
    // ============================================

    getImage(uin: string, params: Adapter.GetImageParams): Promise<Adapter.ImageInfo> { throw new Error(`${this.platform} adapter: getImage not implemented`); }
    getRecord(uin: string, params: Adapter.GetRecordParams): Promise<Adapter.RecordInfo> { throw new Error(`${this.platform} adapter: getRecord not implemented`); }
    getResourceTempUrl(uin: string, params: Adapter.GetResourceTempUrlParams): Promise<string> { throw new Error(`${this.platform} adapter: getResourceTempUrl not implemented`); }
    canSendImage(uin: string): Promise<boolean> { throw new Error(`${this.platform} adapter: canSendImage not implemented`); }
    canSendRecord(uin: string): Promise<boolean> { throw new Error(`${this.platform} adapter: canSendRecord not implemented`); }

    // ============================================
    // 系统相关方法 (Meta/System - 8个)
    // ============================================

    getVersion(uin: string): Promise<Adapter.VersionInfo> { throw new Error(`${this.platform} adapter: getVersion not implemented`); }
    getStatus(uin: string): Promise<Adapter.StatusInfo> { throw new Error(`${this.platform} adapter: getStatus not implemented`); }
    getSupportedActions(uin: string): Promise<string[]> { throw new Error(`${this.platform} adapter: getSupportedActions not implemented`); }
    getCookies(uin: string, params?: Adapter.GetCookiesParams): Promise<string> { throw new Error(`${this.platform} adapter: getCookies not implemented`); }
    getCsrfToken(uin: string): Promise<number> { throw new Error(`${this.platform} adapter: getCsrfToken not implemented`); }
    getCredentials(uin: string, params?: Adapter.GetCredentialsParams): Promise<Adapter.CredentialsInfo> { throw new Error(`${this.platform} adapter: getCredentials not implemented`); }
    setRestart(uin: string, params?: Adapter.SetRestartParams): Promise<void> { throw new Error(`${this.platform} adapter: setRestart not implemented`); }
    cleanCache(uin: string): Promise<void> { throw new Error(`${this.platform} adapter: cleanCache not implemented`); }

    // ============================================
    // 具体方法
    // ============================================

    getAccount(uin: string) { return this.accounts.get(uin); }

    get logger() {
        return (this.#logger ||= this.app.getLogger(this.platform as string));
    }

    get info() {
        return {
            platform: this.platform,
            icon: this.icon,
            accounts: [...this.accounts.values()].map(account => account.info),
        };
    }

    async setOnline(uin: string) { }
    async setOffline(uin: string) { }

    submitVerification?(accountId: string, type: string, data: Record<string, unknown>): void | Promise<void>;
    requestSmsCode?(accountId: string): void | Promise<void>;

    abstract createAccount(config: Account.Config<T>): Account<T, C>;

    async start(account_id?: string): Promise<any> {
        this.logger.info(`Starting adapter for platform ${this.platform}`);
        const startAccounts = [...this.accounts.values()].filter(account => {
            return account_id ? account.account_id === account_id : true;
        });
        for (const account of startAccounts) {
            await account.start();
        }
    }

    async stop(account_id?: string): Promise<any> {
        const stopAccounts = [...this.accounts.values()].filter(account => {
            return account_id ? account.account_id === account_id : true;
        });
        for (const account of stopAccounts) {
            await account.stop();
        }
    }
}

export type AdapterClient<T extends Adapter = Adapter> = T extends Adapter<infer C, infer _> ? C : never;

// ============================================
// Adapter 命名空间 — API 参数 / 返回值类型
// ============================================
export namespace Adapter {
    export interface Configs extends Record<string, any> { }

    export type VerificationBlock =
        | { type: 'image'; base64: string; alt?: string }
        | { type: 'image_url'; url: string; alt?: string }
        | { type: 'link'; url: string; label?: string }
        | { type: 'text'; content: string }
        | { type: 'input'; key: string; placeholder?: string; maxLength?: number; secret?: boolean };

    export interface VerificationRequestOptions { blocks?: VerificationBlock[]; }

    export interface VerificationRequest {
        platform: string; account_id: string; type: string; hint: string;
        options?: VerificationRequestOptions; requestSmsAvailable?: boolean;
        data?: Record<string, unknown>; request_id?: string;
    }

    // --- 消息 (7个方法) ---
    export interface SendMessageParams { scene_type: CommonTypes.Scene; scene_id: CommonTypes.Id; message: CommonTypes.Segment[]; }
    export interface SendMessageResult { message_id: CommonTypes.Id; }
    export interface DeleteMessageParams { message_id: CommonTypes.Id; scene_type?: CommonTypes.Scene; scene_id?: CommonTypes.Id; }
    export interface GetMessageParams { message_id: CommonTypes.Id; scene_type?: CommonTypes.Scene; scene_id?: CommonTypes.Id; }
    export interface GetMessageHistoryParams { scene_type: CommonTypes.Scene; scene_id: CommonTypes.Id; limit?: number; offset?: number; }
    export interface UpdateMessageParams { message_id: CommonTypes.Id; message: CommonTypes.Segment[]; }
    export interface GetForwardMessageParams { message_id?: CommonTypes.Id; resource_id?: string; }
    export interface MarkMessageAsReadParams { scene_type: CommonTypes.Scene; scene_id: CommonTypes.Id; message_id?: CommonTypes.Id; }
    export interface MessageSender { scene_type: CommonTypes.Scene; sender_id: CommonTypes.Id; scene_id: CommonTypes.Id; sender_name: string; scene_name: string; }
    export interface MessageInfo { message_id: CommonTypes.Id; time: number; sender: MessageSender; message: CommonTypes.Segment[]; }

    // --- 用户 (3个方法) ---
    export interface GetUserInfoParams { user_id: CommonTypes.Id; no_cache?: boolean; }
    export interface CreateUserChannelParams { user_id: CommonTypes.Id; guild_id?: CommonTypes.Id; }
    export interface UserInfo { user_id: CommonTypes.Id; user_name: string; user_displayname?: string; avatar?: string; }

    // --- 好友 (7个方法) ---
    export interface GetFriendListParams { no_cache?: boolean; }
    export interface GetFriendInfoParams { user_id: CommonTypes.Id; no_cache?: boolean; }
    export interface DeleteFriendParams { user_id: CommonTypes.Id; }
    export interface SendFriendNudgeParams { user_id: CommonTypes.Id; is_self?: boolean; }
    export interface SendLikeParams { user_id: CommonTypes.Id; times?: number; count?: number; }
    export interface GetFriendRequestsParams { limit?: number; is_filtered?: boolean; }
    export interface HandleFriendRequestParams { request_id?: CommonTypes.Id; flag?: string; approve: boolean; remark?: string; }
    export interface FriendInfo { user_id: CommonTypes.Id; user_name: string; remark?: string; }
    export interface FriendRequest { request_id: CommonTypes.Id; user_id: CommonTypes.Id; user_name: string; message?: string; time: number; }

    // --- 群组 (18个方法) ---
    export interface GetGroupListParams { no_cache?: boolean; }
    export interface GetGroupInfoParams { group_id: CommonTypes.Id; no_cache?: boolean; }
    export interface SetGroupNameParams { group_id: CommonTypes.Id; group_name: string; }
    export interface LeaveGroupParams { group_id: CommonTypes.Id; is_dismiss?: boolean; }
    export interface GetGroupMemberListParams { group_id: CommonTypes.Id; no_cache?: boolean; }
    export interface GetGroupMemberInfoParams { group_id: CommonTypes.Id; user_id: CommonTypes.Id; no_cache?: boolean; }
    export interface KickGroupMemberParams { group_id: CommonTypes.Id; user_id: CommonTypes.Id; reject_add_request?: boolean; }
    export interface MuteGroupMemberParams { group_id: CommonTypes.Id; user_id: CommonTypes.Id; duration: number; }
    export interface MuteGroupAllParams { group_id: CommonTypes.Id; enable: boolean; }
    export interface SetGroupAdminParams { group_id: CommonTypes.Id; user_id: CommonTypes.Id; enable: boolean; }
    export interface SetGroupCardParams { group_id: CommonTypes.Id; user_id: CommonTypes.Id; card: string; }
    export interface SetGroupSpecialTitleParams { group_id: CommonTypes.Id; user_id: CommonTypes.Id; special_title: string; duration?: number; }
    export interface GetGroupHonorInfoParams { group_id: CommonTypes.Id; type: "talkative" | "performer" | "legend" | "strong_newbie" | "emotion" | "all"; }
    export interface SendGroupNudgeParams { group_id: CommonTypes.Id; user_id: CommonTypes.Id; }
    export interface HandleGroupRequestParams { request_id?: CommonTypes.Id; flag?: string; sub_type?: "add" | "invite"; type: "request" | "invitation"; approve: boolean; reason?: string; }
    export interface GetGroupNotificationsParams { is_filtered?: boolean; limit?: number; }
    export interface SetGroupAvatarParams { group_id: CommonTypes.Id; file: string; }
    export interface SendGroupMessageReactionParams { group_id: CommonTypes.Id; message_id: CommonTypes.Id; face_id: number; }
    export interface GroupInfo { group_id: CommonTypes.Id; group_name: string; member_count?: number; max_member_count?: number; }
    export interface GroupMemberInfo { group_id: CommonTypes.Id; user_id: CommonTypes.Id; user_name: string; card?: string; role?: "owner" | "admin" | "member"; }
    export interface HonorMember { user_id: CommonTypes.Id; user_name: string; avatar?: string; description?: string; }
    export interface GroupHonorInfo { group_id: CommonTypes.Id; current_talkative?: HonorMember; talkative_list?: HonorMember[]; performer_list?: HonorMember[]; legend_list?: HonorMember[]; strong_newbie_list?: HonorMember[]; emotion_list?: HonorMember[]; }
    export interface GroupNotification { notification_id: CommonTypes.Id; group_id: CommonTypes.Id; user_id: CommonTypes.Id; type: string; time: number; }

    // --- 群公告 (3个方法) ---
    export interface GetGroupAnnouncementsParams { group_id: CommonTypes.Id; }
    export interface SendGroupAnnouncementParams { group_id: CommonTypes.Id; content: string; }
    export interface DeleteGroupAnnouncementParams { group_id: CommonTypes.Id; announcement_id: CommonTypes.Id; }
    export interface GroupAnnouncement { announcement_id: CommonTypes.Id; group_id: CommonTypes.Id; content: string; time: number; sender_id?: CommonTypes.Id; }

    // --- 群精华消息 (3个方法) ---
    export interface GetGroupEssenceMessagesParams { group_id: CommonTypes.Id; }
    export interface SetGroupEssenceMessageParams { group_id: CommonTypes.Id; message_id: CommonTypes.Id; }
    export interface DeleteGroupEssenceMessageParams { group_id: CommonTypes.Id; message_id: CommonTypes.Id; }

    // --- 频道 (8个方法) ---
    export interface GetGuildInfoParams { guild_id: CommonTypes.Id; }
    export interface GetGuildMemberInfoParams { guild_id: CommonTypes.Id; user_id: CommonTypes.Id; }
    export interface GetChannelInfoParams { channel_id: CommonTypes.Id; guild_id?: CommonTypes.Id; }
    export interface GetChannelListParams { guild_id: CommonTypes.Id; }
    export interface CreateChannelParams { guild_id: CommonTypes.Id; channel_name: string; channel_type?: number; parent_id?: CommonTypes.Id; }
    export interface UpdateChannelParams { channel_id: CommonTypes.Id; channel_name?: string; parent_id?: CommonTypes.Id; }
    export interface DeleteChannelParams { channel_id: CommonTypes.Id; }
    export interface GuildInfo { guild_id: CommonTypes.Id; guild_name: string; guild_display_name?: string; }
    export interface GuildMemberInfo { guild_id: CommonTypes.Id; user_id: CommonTypes.Id; user_name: string; nickname?: string; role?: string; }
    export interface ChannelInfo { channel_id: CommonTypes.Id; channel_name: string; channel_type?: number; parent_id?: CommonTypes.Id; }

    // --- 频道成员 ---
    export interface GetChannelMemberInfoParams { channel_id: CommonTypes.Id; user_id: CommonTypes.Id; }
    export interface GetChannelMemberListParams { channel_id: CommonTypes.Id; }
    export interface SetChannelMemberCardParams { channel_id: CommonTypes.Id; user_id: CommonTypes.Id; card: string; }
    export interface SetChannelMemberRoleParams { channel_id: CommonTypes.Id; user_id: CommonTypes.Id; role: "owner" | "admin" | "member"; }
    export interface SetChannelMuteParams { channel_id: CommonTypes.Id; mute: boolean; }
    export interface InviteChannelMemberParams { channel_id: CommonTypes.Id; user_id: CommonTypes.Id; }
    export interface KickChannelMemberParams { channel_id: CommonTypes.Id; user_id: CommonTypes.Id; }
    export interface SetChannelMemberMuteParams { channel_id: CommonTypes.Id; user_id: CommonTypes.Id; mute: boolean; }
    export interface ChannelMemberInfo { channel_id: CommonTypes.Id; user_id: CommonTypes.Id; user_name: string; role?: "owner" | "admin" | "member"; }

    // --- 文件 (10个方法) ---
    export interface UploadFileParams { scene_type: CommonTypes.Scene; scene_id: CommonTypes.Id; name: string; url?: string; path?: string; data?: string; folder_id?: CommonTypes.Id; }
    export interface GetFileParams { file_id: CommonTypes.Id; type?: string; }
    export interface DeleteFileParams { file_id: CommonTypes.Id; scene_type?: CommonTypes.Scene; scene_id?: CommonTypes.Id; }
    export interface GetGroupFilesParams { group_id: CommonTypes.Id; parent_folder_id?: CommonTypes.Id; }
    export interface CreateGroupFolderParams { group_id: CommonTypes.Id; folder_name: string; parent_folder_id?: CommonTypes.Id; }
    export interface GetFileDownloadUrlParams { scene_type: CommonTypes.Scene; scene_id: CommonTypes.Id; file_id: CommonTypes.Id; }
    export interface MoveGroupFileParams { group_id: CommonTypes.Id; file_id: CommonTypes.Id; parent_folder_id: CommonTypes.Id; }
    export interface RenameGroupFileParams { group_id: CommonTypes.Id; file_id: CommonTypes.Id; new_name: string; }
    export interface RenameGroupFolderParams { group_id: CommonTypes.Id; folder_id: CommonTypes.Id; new_name: string; }
    export interface DeleteGroupFolderParams { group_id: CommonTypes.Id; folder_id: CommonTypes.Id; }
    export interface FileInfo { file_id: CommonTypes.Id; file_name: string; file_size?: number; url?: string; }
    export interface FolderInfo { folder_id: CommonTypes.Id; folder_name: string; }
    export interface GroupFilesResult { files: FileInfo[]; folders: FolderInfo[]; }

    // --- 媒体 (5个方法) ---
    export interface GetImageParams { file: string; }
    export interface GetRecordParams { file: string; out_format?: string; }
    export interface GetResourceTempUrlParams { resource_id: string; }
    export interface ImageInfo { file: string; url?: string; file_size?: number; filename?: string; }
    export interface RecordInfo { file: string; url?: string; file_size?: number; filename?: string; out_format?: string; }

    // --- 系统 (8个方法) ---
    export interface GetCookiesParams { domain?: string; }
    export interface GetCredentialsParams { domain?: string; }
    export interface SetRestartParams { delay?: number; }
    export interface VersionInfo { app_name?: string; app_version?: string; impl?: string; version?: string; onebot_version?: string; milky_version?: string; impl_version?: string; }
    export interface BotStatus { self: CommonTypes.Id; online: boolean; [key: string]: unknown; }
    export interface StatusInfo { online?: boolean; good: boolean; bots?: BotStatus[]; }
    export interface CredentialsInfo { cookies: string; csrf_token: number; }

    // --- 工厂/注册类型 ---
    export type Construct<T> = { new(...args: any[]): T; };
    export type Creator<T> = (...args: any[]) => T;
    export type Factory<T extends Adapter = Adapter> = Construct<T> | Creator<T>;
    export function isClassAdapter<T extends Adapter = Adapter>(obj: any): obj is Construct<T> {
        return typeof obj === 'function' && /^class\s/.test(Function.prototype.toString.call(obj));
    }

    export interface Metadata { name: string; displayName: string; description: string; icon?: string; homepage?: string; author?: string; }
}
