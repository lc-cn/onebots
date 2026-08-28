import { EventEmitter } from "events";
import { BaseApp } from "./base-app.js";
import { CommonTypes } from "./types.js";
import { Account } from "./account.js";
import { Logger } from "log4js";
import { SqliteDB } from "./db.js";
import { buildTableName, createId, resolveId, coerceId } from "./adapter-id-manager.js";
import {
    EMPTY_ADAPTER_CAPABILITIES,
    listSupportedActions,
    type AdapterCapabilityManifest,
} from "./adapter-capability.js";
import { UnsupportedCapabilityError, type UnsupportedCapabilityReason } from "./errors.js";
import "./adapter-types.js";
import "./adapter-types-extended.js";

/** 通用适配器基类：提供稳定动作接口，以能力清单明确平台差异。 */
export abstract class Adapter<
    C = unknown,
    T extends keyof Adapter.Configs = keyof Adapter.Configs,
    I extends BaseApp = BaseApp,
> extends EventEmitter {
    accounts: Map<string, Account<T, C>> = new Map<string, Account<T, C>>();
    #logger: Logger;
    icon: string;

    get db(): SqliteDB {
        return this.app.db;
    }

    get tableName() {
        return buildTableName(String(this.platform));
    }

    protected constructor(
        public app: I,
        public platform: T,
        private readonly capabilityManifest: AdapterCapabilityManifest = EMPTY_ADAPTER_CAPABILITIES,
    ) {
        super();
        this.db.create(this.tableName, {
            string: SqliteDB.Column("TEXT"),
            number: SqliteDB.Column("INTEGER", { unique: true }),
            source: SqliteDB.Column("TEXT"),
        });
    }

    // ID 管理方法
    createId(id: string | number, _retries: number = 0): CommonTypes.Id {
        return createId(id, this.tableName, this.db, _retries);
    }

    resolveId(id: string | number | CommonTypes.Id): CommonTypes.Id {
        return resolveId(id, this.tableName, this.db);
    }

    coerceId(value: CommonTypes.Id | string | number): CommonTypes.Id {
        return coerceId(value, this.tableName, this.db);
    }

    /** 返回当前适配器对外声明的能力；账号级动态能力可由子类覆写。 */
    describeCapabilities(_uin?: string): AdapterCapabilityManifest {
        return this.capabilityManifest;
    }

    unsupported(
        capability: string,
        reason: UnsupportedCapabilityReason = "not_implemented",
        message?: string,
    ): never {
        throw new UnsupportedCapabilityError({
            platform: String(this.platform),
            capability,
            reason,
            message,
        });
    }

    // 消息相关方法 (Message - 7个)
    sendMessage(
        _uin: string,
        _params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        return this.unsupported("send_message");
    }
    deleteMessage(_uin: string, _params: Adapter.DeleteMessageParams): Promise<void> {
        return this.unsupported("delete_message");
    }
    getMessage(_uin: string, _params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        return this.unsupported("get_message");
    }
    getMessageHistory(
        _uin: string,
        _params: Adapter.GetMessageHistoryParams,
    ): Promise<Adapter.MessageInfo[]> {
        return this.unsupported("get_message_history");
    }
    updateMessage(_uin: string, _params: Adapter.UpdateMessageParams): Promise<void> {
        return this.unsupported("update_message");
    }
    getForwardMessage(
        _uin: string,
        _params: Adapter.GetForwardMessageParams,
    ): Promise<Adapter.MessageInfo[]> {
        return this.unsupported("get_forward_message");
    }
    markMessageAsRead(_uin: string, _params: Adapter.MarkMessageAsReadParams): Promise<void> {
        return this.unsupported("mark_message_as_read");
    }

    // 用户相关方法 (User - 3个)
    getLoginInfo(_uin: string): Promise<Adapter.UserInfo> {
        return this.unsupported("get_login_info");
    }
    getUserInfo(_uin: string, _params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        return this.unsupported("get_user_info");
    }
    createUserChannel(
        _uin: string,
        _params: Adapter.CreateUserChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        return this.unsupported("create_user_channel");
    }

    // 好友相关方法 (Friend - 7个)
    getFriendList(
        _uin: string,
        _params?: Adapter.GetFriendListParams,
    ): Promise<Adapter.FriendInfo[]> {
        return this.unsupported("get_friend_list");
    }
    getFriendInfo(_uin: string, _params: Adapter.GetFriendInfoParams): Promise<Adapter.FriendInfo> {
        return this.unsupported("get_friend_info");
    }
    deleteFriend(_uin: string, _params: Adapter.DeleteFriendParams): Promise<void> {
        return this.unsupported("delete_friend");
    }
    sendFriendNudge(_uin: string, _params: Adapter.SendFriendNudgeParams): Promise<void> {
        return this.unsupported("send_friend_nudge");
    }
    sendLike(_uin: string, _params: Adapter.SendLikeParams): Promise<void> {
        return this.unsupported("send_like");
    }
    getFriendRequests(
        _uin: string,
        _params?: Adapter.GetFriendRequestsParams,
    ): Promise<Adapter.FriendRequest[]> {
        return this.unsupported("get_friend_requests");
    }
    handleFriendRequest(_uin: string, _params: Adapter.HandleFriendRequestParams): Promise<void> {
        return this.unsupported("handle_friend_request");
    }

    // 群组相关方法 (Group - 18个)
    getGroupList(_uin: string, _params?: Adapter.GetGroupListParams): Promise<Adapter.GroupInfo[]> {
        return this.unsupported("get_group_list");
    }
    getGroupInfo(_uin: string, _params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        return this.unsupported("get_group_info");
    }
    setGroupName(_uin: string, _params: Adapter.SetGroupNameParams): Promise<void> {
        return this.unsupported("set_group_name");
    }
    leaveGroup(_uin: string, _params: Adapter.LeaveGroupParams): Promise<void> {
        return this.unsupported("leave_group");
    }
    getGroupMemberList(
        _uin: string,
        _params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        return this.unsupported("get_group_member_list");
    }
    getGroupMemberInfo(
        _uin: string,
        _params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        return this.unsupported("get_group_member_info");
    }
    kickGroupMember(_uin: string, _params: Adapter.KickGroupMemberParams): Promise<void> {
        return this.unsupported("kick_group_member");
    }
    inviteGroupMember(_uin: string, _params: Adapter.InviteGroupMemberParams): Promise<void> {
        return this.unsupported("invite_group_member");
    }
    muteGroupMember(_uin: string, _params: Adapter.MuteGroupMemberParams): Promise<void> {
        return this.unsupported("mute_group_member");
    }
    muteGroupAll(_uin: string, _params: Adapter.MuteGroupAllParams): Promise<void> {
        return this.unsupported("mute_group_all");
    }
    setGroupAdmin(_uin: string, _params: Adapter.SetGroupAdminParams): Promise<void> {
        return this.unsupported("set_group_admin");
    }
    setGroupCard(_uin: string, _params: Adapter.SetGroupCardParams): Promise<void> {
        return this.unsupported("set_group_card");
    }
    setGroupSpecialTitle(_uin: string, _params: Adapter.SetGroupSpecialTitleParams): Promise<void> {
        return this.unsupported("set_group_special_title");
    }
    getGroupHonorInfo(
        _uin: string,
        _params: Adapter.GetGroupHonorInfoParams,
    ): Promise<Adapter.GroupHonorInfo> {
        return this.unsupported("get_group_honor_info");
    }
    sendGroupNudge(_uin: string, _params: Adapter.SendGroupNudgeParams): Promise<void> {
        return this.unsupported("send_group_nudge");
    }
    handleGroupRequest(_uin: string, _params: Adapter.HandleGroupRequestParams): Promise<void> {
        return this.unsupported("handle_group_request");
    }
    getGroupNotifications(
        _uin: string,
        _params?: Adapter.GetGroupNotificationsParams,
    ): Promise<Adapter.GroupNotification[]> {
        return this.unsupported("get_group_notifications");
    }
    setGroupAvatar(_uin: string, _params: Adapter.SetGroupAvatarParams): Promise<void> {
        return this.unsupported("set_group_avatar");
    }
    sendGroupMessageReaction(
        _uin: string,
        _params: Adapter.SendGroupMessageReactionParams,
    ): Promise<void> {
        return this.unsupported("send_group_message_reaction");
    }

    // 群公告相关方法 (Announcement - 3个)
    getGroupAnnouncements(
        _uin: string,
        _params: Adapter.GetGroupAnnouncementsParams,
    ): Promise<Adapter.GroupAnnouncement[]> {
        return this.unsupported("get_group_announcements");
    }
    sendGroupAnnouncement(
        _uin: string,
        _params: Adapter.SendGroupAnnouncementParams,
    ): Promise<void> {
        return this.unsupported("send_group_announcement");
    }
    deleteGroupAnnouncement(
        _uin: string,
        _params: Adapter.DeleteGroupAnnouncementParams,
    ): Promise<void> {
        return this.unsupported("delete_group_announcement");
    }

    // 群精华消息相关方法 (Essence - 3个)
    getGroupEssenceMessages(
        _uin: string,
        _params: Adapter.GetGroupEssenceMessagesParams,
    ): Promise<Adapter.MessageInfo[]> {
        return this.unsupported("get_group_essence_messages");
    }
    setGroupEssenceMessage(
        _uin: string,
        _params: Adapter.SetGroupEssenceMessageParams,
    ): Promise<void> {
        return this.unsupported("set_group_essence_message");
    }
    deleteGroupEssenceMessage(
        _uin: string,
        _params: Adapter.DeleteGroupEssenceMessageParams,
    ): Promise<void> {
        return this.unsupported("delete_group_essence_message");
    }

    // 频道相关方法 (Channel/Guild - 8个)
    getGuildInfo(_uin: string, _params: Adapter.GetGuildInfoParams): Promise<Adapter.GuildInfo> {
        return this.unsupported("get_guild_info");
    }
    getGuildList(_uin: string): Promise<Adapter.GuildInfo[]> {
        return this.unsupported("get_guild_list");
    }
    getGuildMemberInfo(
        _uin: string,
        _params: Adapter.GetGuildMemberInfoParams,
    ): Promise<Adapter.GuildMemberInfo> {
        return this.unsupported("get_guild_member_info");
    }
    getChannelInfo(
        _uin: string,
        _params: Adapter.GetChannelInfoParams,
    ): Promise<Adapter.ChannelInfo> {
        return this.unsupported("get_channel_info");
    }
    getChannelList(
        _uin: string,
        _params?: Adapter.GetChannelListParams,
    ): Promise<Adapter.ChannelInfo[]> {
        return this.unsupported("get_channel_list");
    }
    createChannel(
        _uin: string,
        _params: Adapter.CreateChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        return this.unsupported("create_channel");
    }
    updateChannel(_uin: string, _params: Adapter.UpdateChannelParams): Promise<void> {
        return this.unsupported("update_channel");
    }
    deleteChannel(_uin: string, _params: Adapter.DeleteChannelParams): Promise<void> {
        return this.unsupported("delete_channel");
    }

    // 频道成员相关方法 (Channel Member - 8个)
    getChannelMemberInfo(
        _uin: string,
        _params: Adapter.GetChannelMemberInfoParams,
    ): Promise<Adapter.ChannelMemberInfo> {
        return this.unsupported("get_channel_member_info");
    }
    getChannelMemberList(
        _uin: string,
        _params: Adapter.GetChannelMemberListParams,
    ): Promise<Adapter.ChannelMemberInfo[]> {
        return this.unsupported("get_channel_member_list");
    }
    setChannelMemberCard(_uin: string, _params: Adapter.SetChannelMemberCardParams): Promise<void> {
        return this.unsupported("set_channel_member_card");
    }
    setChannelMemberRole(_uin: string, _params: Adapter.SetChannelMemberRoleParams): Promise<void> {
        return this.unsupported("set_channel_member_role");
    }
    setChannelMute(_uin: string, _params: Adapter.SetChannelMuteParams): Promise<void> {
        return this.unsupported("set_channel_mute");
    }
    inviteChannelMember(_uin: string, _params: Adapter.InviteChannelMemberParams): Promise<void> {
        return this.unsupported("invite_channel_member");
    }
    kickChannelMember(_uin: string, _params: Adapter.KickChannelMemberParams): Promise<void> {
        return this.unsupported("kick_channel_member");
    }
    setChannelMemberMute(_uin: string, _params: Adapter.SetChannelMemberMuteParams): Promise<void> {
        return this.unsupported("set_channel_member_mute");
    }

    // 文件相关方法 (File - 10个)
    uploadFile(_uin: string, _params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        return this.unsupported("upload_file");
    }
    getFile(_uin: string, _params: Adapter.GetFileParams): Promise<Adapter.FileInfo> {
        return this.unsupported("get_file");
    }
    deleteFile(_uin: string, _params: Adapter.DeleteFileParams): Promise<void> {
        return this.unsupported("delete_file");
    }
    getGroupFiles(
        _uin: string,
        _params: Adapter.GetGroupFilesParams,
    ): Promise<Adapter.GroupFilesResult> {
        return this.unsupported("get_group_files");
    }
    createGroupFolder(
        _uin: string,
        _params: Adapter.CreateGroupFolderParams,
    ): Promise<Adapter.FolderInfo> {
        return this.unsupported("create_group_folder");
    }
    getFileDownloadUrl(_uin: string, _params: Adapter.GetFileDownloadUrlParams): Promise<string> {
        return this.unsupported("get_file_download_url");
    }
    moveGroupFile(_uin: string, _params: Adapter.MoveGroupFileParams): Promise<void> {
        return this.unsupported("move_group_file");
    }
    renameGroupFile(_uin: string, _params: Adapter.RenameGroupFileParams): Promise<void> {
        return this.unsupported("rename_group_file");
    }
    renameGroupFolder(_uin: string, _params: Adapter.RenameGroupFolderParams): Promise<void> {
        return this.unsupported("rename_group_folder");
    }
    deleteGroupFolder(_uin: string, _params: Adapter.DeleteGroupFolderParams): Promise<void> {
        return this.unsupported("delete_group_folder");
    }

    // 媒体资源相关方法 (Media - 5个)
    getImage(_uin: string, _params: Adapter.GetImageParams): Promise<Adapter.ImageInfo> {
        return this.unsupported("get_image");
    }
    getRecord(_uin: string, _params: Adapter.GetRecordParams): Promise<Adapter.RecordInfo> {
        return this.unsupported("get_record");
    }
    getResourceTempUrl(_uin: string, _params: Adapter.GetResourceTempUrlParams): Promise<string> {
        return this.unsupported("get_resource_temp_url");
    }
    canSendImage(_uin: string): Promise<boolean> {
        return this.unsupported("can_send_image");
    }
    canSendRecord(_uin: string): Promise<boolean> {
        return this.unsupported("can_send_record");
    }

    // 系统相关方法 (Meta/System - 8个)
    getVersion(_uin: string): Promise<Adapter.VersionInfo> {
        return this.unsupported("get_version");
    }
    getStatus(_uin: string): Promise<Adapter.StatusInfo> {
        return this.unsupported("get_status");
    }
    async getSupportedActions(uin: string): Promise<string[]> {
        const manifest = this.describeCapabilities(uin);
        if (manifest === EMPTY_ADAPTER_CAPABILITIES) {
            return this.unsupported(
                "get_supported_actions",
                "not_implemented",
                `${this.platform} 适配器尚未声明能力清单`,
            );
        }
        return listSupportedActions(manifest);
    }
    getCookies(_uin: string, _params?: Adapter.GetCookiesParams): Promise<string> {
        return this.unsupported("get_cookies");
    }
    getCsrfToken(_uin: string): Promise<number> {
        return this.unsupported("get_csrf_token");
    }
    getCredentials(
        _uin: string,
        _params?: Adapter.GetCredentialsParams,
    ): Promise<Adapter.CredentialsInfo> {
        return this.unsupported("get_credentials");
    }
    setRestart(_uin: string, _params?: Adapter.SetRestartParams): Promise<void> {
        return this.unsupported("set_restart");
    }
    cleanCache(_uin: string): Promise<void> {
        return this.unsupported("clean_cache");
    }

    getAccount(uin: string) {
        return this.accounts.get(uin);
    }

    get logger() {
        return (this.#logger ||= this.app.getLogger(this.platform as string));
    }

    get info() {
        return {
            platform: this.platform,
            icon: this.icon,
            capabilities: this.describeCapabilities(),
            accounts: [...this.accounts.values()].map(account => account.info),
        };
    }

    async setOnline(_uin: string) {}
    async setOffline(_uin: string) {}

    submitVerification?(
        accountId: string,
        type: string,
        data: Record<string, unknown>,
    ): void | Promise<void>;
    requestSmsCode?(accountId: string): void | Promise<void>;

    abstract createAccount(config: Account.Config<T>): Account<T, C>;

    async start(account_id?: string): Promise<void> {
        this.logger.info(`Starting adapter for platform ${this.platform}`);
        const startAccounts = [...this.accounts.values()].filter(account => {
            return account_id ? account.account_id === account_id : true;
        });
        for (const account of startAccounts) {
            await account.start();
        }
        this.logger.info(`Adapter for platform ${this.platform} started`);
    }

    async stop(account_id?: string): Promise<void> {
        const stopAccounts = [...this.accounts.values()].filter(account => {
            return account_id ? account.account_id === account_id : true;
        });
        for (const account of stopAccounts) {
            await account.stop();
        }
    }
}

export type AdapterClient<T extends Adapter = Adapter> =
    T extends Adapter<infer C, keyof Adapter.Configs, BaseApp> ? C : never;

export namespace Adapter {
    export type Construct<T> = { new (...args: unknown[]): T };
    export type Creator<T> = (...args: unknown[]) => T;
    export type Factory<T extends Adapter = Adapter> = Construct<T> | Creator<T>;
    export function isClassAdapter<T extends Adapter = Adapter>(obj: unknown): obj is Construct<T> {
        return typeof obj === "function" && /^class\s/.test(Function.prototype.toString.call(obj));
    }

    export interface Metadata {
        name: string;
        displayName: string;
        description: string;
        icon?: string;
        homepage?: string;
        author?: string;
        capabilities?: AdapterCapabilityManifest;
    }
}
