import { EventEmitter } from "events";
import { BaseApp } from "./base-app.js";
import { CommonTypes,CommonEvent } from "./types.js";
import { Account } from "@/account.js";
import { Logger } from "log4js";
import { SqliteDB } from "./db.js";

/**
 * 通用适配器基类
 * 统一定义所有协议需要的 72 个 API 方法
 * 平台适配器继承此类，重写支持的方法，其他方法自动抛出"未实现"异常
 * 
 * 架构设计：
 * 1. 协议层 (Protocol): 定义协议规范，调用 Adapter 方法
 * 2. 适配器基类 (Adapter): 定义统一的通用 API
 * 3. 平台适配器 (Platform Adapter): 实现平台特定的 API，转换为通用格式
 */
export abstract class Adapter<C = any, T extends keyof Adapter.Configs = keyof Adapter.Configs,I extends BaseApp = BaseApp> extends EventEmitter {
    accounts: Map<string, Account<T, C>> = new Map<string, Account<T, C>>();
    #logger: Logger;
    icon: string;

    get db(): SqliteDB {
        return this.app.db;
    }

    get tableName() {
        return `id_map_${this.platform}`;
    }

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

    createId(id: string | number): CommonTypes.Id {
        if (typeof id === "number") return { string: id.toString(), number: id, source: id };
        const [existData] = this.db.select('*').from(this.tableName).where({
            string: id
        }).run()
        if (existData) return existData as CommonTypes.Id;
        const randomNum = Math.floor(Math.random() * 100000000000);
        const [checkExist] = this.db.select('*').from(this.tableName).where({
            number: randomNum
        }).run();

        if (checkExist) return this.createId(id);
        const newId: CommonTypes.Id = {
            string: id,
            number: randomNum,
            source: id
        }
        this.db.insert(this.tableName).values(newId).run();
        return newId;
    }

    resolveId(id: string | number): CommonTypes.Id {
        const [dbRecord] = this.db.select('*').from(this.tableName).where({
            [typeof id === "number" ? "number" : "string"]: id
        }).run();
        if (dbRecord) return dbRecord as CommonTypes.Id;
        return this.createId(id);
    }

    // ============================================
    // 消息相关方法 (Message - 7个)
    // ============================================

    /**
     * 1. 发送消息
     * OneBot V11: send_private_msg, send_group_msg, send_msg
     * OneBot V12: send_message
     * Milky V1: send_private_message, send_group_message
     * Satori: message.create
     */
    sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
        throw new Error(`${this.platform} adapter: sendMessage not implemented`);
    }

    /**
     * 2. 删除/撤回消息
     * OneBot V11: delete_msg
     * OneBot V12: delete_message
     * Milky V1: recall_private_message, recall_group_message
     * Satori: message.delete
     */
    deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        throw new Error(`${this.platform} adapter: deleteMessage not implemented`);
    }

    /**
     * 3. 获取消息
     * OneBot V11: get_msg
     * OneBot V12: get_message
     * Milky V1: get_message
     * Satori: message.get
     */
    getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        throw new Error(`${this.platform} adapter: getMessage not implemented`);
    }

    /**
     * 4. 获取历史消息列表
     * Milky V1: get_history_messages
     * Satori: message.list
     */
    getMessageHistory(uin: string, params: Adapter.GetMessageHistoryParams): Promise<Adapter.MessageInfo[]> {
        throw new Error(`${this.platform} adapter: getMessageHistory not implemented`);
    }

    /**
     * 5. 编辑消息
     * Satori: message.update
     */
    updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        throw new Error(`${this.platform} adapter: updateMessage not implemented`);
    }

    /**
     * 6. 获取合并转发消息
     * OneBot V11: get_forward_msg
     * Milky V1: get_forwarded_messages
     */
    getForwardMessage(uin: string, params: Adapter.GetForwardMessageParams): Promise<Adapter.MessageInfo[]> {
        throw new Error(`${this.platform} adapter: getForwardMessage not implemented`);
    }

    /**
     * 7. 标记消息已读
     * Milky V1: mark_message_as_read
     */
    markMessageAsRead(uin: string, params: Adapter.MarkMessageAsReadParams): Promise<void> {
        throw new Error(`${this.platform} adapter: markMessageAsRead not implemented`);
    }

    // ============================================
    // 用户相关方法 (User - 3个)
    // ============================================

    /**
     * 8. 获取机器人自身信息
     * OneBot V11: get_login_info
     * OneBot V12: get_self_info
     * Milky V1: get_login_info
     * Satori: login.get
     */
    getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        throw new Error(`${this.platform} adapter: getLoginInfo not implemented`);
    }

    /**
     * 9. 获取用户信息
     * OneBot V11: get_stranger_info
     * OneBot V12: get_user_info
     * Milky V1: get_user_profile
     * Satori: user.get
     */
    getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        throw new Error(`${this.platform} adapter: getUserInfo not implemented`);
    }

    /**
     * 10. 创建私聊频道
     * Satori: user.channel.create
     */
    createUserChannel(uin: string, params: Adapter.CreateUserChannelParams): Promise<Adapter.ChannelInfo> {
        throw new Error(`${this.platform} adapter: createUserChannel not implemented`);
    }

    // ============================================
    // 好友相关方法 (Friend - 7个)
    // ============================================

    /**
     * 11. 获取好友列表
     * OneBot V11: get_friend_list
     * OneBot V12: get_friend_list
     * Milky V1: get_friend_list
     * Satori: friend.list
     */
    getFriendList(uin: string, params?: Adapter.GetFriendListParams): Promise<Adapter.FriendInfo[]> {
        throw new Error(`${this.platform} adapter: getFriendList not implemented`);
    }

    /**
     * 12. 获取好友信息
     * Milky V1: get_friend_info
     */
    getFriendInfo(uin: string, params: Adapter.GetFriendInfoParams): Promise<Adapter.FriendInfo> {
        throw new Error(`${this.platform} adapter: getFriendInfo not implemented`);
    }

    /**
     * 13. 删除好友
     * Satori: friend.delete
     */
    deleteFriend(uin: string, params: Adapter.DeleteFriendParams): Promise<void> {
        throw new Error(`${this.platform} adapter: deleteFriend not implemented`);
    }

    /**
     * 14. 发送好友戳一戳
     * Milky V1: send_friend_nudge
     */
    sendFriendNudge(uin: string, params: Adapter.SendFriendNudgeParams): Promise<void> {
        throw new Error(`${this.platform} adapter: sendFriendNudge not implemented`);
    }

    /**
     * 15. 发送好友赞/点赞
     * OneBot V11: send_like
     * Milky V1: send_profile_like
     */
    sendLike(uin: string, params: Adapter.SendLikeParams): Promise<void> {
        throw new Error(`${this.platform} adapter: sendLike not implemented`);
    }

    /**
     * 16. 获取好友请求列表
     * Milky V1: get_friend_requests
     */
    getFriendRequests(uin: string, params?: Adapter.GetFriendRequestsParams): Promise<Adapter.FriendRequest[]> {
        throw new Error(`${this.platform} adapter: getFriendRequests not implemented`);
    }

    /**
     * 17. 处理好友请求
     * OneBot V11: set_friend_add_request
     * Milky V1: accept_friend_request, reject_friend_request
     */
    handleFriendRequest(uin: string, params: Adapter.HandleFriendRequestParams): Promise<void> {
        throw new Error(`${this.platform} adapter: handleFriendRequest not implemented`);
    }

    // ============================================
    // 群组相关方法 (Group - 18个)
    // ============================================

    /**
     * 18. 获取群列表
     * OneBot V11: get_group_list
     * OneBot V12: get_group_list
     * Milky V1: get_group_list
     * Satori: guild.list
     */
    getGroupList(uin: string, params?: Adapter.GetGroupListParams): Promise<Adapter.GroupInfo[]> {
        throw new Error(`${this.platform} adapter: getGroupList not implemented`);
    }

    /**
     * 19. 获取群信息
     * OneBot V11: get_group_info
     * OneBot V12: get_group_info
     * Milky V1: get_group_info
     * Satori: guild.get
     */
    getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        throw new Error(`${this.platform} adapter: getGroupInfo not implemented`);
    }

    /**
     * 20. 设置群名称
     * OneBot V11: set_group_name
     * OneBot V12: set_group_name
     * Milky V1: set_group_name
     */
    setGroupName(uin: string, params: Adapter.SetGroupNameParams): Promise<void> {
        throw new Error(`${this.platform} adapter: setGroupName not implemented`);
    }

    /**
     * 21. 退出群组
     * OneBot V11: set_group_leave
     * OneBot V12: leave_group
     * Milky V1: quit_group
     */
    leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        throw new Error(`${this.platform} adapter: leaveGroup not implemented`);
    }

    /**
     * 22. 获取群成员列表
     * OneBot V11: get_group_member_list
     * OneBot V12: get_group_member_list
     * Milky V1: get_group_member_list
     * Satori: guild.member.list
     */
    getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        throw new Error(`${this.platform} adapter: getGroupMemberList not implemented`);
    }

    /**
     * 23. 获取群成员信息
     * OneBot V11: get_group_member_info
     * OneBot V12: get_group_member_info
     * Milky V1: get_group_member_info
     * Satori: guild.member.get
     */
    getGroupMemberInfo(uin: string, params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> {
        throw new Error(`${this.platform} adapter: getGroupMemberInfo not implemented`);
    }

    /**
     * 24. 踢出群成员
     * OneBot V11: set_group_kick
     * Milky V1: kick_group_member
     * Satori: guild.member.kick
     */
    kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        throw new Error(`${this.platform} adapter: kickGroupMember not implemented`);
    }

    /**
     * 25. 群成员禁言
     * OneBot V11: set_group_ban
     * Milky V1: set_group_member_mute
     * Satori: guild.member.mute
     */
    muteGroupMember(uin: string, params: Adapter.MuteGroupMemberParams): Promise<void> {
        throw new Error(`${this.platform} adapter: muteGroupMember not implemented`);
    }

    /**
     * 26. 全员禁言
     * OneBot V11: set_group_whole_ban
     * Milky V1: set_group_whole_mute
     */
    muteGroupAll(uin: string, params: Adapter.MuteGroupAllParams): Promise<void> {
        throw new Error(`${this.platform} adapter: muteGroupAll not implemented`);
    }

    /**
     * 27. 设置群管理员
     * OneBot V11: set_group_admin
     * Milky V1: set_group_member_admin
     */
    setGroupAdmin(uin: string, params: Adapter.SetGroupAdminParams): Promise<void> {
        throw new Error(`${this.platform} adapter: setGroupAdmin not implemented`);
    }

    /**
     * 28. 设置群名片
     * OneBot V11: set_group_card
     * Milky V1: set_group_member_card
     */
    setGroupCard(uin: string, params: Adapter.SetGroupCardParams): Promise<void> {
        throw new Error(`${this.platform} adapter: setGroupCard not implemented`);
    }

    /**
     * 29. 设置群专属头衔
     * OneBot V11: set_group_special_title
     * Milky V1: set_group_member_special_title
     */
    setGroupSpecialTitle(uin: string, params: Adapter.SetGroupSpecialTitleParams): Promise<void> {
        throw new Error(`${this.platform} adapter: setGroupSpecialTitle not implemented`);
    }

    /**
     * 30. 获取群荣誉信息
     * OneBot V11: get_group_honor_info
     */
    getGroupHonorInfo(uin: string, params: Adapter.GetGroupHonorInfoParams): Promise<Adapter.GroupHonorInfo> {
        throw new Error(`${this.platform} adapter: getGroupHonorInfo not implemented`);
    }

    /**
     * 31. 发送群戳一戳
     * Milky V1: send_group_nudge
     */
    sendGroupNudge(uin: string, params: Adapter.SendGroupNudgeParams): Promise<void> {
        throw new Error(`${this.platform} adapter: sendGroupNudge not implemented`);
    }

    /**
     * 32. 处理加群请求
     * OneBot V11: set_group_add_request
     * Milky V1: accept_group_request, reject_group_request, accept_group_invitation, reject_group_invitation
     */
    handleGroupRequest(uin: string, params: Adapter.HandleGroupRequestParams): Promise<void> {
        throw new Error(`${this.platform} adapter: handleGroupRequest not implemented`);
    }

    /**
     * 33. 获取群通知列表
     * Milky V1: get_group_notifications
     */
    getGroupNotifications(uin: string, params?: Adapter.GetGroupNotificationsParams): Promise<Adapter.GroupNotification[]> {
        throw new Error(`${this.platform} adapter: getGroupNotifications not implemented`);
    }

    /**
     * 34. 设置群头像
     * Milky V1: set_group_avatar
     */
    setGroupAvatar(uin: string, params: Adapter.SetGroupAvatarParams): Promise<void> {
        throw new Error(`${this.platform} adapter: setGroupAvatar not implemented`);
    }

    /**
     * 35. 发送群消息表情回应
     * Milky V1: send_group_message_reaction
     */
    sendGroupMessageReaction(uin: string, params: Adapter.SendGroupMessageReactionParams): Promise<void> {
        throw new Error(`${this.platform} adapter: sendGroupMessageReaction not implemented`);
    }

    // ============================================
    // 群公告相关方法 (Announcement - 3个)
    // ============================================

    /**
     * 36. 获取群公告列表
     * Milky V1: get_group_announcements
     */
    getGroupAnnouncements(uin: string, params: Adapter.GetGroupAnnouncementsParams): Promise<Adapter.GroupAnnouncement[]> {
        throw new Error(`${this.platform} adapter: getGroupAnnouncements not implemented`);
    }

    /**
     * 37. 发送群公告
     * Milky V1: send_group_announcement
     */
    sendGroupAnnouncement(uin: string, params: Adapter.SendGroupAnnouncementParams): Promise<void> {
        throw new Error(`${this.platform} adapter: sendGroupAnnouncement not implemented`);
    }

    /**
     * 38. 删除群公告
     * Milky V1: delete_group_announcement
     */
    deleteGroupAnnouncement(uin: string, params: Adapter.DeleteGroupAnnouncementParams): Promise<void> {
        throw new Error(`${this.platform} adapter: deleteGroupAnnouncement not implemented`);
    }

    // ============================================
    // 群精华消息相关方法 (Essence - 3个)
    // ============================================

    /**
     * 39. 获取群精华消息列表
     * Milky V1: get_group_essence_messages
     */
    getGroupEssenceMessages(uin: string, params: Adapter.GetGroupEssenceMessagesParams): Promise<Adapter.MessageInfo[]> {
        throw new Error(`${this.platform} adapter: getGroupEssenceMessages not implemented`);
    }

    /**
     * 40. 设置精华消息
     * Milky V1: set_group_essence_message
     */
    setGroupEssenceMessage(uin: string, params: Adapter.SetGroupEssenceMessageParams): Promise<void> {
        throw new Error(`${this.platform} adapter: setGroupEssenceMessage not implemented`);
    }

    /**
     * 41. 删除精华消息
     * Milky V1: delete_group_essence_message
     */
    deleteGroupEssenceMessage(uin: string, params: Adapter.DeleteGroupEssenceMessageParams): Promise<void> {
        throw new Error(`${this.platform} adapter: deleteGroupEssenceMessage not implemented`);
    }

    // ============================================
    // 频道相关方法 (Channel/Guild - 8个)
    // ============================================

    /**
     * 42. 获取频道服务器信息
     * OneBot V12: get_guild_info
     * Satori: guild.get
     */
    getGuildInfo(uin: string, params: Adapter.GetGuildInfoParams): Promise<Adapter.GuildInfo> {
        throw new Error(`${this.platform} adapter: getGuildInfo not implemented`);
    }

    /**
     * 43. 获取频道服务器列表
     * OneBot V12: get_guild_list
     * Satori: guild.list
     */
    getGuildList(uin: string): Promise<Adapter.GuildInfo[]> {
        throw new Error(`${this.platform} adapter: getGuildList not implemented`);
    }

    /**
     * 44. 获取频道成员信息
     * OneBot V12: get_guild_member_info
     * Satori: guild.member.get
     */
    getGuildMemberInfo(uin: string, params: Adapter.GetGuildMemberInfoParams): Promise<Adapter.GuildMemberInfo> {
        throw new Error(`${this.platform} adapter: getGuildMemberInfo not implemented`);
    }

    /**
     * 45. 获取频道信息
     * OneBot V12: get_channel_info
     * Satori: channel.get
     */
    getChannelInfo(uin: string, params: Adapter.GetChannelInfoParams): Promise<Adapter.ChannelInfo> {
        throw new Error(`${this.platform} adapter: getChannelInfo not implemented`);
    }

    /**
     * 46. 获取频道列表
     * OneBot V12: get_channel_list
     * Satori: channel.list
     */
    getChannelList(uin: string, params?: Adapter.GetChannelListParams): Promise<Adapter.ChannelInfo[]> {
        throw new Error(`${this.platform} adapter: getChannelList not implemented`);
    }

    /**
     * 47. 创建频道
     * Satori: channel.create
     */
    createChannel(uin: string, params: Adapter.CreateChannelParams): Promise<Adapter.ChannelInfo> {
        throw new Error(`${this.platform} adapter: createChannel not implemented`);
    }

    /**
     * 48. 更新频道
     * Satori: channel.update
     */
    updateChannel(uin: string, params: Adapter.UpdateChannelParams): Promise<void> {
        throw new Error(`${this.platform} adapter: updateChannel not implemented`);
    }

    /**
     * 49. 删除频道
     * Satori: channel.delete
     */
    deleteChannel(uin: string, params: Adapter.DeleteChannelParams): Promise<void> {
        throw new Error(`${this.platform} adapter: deleteChannel not implemented`);
    }

    // ============================================
    // 文件相关方法 (File - 10个)
    // ============================================

    /**
     * 50. 上传文件
     * OneBot V12: upload_file
     * Milky V1: upload_private_file, upload_group_file
     */
    uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        throw new Error(`${this.platform} adapter: uploadFile not implemented`);
    }

    /**
     * 51. 获取文件
     * OneBot V12: get_file
     */
    getFile(uin: string, params: Adapter.GetFileParams): Promise<Adapter.FileInfo> {
        throw new Error(`${this.platform} adapter: getFile not implemented`);
    }

    /**
     * 52. 删除文件
     * OneBot V12: delete_file
     * Milky V1: delete_group_file
     */
    deleteFile(uin: string, params: Adapter.DeleteFileParams): Promise<void> {
        throw new Error(`${this.platform} adapter: deleteFile not implemented`);
    }

    /**
     * 53. 获取群文件列表
     * Milky V1: get_group_files
     */
    getGroupFiles(uin: string, params: Adapter.GetGroupFilesParams): Promise<Adapter.GroupFilesResult> {
        throw new Error(`${this.platform} adapter: getGroupFiles not implemented`);
    }

    /**
     * 54. 创建群文件夹
     * Milky V1: create_group_folder
     */
    createGroupFolder(uin: string, params: Adapter.CreateGroupFolderParams): Promise<Adapter.FolderInfo> {
        throw new Error(`${this.platform} adapter: createGroupFolder not implemented`);
    }

    /**
     * 55. 获取文件下载链接
     * Milky V1: get_private_file_download_url, get_group_file_download_url
     */
    getFileDownloadUrl(uin: string, params: Adapter.GetFileDownloadUrlParams): Promise<string> {
        throw new Error(`${this.platform} adapter: getFileDownloadUrl not implemented`);
    }

    /**
     * 56. 移动群文件
     * Milky V1: move_group_file
     */
    moveGroupFile(uin: string, params: Adapter.MoveGroupFileParams): Promise<void> {
        throw new Error(`${this.platform} adapter: moveGroupFile not implemented`);
    }

    /**
     * 57. 重命名群文件
     * Milky V1: rename_group_file
     */
    renameGroupFile(uin: string, params: Adapter.RenameGroupFileParams): Promise<void> {
        throw new Error(`${this.platform} adapter: renameGroupFile not implemented`);
    }

    /**
     * 58. 重命名群文件夹
     * Milky V1: rename_group_folder
     */
    renameGroupFolder(uin: string, params: Adapter.RenameGroupFolderParams): Promise<void> {
        throw new Error(`${this.platform} adapter: renameGroupFolder not implemented`);
    }

    /**
     * 59. 删除群文件夹
     * Milky V1: delete_group_folder
     */
    deleteGroupFolder(uin: string, params: Adapter.DeleteGroupFolderParams): Promise<void> {
        throw new Error(`${this.platform} adapter: deleteGroupFolder not implemented`);
    }

    // ============================================
    // 媒体资源相关方法 (Media - 5个)
    // ============================================

    /**
     * 60. 获取图片
     * OneBot V11: get_image
     */
    getImage(uin: string, params: Adapter.GetImageParams): Promise<Adapter.ImageInfo> {
        throw new Error(`${this.platform} adapter: getImage not implemented`);
    }

    /**
     * 61. 获取语音
     * OneBot V11: get_record
     */
    getRecord(uin: string, params: Adapter.GetRecordParams): Promise<Adapter.RecordInfo> {
        throw new Error(`${this.platform} adapter: getRecord not implemented`);
    }

    /**
     * 62. 获取资源临时 URL
     * Milky V1: get_resource_temp_url
     */
    getResourceTempUrl(uin: string, params: Adapter.GetResourceTempUrlParams): Promise<string> {
        throw new Error(`${this.platform} adapter: getResourceTempUrl not implemented`);
    }

    /**
     * 63. 检查是否可以发送图片
     * OneBot V11: can_send_image
     */
    canSendImage(uin: string): Promise<boolean> {
        throw new Error(`${this.platform} adapter: canSendImage not implemented`);
    }

    /**
     * 64. 检查是否可以发送语音
     * OneBot V11: can_send_record
     */
    canSendRecord(uin: string): Promise<boolean> {
        throw new Error(`${this.platform} adapter: canSendRecord not implemented`);
    }

    // ============================================
    // 系统相关方法 (Meta/System - 8个)
    // ============================================

    /**
     * 65. 获取版本信息
     * OneBot V11: get_version_info
     * OneBot V12: get_version
     * Milky V1: get_impl_info
     */
    getVersion(uin: string): Promise<Adapter.VersionInfo> {
        throw new Error(`${this.platform} adapter: getVersion not implemented`);
    }

    /**
     * 66. 获取运行状态
     * OneBot V11: get_status
     * OneBot V12: get_status
     */
    getStatus(uin: string): Promise<Adapter.StatusInfo> {
        throw new Error(`${this.platform} adapter: getStatus not implemented`);
    }

    /**
     * 67. 获取支持的动作列表
     * OneBot V12: get_supported_actions
     */
    getSupportedActions(uin: string): Promise<string[]> {
        throw new Error(`${this.platform} adapter: getSupportedActions not implemented`);
    }

    /**
     * 68. 获取 Cookies
     * OneBot V11: get_cookies
     * Milky V1: get_cookies
     */
    getCookies(uin: string, params?: Adapter.GetCookiesParams): Promise<string> {
        throw new Error(`${this.platform} adapter: getCookies not implemented`);
    }

    /**
     * 69. 获取 CSRF Token
     * OneBot V11: get_csrf_token
     * Milky V1: get_csrf_token
     */
    getCsrfToken(uin: string): Promise<number> {
        throw new Error(`${this.platform} adapter: getCsrfToken not implemented`);
    }

    /**
     * 70. 获取凭证
     * OneBot V11: get_credentials
     */
    getCredentials(uin: string, params?: Adapter.GetCredentialsParams): Promise<Adapter.CredentialsInfo> {
        throw new Error(`${this.platform} adapter: getCredentials not implemented`);
    }

    /**
     * 71. 重启
     * OneBot V11: set_restart
     */
    setRestart(uin: string, params?: Adapter.SetRestartParams): Promise<void> {
        throw new Error(`${this.platform} adapter: setRestart not implemented`);
    }

    /**
     * 72. 清理缓存
     * OneBot V11: clean_cache
     */
    cleanCache(uin: string): Promise<void> {
        throw new Error(`${this.platform} adapter: cleanCache not implemented`);
    }

    // ============================================
    // 频道成员相关方法 (Channel Member)
    // ============================================

    /**
     * 获取频道成员信息
     */
    getChannelMemberInfo(uin: string, params: Adapter.GetChannelMemberInfoParams): Promise<Adapter.ChannelMemberInfo> {
        throw new Error(`${this.platform} adapter: getChannelMemberInfo not implemented`);
    }

    /**
     * 获取频道成员列表
     */
    getChannelMemberList(uin: string, params: Adapter.GetChannelMemberListParams): Promise<Adapter.ChannelMemberInfo[]> {
        throw new Error(`${this.platform} adapter: getChannelMemberList not implemented`);
    }

    /**
     * 设置频道成员名片
     */
    setChannelMemberCard(uin: string, params: Adapter.SetChannelMemberCardParams): Promise<void> {
        throw new Error(`${this.platform} adapter: setChannelMemberCard not implemented`);
    }

    /**
     * 设置频道成员角色
     */
    setChannelMemberRole(uin: string, params: Adapter.SetChannelMemberRoleParams): Promise<void> {
        throw new Error(`${this.platform} adapter: setChannelMemberRole not implemented`);
    }

    /**
     * 设置频道禁言
     */
    setChannelMute(uin: string, params: Adapter.SetChannelMuteParams): Promise<void> {
        throw new Error(`${this.platform} adapter: setChannelMute not implemented`);
    }

    /**
     * 邀请频道成员
     */
    inviteChannelMember(uin: string, params: Adapter.InviteChannelMemberParams): Promise<void> {
        throw new Error(`${this.platform} adapter: inviteChannelMember not implemented`);
    }

    /**
     * 踢出频道成员
     */
    kickChannelMember(uin: string, params: Adapter.KickChannelMemberParams): Promise<void> {
        throw new Error(`${this.platform} adapter: kickChannelMember not implemented`);
    }

    /**
     * 设置频道成员禁言
     */
    setChannelMemberMute(uin: string, params: Adapter.SetChannelMemberMuteParams): Promise<void> {
        throw new Error(`${this.platform} adapter: setChannelMemberMute not implemented`);
    }

    // ============================================
    // 具体方法 (Concrete methods)
    // ============================================

    getAccount(uin: string) {
        return this.accounts.get(uin)
    }

    get logger() {
        return (this.#logger ||= this.app.getLogger(this.platform as string));
    }

    get info() {
        return {
            platform: this.platform,
            icon: this.icon,
            accounts: [...this.accounts.values()].map(account => {
                return account.info;
            }),
        };
    }

    async setOnline(uin: string) { }
    async setOffline(uin: string) { }

    /**
     * 创建账号 - 必须由平台适配器实现
     */
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

/**
 * Adapter 命名空间
 * 定义所有 API 的参数和返回值类型
 */
export namespace Adapter {
    export interface Configs extends Record<string, any> { }

    // ============================================
    // 消息相关类型 (7个方法)
    // ============================================

    export interface SendMessageParams {
        scene_type: CommonTypes.Scene;
        scene_id: CommonTypes.Id;
        message: CommonTypes.Segment[];
    }

    export interface SendMessageResult {
        message_id: CommonTypes.Id;
    }

    export interface DeleteMessageParams {
        message_id: CommonTypes.Id;
        scene_type?: CommonTypes.Scene;  // Milky 需要
        scene_id?: CommonTypes.Id;  // Milky 需要
    }

    export interface GetMessageParams {
        message_id: CommonTypes.Id;
        scene_type?: CommonTypes.Scene;  // Milky 需要
        scene_id?: CommonTypes.Id;  // Milky 需要
    }

    export interface GetMessageHistoryParams {
        scene_type: CommonTypes.Scene;
        scene_id: CommonTypes.Id;
        limit?: number;
        offset?: number;
    }

    export interface UpdateMessageParams {
        message_id: CommonTypes.Id;
        message: CommonTypes.Segment[];
    }

    export interface GetForwardMessageParams {
        message_id?: CommonTypes.Id;  // OneBot V11
        resource_id?: string;  // Milky
    }

    export interface MarkMessageAsReadParams {
        scene_type: CommonTypes.Scene;
        scene_id: CommonTypes.Id;
        message_id?: CommonTypes.Id;
    }

    export interface MessageSender {
        scene_type: CommonTypes.Scene;
        sender_id: CommonTypes.Id;
        scene_id: CommonTypes.Id;
        sender_name: string;
        scene_name: string;
    }

    export interface MessageInfo {
        message_id: CommonTypes.Id;
        time: number;
        sender: MessageSender;
        message: CommonTypes.Segment[];
    }

    // ============================================
    // 用户相关类型 (3个方法)
    // ============================================

    export interface GetUserInfoParams {
        user_id: CommonTypes.Id;
        no_cache?: boolean;  // Milky
    }

    export interface CreateUserChannelParams {
        user_id: CommonTypes.Id;
        guild_id?: CommonTypes.Id;
    }

    export interface UserInfo {
        user_id: CommonTypes.Id;
        user_name: string;
        user_displayname?: string;
        avatar?: string;
    }

    // ============================================
    // 好友相关类型 (7个方法)
    // ============================================

    export interface GetFriendListParams {
        no_cache?: boolean;  // Milky
    }

    export interface GetFriendInfoParams {
        user_id: CommonTypes.Id;
        no_cache?: boolean;
    }

    export interface DeleteFriendParams {
        user_id: CommonTypes.Id;
    }

    export interface SendFriendNudgeParams {
        user_id: CommonTypes.Id;
        is_self?: boolean;  // Milky
    }

    export interface SendLikeParams {
        user_id: CommonTypes.Id;
        times?: number;  // OneBot V11
        count?: number;  // Milky
    }

    export interface GetFriendRequestsParams {
        limit?: number;
        is_filtered?: boolean;
    }

    export interface HandleFriendRequestParams {
        request_id?: CommonTypes.Id;  // Milky
        flag?: string;  // OneBot V11
        approve: boolean;
        remark?: string;
    }

    export interface FriendInfo {
        user_id: CommonTypes.Id;
        user_name: string;
        remark?: string;
    }

    export interface FriendRequest {
        request_id: CommonTypes.Id;
        user_id: CommonTypes.Id;
        user_name: string;
        message?: string;
        time: number;
    }

    // ============================================
    // 群组相关类型 (18个方法)
    // ============================================

    export interface GetGroupListParams {
        no_cache?: boolean;
    }

    export interface GetGroupInfoParams {
        group_id: CommonTypes.Id;
        no_cache?: boolean;
    }

    export interface SetGroupNameParams {
        group_id: CommonTypes.Id;
        group_name: string;
    }

    export interface LeaveGroupParams {
        group_id: CommonTypes.Id;
        is_dismiss?: boolean;
    }

    export interface GetGroupMemberListParams {
        group_id: CommonTypes.Id;
        no_cache?: boolean;
    }

    export interface GetGroupMemberInfoParams {
        group_id: CommonTypes.Id;
        user_id: CommonTypes.Id;
        no_cache?: boolean;
    }

    export interface KickGroupMemberParams {
        group_id: CommonTypes.Id;
        user_id: CommonTypes.Id;
        reject_add_request?: boolean;
    }

    export interface MuteGroupMemberParams {
        group_id: CommonTypes.Id;
        user_id: CommonTypes.Id;
        duration: number;  // 秒，0 表示取消禁言
    }

    export interface MuteGroupAllParams {
        group_id: CommonTypes.Id;
        enable: boolean;
    }

    export interface SetGroupAdminParams {
        group_id: CommonTypes.Id;
        user_id: CommonTypes.Id;
        enable: boolean;
    }

    export interface SetGroupCardParams {
        group_id: CommonTypes.Id;
        user_id: CommonTypes.Id;
        card: string;
    }

    export interface SetGroupSpecialTitleParams {
        group_id: CommonTypes.Id;
        user_id: CommonTypes.Id;
        special_title: string;
        duration?: number;
    }

    export interface GetGroupHonorInfoParams {
        group_id: CommonTypes.Id;
        type: "talkative" | "performer" | "legend" | "strong_newbie" | "emotion" | "all";
    }

    export interface SendGroupNudgeParams {
        group_id: CommonTypes.Id;
        user_id: CommonTypes.Id;
    }

    export interface HandleGroupRequestParams {
        request_id?: CommonTypes.Id;  // Milky
        flag?: string;  // OneBot V11
        sub_type?: "add" | "invite";  // OneBot V11
        type: "request" | "invitation";
        approve: boolean;
        reason?: string;
    }

    export interface GetGroupNotificationsParams {
        is_filtered?: boolean;
        limit?: number;
    }

    export interface SetGroupAvatarParams {
        group_id: CommonTypes.Id;
        file: string;  // 文件路径或 URL
    }

    export interface SendGroupMessageReactionParams {
        group_id: CommonTypes.Id;
        message_id: CommonTypes.Id;
        face_id: number;
    }

    export interface GroupInfo {
        group_id: CommonTypes.Id;
        group_name: string;
        member_count?: number;
        max_member_count?: number;
    }

    export interface GroupMemberInfo {
        group_id: CommonTypes.Id;
        user_id: CommonTypes.Id;
        user_name: string;
        card?: string;
        role?: "owner" | "admin" | "member";
    }

    export interface GroupHonorInfo {
        group_id: CommonTypes.Id;
        current_talkative?: any;
        talkative_list?: any[];
        performer_list?: any[];
        legend_list?: any[];
        strong_newbie_list?: any[];
        emotion_list?: any[];
    }

    export interface GroupNotification {
        notification_id: CommonTypes.Id;
        group_id: CommonTypes.Id;
        user_id: CommonTypes.Id;
        type: string;
        time: number;
    }

    // ============================================
    // 群公告相关类型 (3个方法)
    // ============================================

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

    // ============================================
    // 群精华消息相关类型 (3个方法)
    // ============================================

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

    // ============================================
    // 频道相关类型 (8个方法)
    // ============================================

    export interface GetGuildInfoParams {
        guild_id: CommonTypes.Id;
    }

    export interface GetGuildMemberInfoParams {
        guild_id: CommonTypes.Id;
        user_id: CommonTypes.Id;
    }

    export interface GetChannelInfoParams {
        channel_id: CommonTypes.Id;
        guild_id?: CommonTypes.Id;  // OneBot V12 需要
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

    // ============================================
    // 频道成员相关类型
    // ============================================

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

    // ============================================
    // 文件相关类型 (10个方法)
    // ============================================

    export interface UploadFileParams {
        scene_type: CommonTypes.Scene;
        scene_id: CommonTypes.Id;
        name: string;
        url?: string;
        path?: string;
        data?: string;  // base64
        folder_id?: CommonTypes.Id;  // Milky
    }

    export interface GetFileParams {
        file_id: CommonTypes.Id;
        type?: string;
    }

    export interface DeleteFileParams {
        file_id: CommonTypes.Id;
        scene_type?: CommonTypes.Scene;  // Milky
        scene_id?: CommonTypes.Id;  // Milky
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

    // ============================================
    // 媒体资源相关类型 (5个方法)
    // ============================================

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

    // ============================================
    // 系统相关类型 (8个方法)
    // ============================================

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
        app_name?: string;  // OneBot V11
        app_version?: string;  // OneBot V11
        impl?: string;  // OneBot V12 / Milky
        version?: string;  // OneBot V12
        onebot_version?: string;  // OneBot V12
        milky_version?: string;  // Milky
        impl_version?: string;  // Milky
    }

    export interface StatusInfo {
        online?: boolean;  // OneBot V11
        good: boolean;
        bots?: any[];  // OneBot V12
    }

    export interface CredentialsInfo {
        cookies: string;
        csrf_token: number;
    }
    export type Construct<T> = {
        new(...args: any[]): T;
    };
    export type Creator<T> = (...args: any[]) => T;
    export type Factory<T extends Adapter = Adapter> = Construct<T>|Creator<T>
    export function isClassAdapter<T extends Adapter = Adapter>(obj: any): obj is Construct<T> {
        return typeof obj === 'function' && /^class\s/.test(Function.prototype.toString.call(obj));
    }
    /**
     * Adapter metadata for registry
     */
    export interface Metadata {
        /** Adapter name/platform identifier */
        name: string;
        /** Display name for UI */
        displayName: string;
        /** Description of the adapter */
        description: string;
        /** Icon URL or data URI */
        icon?: string;
        /** Homepage URL */
        homepage?: string;
        /** Author information */
        author?: string;
    }
}
