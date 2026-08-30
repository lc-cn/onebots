import { EventEmitter } from "node:events";
import type { Adapter } from "./adapter.js";
import type { UnsupportedCapabilityReason } from "./errors.js";

/**
 * 通用 Adapter 的稳定动作接口面。
 *
 * 默认实现统一返回结构化的未支持错误；平台适配器只覆写真实能力。将这些签名与
 * 账号生命周期、ID 管理和能力执行器分离，可让 Adapter 核心保持聚焦且便于审计。
 */
export abstract class AdapterActionDefaults extends EventEmitter {
    abstract unsupported(
        capability: string,
        reason?: UnsupportedCapabilityReason,
        message?: string,
    ): never;

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

    // 用户与账号资料相关方法
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
    setAvatar(_uin: string, _params: Adapter.SetAvatarParams): Promise<void> {
        return this.unsupported("set_avatar");
    }
    setNickname(_uin: string, _params: Adapter.SetNicknameParams): Promise<void> {
        return this.unsupported("set_nickname");
    }
    setBio(_uin: string, _params: Adapter.SetBioParams): Promise<void> {
        return this.unsupported("set_bio");
    }
    getCustomFaceUrlList(_uin: string): Promise<string[]> {
        return this.unsupported("get_custom_face_url_list");
    }
    getPeerPins(_uin: string): Promise<Adapter.PeerPins> {
        return this.unsupported("get_peer_pins");
    }
    setPeerPin(_uin: string, _params: Adapter.SetPeerPinParams): Promise<void> {
        return this.unsupported("set_peer_pin");
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
    muteGroupAnonymous(_uin: string, _params: Adapter.MuteGroupAnonymousParams): Promise<void> {
        return this.unsupported("mute_group_anonymous");
    }
    setGroupAnonymous(_uin: string, _params: Adapter.SetGroupAnonymousParams): Promise<void> {
        return this.unsupported("set_group_anonymous");
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
    ): Promise<Adapter.GroupNotificationsResult> {
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
    ): Promise<Adapter.GroupEssenceMessage[]> {
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
    getGuildMemberList(
        _uin: string,
        _params: Adapter.GetGuildMemberListParams,
    ): Promise<Adapter.GuildMemberInfo[]> {
        return this.unsupported("get_guild_member_list");
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
    persistGroupFile(_uin: string, _params: Adapter.PersistGroupFileParams): Promise<void> {
        return this.unsupported("persist_group_file");
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
}
