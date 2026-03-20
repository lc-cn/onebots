/**
 * 微信客服 OneBots 适配器
 */
import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    CommonTypes,
} from "onebots";
import { readFileSync } from "node:fs";
import { WeComKfBot } from "./bot.js";
import { kfItemToCommonEvent } from "./msg-mapper.js";
import type { WeComKfConfig, KfMsgItem } from "./types.js";

function unsupported(name: string): never {
    throw new Error(`微信客服不支持 ${name}`);
}

export class WeComKfAdapter extends Adapter<WeComKfBot, "wecom-kf"> {
    /** account_id:external_userid -> open_kfid */
    private readonly userLastOpenKf = new Map<string, string>();

    constructor(app: BaseApp) {
        super(app, "wecom-kf");
        this.icon = "https://work.weixin.qq.com/favicon.ico";
    }

    private ctxKey(accountId: string, externalUserid: string): string {
        return `${accountId}\0${externalUserid}`;
    }

    async sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`未找到账号 ${uin}`);

        if (params.scene_type !== "private" && params.scene_type !== "direct") {
            throw new Error("微信客服仅支持私聊/direct 场景");
        }

        const bot = account.client;
        const cfg = bot.getConfig();
        const touser = this.coerceId(params.scene_id as CommonTypes.Id | string | number).string;
        const openKf =
            this.userLastOpenKf.get(this.ctxKey(account.account_id, touser)) ||
            cfg.open_kfid ||
            "";
        if (!openKf) {
            throw new Error("未配置 open_kfid 且无会话上下文，无法发送消息");
        }

        let lastMsgId: string | undefined;
        for (const seg of params.message) {
            if (typeof seg === "string") {
                const r = await bot.sendMsg({
                    touser,
                    open_kfid: openKf,
                    msgtype: "text",
                    text: { content: seg },
                });
                if (r.errcode !== 0) throw new Error(`发送消息失败: ${r.errmsg} (${r.errcode})`);
                lastMsgId = r.msgid || lastMsgId;
                continue;
            }
            if (seg.type === "text") {
                const r = await bot.sendMsg({
                    touser,
                    open_kfid: openKf,
                    msgtype: "text",
                    text: { content: seg.data.text || "" },
                });
                if (r.errcode !== 0) throw new Error(`发送消息失败: ${r.errmsg} (${r.errcode})`);
                lastMsgId = r.msgid || lastMsgId;
            } else if (seg.type === "image") {
                const mediaId =
                    seg.data.file_id ||
                    seg.data.media_id ||
                    (await this.resolveMediaId(bot, "image", seg.data.url, seg.data.file));
                const r = await bot.sendMsg({
                    touser,
                    open_kfid: openKf,
                    msgtype: "image",
                    image: { media_id: mediaId },
                });
                if (r.errcode !== 0) throw new Error(`发送图片失败: ${r.errmsg} (${r.errcode})`);
                lastMsgId = r.msgid || lastMsgId;
            } else if (seg.type === "voice" || seg.type === "record") {
                const mediaId = await this.resolveMediaId(bot, "voice", seg.data.url, seg.data.file);
                const r = await bot.sendMsg({
                    touser,
                    open_kfid: openKf,
                    msgtype: "voice",
                    voice: { media_id: mediaId },
                });
                if (r.errcode !== 0) throw new Error(`发送语音失败: ${r.errmsg} (${r.errcode})`);
                lastMsgId = r.msgid || lastMsgId;
            } else if (seg.type === "video") {
                const mediaId = await this.resolveMediaId(bot, "video", seg.data.url, seg.data.file);
                const r = await bot.sendMsg({
                    touser,
                    open_kfid: openKf,
                    msgtype: "video",
                    video: { media_id: mediaId },
                });
                if (r.errcode !== 0) throw new Error(`发送视频失败: ${r.errmsg} (${r.errcode})`);
                lastMsgId = r.msgid || lastMsgId;
            } else if (seg.type === "file") {
                const mediaId = await this.resolveMediaId(bot, "file", seg.data.url, seg.data.file);
                const r = await bot.sendMsg({
                    touser,
                    open_kfid: openKf,
                    msgtype: "file",
                    file: { media_id: mediaId },
                });
                if (r.errcode !== 0) throw new Error(`发送文件失败: ${r.errmsg} (${r.errcode})`);
                lastMsgId = r.msgid || lastMsgId;
            } else {
                const r = await bot.sendMsg({
                    touser,
                    open_kfid: openKf,
                    msgtype: "text",
                    text: { content: `[${seg.type}]` },
                });
                if (r.errcode !== 0) throw new Error(`发送消息失败: ${r.errmsg} (${r.errcode})`);
                lastMsgId = r.msgid || lastMsgId;
            }
        }

        return {
            message_id: this.createId(lastMsgId || Date.now().toString()),
        };
    }

    private async resolveMediaId(
        bot: WeComKfBot,
        type: string,
        url?: string,
        path?: string,
    ): Promise<string> {
        if (!url && !path) {
            throw new Error("图片/语音等消息需要提供 url、file 路径或 file_id/media_id");
        }
        let buf: Buffer;
        let filename = "file.bin";
        if (path) {
            buf = readFileSync(path);
            const parts = path.split(/[/\\]/);
            filename = parts[parts.length - 1] || filename;
        } else if (url) {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`下载媒体失败: ${res.status}`);
            buf = Buffer.from(await res.arrayBuffer());
            try {
                const u = new URL(url);
                filename = u.pathname.split("/").pop() || filename;
            } catch {
                /* ignore */
            }
        } else {
            throw new Error("无法解析媒体");
        }
        return bot.uploadTempMedia(type, buf, filename);
    }

    async deleteMessage(_uin: string, _params: Adapter.DeleteMessageParams): Promise<void> {
        throw unsupported("撤回/删除消息");
    }

    async getMessage(_uin: string, _params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        throw unsupported("getMessage");
    }

    async getMessageHistory(_uin: string, _params: Adapter.GetMessageHistoryParams): Promise<Adapter.MessageInfo[]> {
        throw unsupported("getMessageHistory");
    }

    async updateMessage(_uin: string, _params: Adapter.UpdateMessageParams): Promise<void> {
        throw unsupported("updateMessage");
    }

    async getForwardMessage(_uin: string, _params: Adapter.GetForwardMessageParams): Promise<Adapter.MessageInfo[]> {
        throw unsupported("getForwardMessage");
    }

    async markMessageAsRead(_uin: string, _params: Adapter.MarkMessageAsReadParams): Promise<void> {
        throw unsupported("markMessageAsRead");
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`未找到账号 ${uin}`);
        const cfg = account.client.getConfig();
        const id = cfg.open_kfid || account.account_id;
        return {
            user_id: this.createId(id),
            user_name: "微信客服",
            user_displayname: account.nickname || "微信客服",
            avatar: this.icon,
        };
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`未找到账号 ${uin}`);
        const bot = account.client;
        const uid = params.user_id.string;
        const res = await bot.customerBatchGet([uid], 0);
        if (res.errcode !== 0) {
            throw new Error(`获取客户信息失败: ${res.errmsg} (${res.errcode})`);
        }
        const c = res.customer_list?.[0];
        if (!c) {
            return {
                user_id: params.user_id,
                user_name: uid,
            };
        }
        return {
            user_id: this.createId(c.external_userid),
            user_name: c.nickname || c.external_userid,
            user_displayname: c.nickname,
            avatar: c.avatar,
        };
    }

    async createUserChannel(_uin: string, _params: Adapter.CreateUserChannelParams): Promise<Adapter.ChannelInfo> {
        throw unsupported("createUserChannel");
    }

    async getFriendList(_uin: string): Promise<Adapter.FriendInfo[]> {
        return [];
    }

    async getFriendInfo(uin: string, params: Adapter.GetFriendInfoParams): Promise<Adapter.FriendInfo> {
        const u = await this.getUserInfo(uin, { user_id: params.user_id });
        return {
            user_id: u.user_id,
            user_name: u.user_name,
            remark: u.user_displayname || u.user_name,
        };
    }

    async deleteFriend(_uin: string, _params: Adapter.DeleteFriendParams): Promise<void> {
        throw unsupported("deleteFriend");
    }

    async sendFriendNudge(_uin: string, _params: Adapter.SendFriendNudgeParams): Promise<void> {
        throw unsupported("sendFriendNudge");
    }

    async sendLike(_uin: string, _params: Adapter.SendLikeParams): Promise<void> {
        throw unsupported("sendLike");
    }

    async getFriendRequests(_uin: string): Promise<Adapter.FriendRequest[]> {
        return [];
    }

    async handleFriendRequest(_uin: string, _params: Adapter.HandleFriendRequestParams): Promise<void> {
        throw unsupported("handleFriendRequest");
    }

    async getGroupList(_uin: string): Promise<Adapter.GroupInfo[]> {
        return [];
    }

    async getGroupInfo(_uin: string, _params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        throw unsupported("群聊");
    }

    async setGroupName(_uin: string, _params: Adapter.SetGroupNameParams): Promise<void> {
        throw unsupported("群聊");
    }

    async leaveGroup(_uin: string, _params: Adapter.LeaveGroupParams): Promise<void> {
        throw unsupported("群聊");
    }

    async getGroupMemberList(_uin: string, _params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        return [];
    }

    async getGroupMemberInfo(_uin: string, _params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> {
        throw unsupported("群聊");
    }

    async kickGroupMember(_uin: string, _params: Adapter.KickGroupMemberParams): Promise<void> {
        throw unsupported("群聊");
    }

    async muteGroupMember(_uin: string, _params: Adapter.MuteGroupMemberParams): Promise<void> {
        throw unsupported("群聊");
    }

    async muteGroupAll(_uin: string, _params: Adapter.MuteGroupAllParams): Promise<void> {
        throw unsupported("群聊");
    }

    async setGroupAdmin(_uin: string, _params: Adapter.SetGroupAdminParams): Promise<void> {
        throw unsupported("群聊");
    }

    async setGroupCard(_uin: string, _params: Adapter.SetGroupCardParams): Promise<void> {
        throw unsupported("群聊");
    }

    async setGroupSpecialTitle(_uin: string, _params: Adapter.SetGroupSpecialTitleParams): Promise<void> {
        throw unsupported("群聊");
    }

    async getGroupHonorInfo(_uin: string, _params: Adapter.GetGroupHonorInfoParams): Promise<Adapter.GroupHonorInfo> {
        throw unsupported("群聊");
    }

    async sendGroupNudge(_uin: string, _params: Adapter.SendGroupNudgeParams): Promise<void> {
        throw unsupported("群聊");
    }

    async handleGroupRequest(_uin: string, _params: Adapter.HandleGroupRequestParams): Promise<void> {
        throw unsupported("群聊");
    }

    async getGroupNotifications(_uin: string): Promise<Adapter.GroupNotification[]> {
        return [];
    }

    async setGroupAvatar(_uin: string, _params: Adapter.SetGroupAvatarParams): Promise<void> {
        throw unsupported("群聊");
    }

    async sendGroupMessageReaction(_uin: string, _params: Adapter.SendGroupMessageReactionParams): Promise<void> {
        throw unsupported("群聊");
    }

    async getGroupAnnouncements(_uin: string): Promise<Adapter.GroupAnnouncement[]> {
        return [];
    }

    async sendGroupAnnouncement(_uin: string, _params: Adapter.SendGroupAnnouncementParams): Promise<void> {
        throw unsupported("群聊");
    }

    async deleteGroupAnnouncement(_uin: string, _params: Adapter.DeleteGroupAnnouncementParams): Promise<void> {
        throw unsupported("群聊");
    }

    async getGroupEssenceMessages(_uin: string): Promise<Adapter.MessageInfo[]> {
        return [];
    }

    async setGroupEssenceMessage(_uin: string, _params: Adapter.SetGroupEssenceMessageParams): Promise<void> {
        throw unsupported("群聊");
    }

    async deleteGroupEssenceMessage(_uin: string, _params: Adapter.DeleteGroupEssenceMessageParams): Promise<void> {
        throw unsupported("群聊");
    }

    async getGuildInfo(_uin: string, _params: Adapter.GetGuildInfoParams): Promise<Adapter.GuildInfo> {
        throw unsupported("频道");
    }

    async getGuildList(_uin: string): Promise<Adapter.GuildInfo[]> {
        return [];
    }

    async getGuildMemberInfo(_uin: string, _params: Adapter.GetGuildMemberInfoParams): Promise<Adapter.GuildMemberInfo> {
        throw unsupported("频道");
    }

    async getChannelInfo(_uin: string, _params: Adapter.GetChannelInfoParams): Promise<Adapter.ChannelInfo> {
        throw unsupported("频道");
    }

    async getChannelList(_uin: string): Promise<Adapter.ChannelInfo[]> {
        return [];
    }

    async createChannel(_uin: string, _params: Adapter.CreateChannelParams): Promise<Adapter.ChannelInfo> {
        throw unsupported("频道");
    }

    async updateChannel(_uin: string, _params: Adapter.UpdateChannelParams): Promise<void> {
        throw unsupported("频道");
    }

    async deleteChannel(_uin: string, _params: Adapter.DeleteChannelParams): Promise<void> {
        throw unsupported("频道");
    }

    async uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`未找到账号 ${uin}`);
        let buf: Buffer;
        let name = params.name || "upload.bin";
        if (params.data) {
            buf = Buffer.from(params.data, "base64");
        } else if (params.path) {
            buf = readFileSync(params.path);
        } else if (params.url) {
            const res = await fetch(params.url);
            if (!res.ok) throw new Error(`下载文件失败: ${res.status}`);
            buf = Buffer.from(await res.arrayBuffer());
        } else {
            throw new Error("uploadFile 需要 url、path 或 data(base64)");
        }
        const mediaId = await account.client.uploadTempMedia("file", buf, name);
        return {
            file_id: this.createId(mediaId),
            file_name: name,
            file_size: buf.length,
        };
    }

    async getFile(_uin: string, _params: Adapter.GetFileParams): Promise<Adapter.FileInfo> {
        throw unsupported("getFile");
    }

    async deleteFile(_uin: string, _params: Adapter.DeleteFileParams): Promise<void> {
        throw unsupported("deleteFile");
    }

    async getGroupFiles(_uin: string, _params: Adapter.GetGroupFilesParams): Promise<Adapter.GroupFilesResult> {
        return { files: [], folders: [] };
    }

    async createGroupFolder(_uin: string, _params: Adapter.CreateGroupFolderParams): Promise<Adapter.FolderInfo> {
        throw unsupported("createGroupFolder");
    }

    async getFileDownloadUrl(_uin: string, _params: Adapter.GetFileDownloadUrlParams): Promise<string> {
        throw unsupported("getFileDownloadUrl");
    }

    async moveGroupFile(_uin: string, _params: Adapter.MoveGroupFileParams): Promise<void> {
        throw unsupported("moveGroupFile");
    }

    async renameGroupFile(_uin: string, _params: Adapter.RenameGroupFileParams): Promise<void> {
        throw unsupported("renameGroupFile");
    }

    async renameGroupFolder(_uin: string, _params: Adapter.RenameGroupFolderParams): Promise<void> {
        throw unsupported("renameGroupFolder");
    }

    async deleteGroupFolder(_uin: string, _params: Adapter.DeleteGroupFolderParams): Promise<void> {
        throw unsupported("deleteGroupFolder");
    }

    async getImage(_uin: string, _params: Adapter.GetImageParams): Promise<Adapter.ImageInfo> {
        throw unsupported("getImage");
    }

    async getRecord(_uin: string, _params: Adapter.GetRecordParams): Promise<Adapter.RecordInfo> {
        throw unsupported("getRecord");
    }

    async getResourceTempUrl(_uin: string, _params: Adapter.GetResourceTempUrlParams): Promise<string> {
        throw unsupported("getResourceTempUrl");
    }

    async canSendImage(_uin: string): Promise<boolean> {
        return true;
    }

    async canSendRecord(_uin: string): Promise<boolean> {
        return true;
    }

    async getVersion(_uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots 微信客服 Adapter",
            app_version: "0.1.0",
            impl: "wecom-kf",
            version: "0.1.0",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        return {
            online: account?.status === AccountStatus.Online,
            good: account?.status === AccountStatus.Online,
        };
    }

    private dispatchKfItems(account: Account<"wecom-kf", WeComKfBot>, openKfid: string, items: KfMsgItem[]): void {
        for (const item of items) {
            const ext = item.external_userid;
            if (ext) {
                this.userLastOpenKf.set(this.ctxKey(account.account_id, ext), item.open_kfid || openKfid);
            }
            const ev = kfItemToCommonEvent(item, {
                createId: this.createId.bind(this),
                platform: this.platform,
                botAccountId: account.account_id,
                openKfId: openKfid,
            });
            if (ev) {
                account.dispatch(ev);
            }
        }
    }

    createAccount(config: Account.Config<"wecom-kf">): Account<"wecom-kf", WeComKfBot> {
        const kfCfg: WeComKfConfig = {
            account_id: config.account_id,
            corp_id: config.corp_id,
            corp_secret: config.corp_secret,
            token: config.token,
            encoding_aes_key: config.encoding_aes_key,
            open_kfid: config.open_kfid,
            agent_id: config.agent_id,
            enable_sync_poll: config.enable_sync_poll,
            sync_poll_interval_ms: config.sync_poll_interval_ms,
            cursor_store_path: config.cursor_store_path,
        };

        const bot = new WeComKfBot(kfCfg);
        const account = new Account<"wecom-kf", WeComKfBot>(this, bot, config);

        const hook = bot.handleWebhook.bind(bot);
        this.app.router.get(`${account.path}/webhook`, hook);
        this.app.router.post(`${account.path}/webhook`, hook);

        bot.on("kf_messages", (payload: { open_kfid: string; items: KfMsgItem[] }) => {
            this.dispatchKfItems(account, payload.open_kfid, payload.items);
        });

        bot.on("error", (err) => {
            this.logger.error(`微信客服 ${config.account_id} 错误:`, err);
        });

        account.on("start", async () => {
            try {
                await bot.start();
                account.status = AccountStatus.Online;
                account.nickname = "微信客服";
                account.avatar = this.icon;
                this.logger.info(`微信客服账号 ${config.account_id} 已启动`);
            } catch (e) {
                this.logger.error(`启动微信客服失败:`, e);
                account.status = AccountStatus.OffLine;
            }
        });

        account.on("stop", async () => {
            await bot.stop();
            account.status = AccountStatus.OffLine;
        });

        return account;
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            "wecom-kf": WeComKfConfig;
        }
    }
}

AdapterRegistry.register("wecom-kf", WeComKfAdapter, {
    name: "wecom-kf",
    displayName: "企业微信·微信客服",
    description:
        "企业微信「微信客服」API：回调 kf_msg_or_event + sync_msg 拉取消息，send_msg 发送（需管理台开通并授权自建应用）",
    icon: "https://work.weixin.qq.com/favicon.ico",
    homepage: "https://developer.work.weixin.qq.com/document/path/94638",
    author: "凉菜",
});
