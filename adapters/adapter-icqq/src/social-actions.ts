import type { Client } from "@icqqjs/icqq";
import type { FriendRequestEvent } from "@icqqjs/icqq/lib/events";
import type { ForwardMessage, GroupMessage, PrivateMessage } from "@icqqjs/icqq/lib/message";
import { Adapter, BaseApp, CommonTypes, ErrorCategory, type Account } from "onebots";
import { ICQQBot } from "./bot.js";
import { icqqCapabilities } from "./capabilities.js";
import { parseICQQNumericId } from "./client-config.js";
import { compileICQQMessage, projectICQQMessageSegments } from "./messages.js";
import { materializeICQQMediaSource } from "./media.js";
import {
    ICQQError,
    icqqOperationRejected,
    icqqResourceNotFound,
    invalidICQQParam,
} from "./errors.js";

/** 消息、用户与好友动作，以及所有原生动作共用的客户端边界。 */
export abstract class ICQQSocialActions extends Adapter<ICQQBot, "icqq"> {
    private resourceUrls?: Map<string, string>;

    constructor(app: BaseApp) {
        super(app, "icqq", icqqCapabilities);
        this.icon = "https://qzonestyle.gtimg.cn/qzone/qzact/act/external/tiqq/logo.png";
    }

    // ============================================
    // 消息相关方法
    // ============================================

    /**
     * 发送消息
     */
    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const bot = this.requireBot(uin);
        const { scene_type, message } = params;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);

        // 转换消息格式
        const icqqMessage = compileICQQMessage(message);

        let messageId: string;
        if (scene_type === "private") {
            const result = await bot.sendPrivateMessage(
                this.numericId(sceneId.string, "scene_id"),
                icqqMessage,
            );
            messageId = result.message_id || result.seq?.toString() || "";
        } else if (scene_type === "group") {
            const result = await bot.sendGroupMessage(
                this.numericId(sceneId.string, "scene_id"),
                icqqMessage,
            );
            messageId = result.message_id || result.seq?.toString() || "";
        } else if (scene_type === "channel") {
            const [guildId, channelId, ...rest] = sceneId.string.split(":");
            if (!guildId || !channelId || rest.length > 0) {
                throw invalidICQQParam("ICQQ 频道 scene_id 必须为 {guild_id}:{channel_id}", {
                    scene_id: sceneId.string,
                });
            }
            const result = await this.requireNativeClient(uin).sendGuildMsg(
                guildId,
                channelId,
                icqqMessage,
            );
            messageId = `${guildId}:${channelId}:${result.seq}:${result.rand}:${result.time}`;
        } else {
            throw invalidICQQParam(`ICQQ 不支持消息场景 ${scene_type}`, { scene_type });
        }

        if (!messageId)
            throw new ICQQError("ICQQ 发送消息响应缺少 message_id", {
                code: "ICQQ_INVALID_RESPONSE",
                operation: "sendMessage",
            });

        return {
            message_id: this.createId(messageId),
        };
    }

    /**
     * 删除/撤回消息
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const bot = this.requireBot(uin);
        const accepted = await bot.recallMessage(
            this.coerceId(params.message_id as CommonTypes.Id | string | number).string,
        );
        this.assertNativeAccepted(accepted, "撤回消息");
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const bot = this.requireBot(uin);
        const msg = await bot.getMessage(
            this.coerceId(params.message_id as CommonTypes.Id | string | number).string,
        );
        if (!msg) throw icqqResourceNotFound("消息", params.message_id.string);
        return this.convertNativeMessage(msg);
    }

    async getMessageHistory(
        uin: string,
        params: Adapter.GetMessageHistoryParams,
    ): Promise<Adapter.MessageInfo[]> {
        const client = this.requireNativeClient(uin);
        const sceneId = this.numericId(params.scene_id.string, "scene_id");
        const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
        const messages = params.start_message_id
            ? (await client.getChatHistory(params.start_message_id.string, limit + 1))
                  .filter(message => message.message_id !== params.start_message_id?.string)
                  .slice(-limit)
            : params.scene_type === "group"
              ? await client.pickGroup(sceneId).getChatHistory(params.offset, limit)
              : await client.pickUser(sceneId).getChatHistory(params.offset, limit);
        return messages.map(message => this.convertNativeMessage(message));
    }

    async getForwardMessage(
        uin: string,
        params: Adapter.GetForwardMessageParams,
    ): Promise<Adapter.MessageInfo[]> {
        const client = this.requireNativeClient(uin);
        const resourceId = params.resource_id ?? params.message_id?.string;
        if (!resourceId)
            throw invalidICQQParam("获取合并转发消息需要 resource_id 或 message_id", params);
        const messages = await client.getForwardMsg(resourceId);
        return messages.map((message, index) =>
            this.convertNativeMessage(message, `${resourceId}:${index}`),
        );
    }

    async markMessageAsRead(uin: string, params: Adapter.MarkMessageAsReadParams): Promise<void> {
        const client = this.requireNativeClient(uin);
        if (params.message_id) {
            await client.reportReaded(params.message_id.string);
            return;
        }
        const sceneId = this.numericId(params.scene_id.string, "scene_id");
        if (params.scene_type === "group") {
            await client.pickGroup(sceneId).markRead();
        } else {
            await client.pickUser(sceneId).markRead();
        }
    }

    async getResourceTempUrl(
        _uin: string,
        params: Adapter.GetResourceTempUrlParams,
    ): Promise<string> {
        const url = this.resourceUrls?.get(params.resource_id);
        if (!url) throw icqqResourceNotFound("临时资源", params.resource_id);
        return url;
    }

    // ============================================
    // 用户相关方法
    // ============================================

    /**
     * 获取机器人自身信息
     */
    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const bot = this.requireBot(uin);
        const info = bot.getLoginInfo();

        if (!info)
            throw new ICQQError("ICQQ Bot 尚未就绪", {
                code: "ICQQ_NOT_READY",
                operation: "getLoginInfo",
            });

        return {
            user_id: this.createId(info.user_id.toString()),
            user_name: info.nickname,
            user_displayname: info.nickname,
            avatar: info.avatar,
        };
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const bot = this.requireBot(uin);
        const userId = this.numericId(params.user_id.string, "user_id");
        const info = await bot.getStrangerInfo(userId);

        return {
            user_id: this.createId(info.user_id.toString()),
            user_name: info.nickname,
            user_displayname: info.nickname,
            avatar: info.avatar,
            qid: info.qid,
            age: info.age,
            sex: info.sex,
            remark: info.remark,
            bio: info.bio,
            level: info.level,
            area: info.area,
        };
    }

    async setAvatar(uin: string, params: Adapter.SetAvatarParams): Promise<void> {
        await this.requireNativeClient(uin).setAvatar(
            await materializeICQQMediaSource(params.source),
        );
    }

    async setNickname(uin: string, params: Adapter.SetNicknameParams): Promise<void> {
        this.assertNativeAccepted(
            await this.requireNativeClient(uin).setNickname(params.nickname),
            "设置昵称",
        );
    }

    async setBio(uin: string, params: Adapter.SetBioParams): Promise<void> {
        this.assertNativeAccepted(
            await this.requireNativeClient(uin).setSignature(params.bio),
            "设置个性签名",
        );
    }

    async getCustomFaceUrlList(uin: string): Promise<string[]> {
        return this.requireNativeClient(uin).getRoamingStamp();
    }

    // ============================================
    // 好友相关方法
    // ============================================

    /**
     * 获取好友列表
     */
    async getFriendList(
        uin: string,
        params?: Adapter.GetFriendListParams,
    ): Promise<Adapter.FriendInfo[]> {
        const bot = this.requireBot(uin);
        const friends = await bot.getFriendList(params?.no_cache);

        return friends.map(friend => ({
            user_id: this.createId(friend.user_id.toString()),
            user_name: friend.nickname,
            remark: friend.remark,
            sex: friend.sex,
            category_id: friend.class_id,
            category_name: friend.class_name,
        }));
    }

    /**
     * 获取好友信息
     */
    async getFriendInfo(
        uin: string,
        params: Adapter.GetFriendInfoParams,
    ): Promise<Adapter.FriendInfo> {
        const bot = this.requireBot(uin);
        const userId = this.numericId(params.user_id.string, "user_id");
        const info = await bot.getFriendInfo(userId, params.no_cache);
        if (!info) throw icqqResourceNotFound("好友", userId);

        return {
            user_id: this.createId(info.user_id.toString()),
            user_name: info.nickname,
            remark: info.remark,
            sex: info.sex,
            category_id: info.class_id,
            category_name: info.class_name,
        };
    }

    /** 同意或拒绝好友申请；flag 必须来自原始申请事件。 */
    async handleFriendRequest(
        uin: string,
        params: Adapter.HandleFriendRequestParams,
    ): Promise<void> {
        const bot = this.requireBot(uin);
        if (params.is_filtered) throw invalidICQQParam("ICQQ 不支持处理风险过滤好友申请");
        if (!params.approve && params.reason) throw invalidICQQParam("ICQQ 不支持发送好友拒绝理由");

        let flag = params.flag ?? params.request_id?.string;
        if (params.initiator_uid) {
            const client = this.requireNativeClient(uin);
            const requests = (await client.getSystemMsg()).filter(
                (event): event is FriendRequestEvent => event.request_type === "friend",
            );
            const initiatorUids = await client.uin2uids(requests.map(event => event.user_id));
            const index = initiatorUids.indexOf(params.initiator_uid);
            flag = index < 0 ? undefined : requests[index]?.flag;
        }
        if (!flag) throw icqqResourceNotFound("好友申请", params.request_id?.string);

        const accepted = await bot.handleFriendRequest(flag, params.approve, params.remark);
        if (!accepted) {
            throw icqqOperationRejected(`${params.approve ? "同意" : "拒绝"}好友申请`);
        }
    }

    async deleteFriend(uin: string, params: Adapter.DeleteFriendParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin).deleteFriend(
            this.numericId(params.user_id.string, "user_id"),
        );
        this.assertNativeAccepted(accepted, "删除好友");
    }

    async sendFriendNudge(uin: string, params: Adapter.SendFriendNudgeParams): Promise<void> {
        const accepted = await this.requireNativeClient(uin)
            .pickFriend(this.numericId(params.user_id.string, "user_id"))
            .poke(params.is_self);
        this.assertNativeAccepted(accepted, "发送好友戳一戳");
    }

    async sendLike(uin: string, params: Adapter.SendLikeParams): Promise<void> {
        const times = params.times ?? params.count ?? 1;
        const accepted = await this.requireNativeClient(uin)
            .pickUser(this.numericId(params.user_id.string, "user_id"))
            .thumbUp(times);
        this.assertNativeAccepted(accepted, "发送好友赞");
    }

    async getFriendRequests(
        uin: string,
        params?: Adapter.GetFriendRequestsParams,
    ): Promise<Adapter.FriendRequest[]> {
        if (params?.is_filtered) return [];
        const client = this.requireNativeClient(uin);
        const requests = (await client.getSystemMsg()).filter(
            (event): event is FriendRequestEvent => event.request_type === "friend",
        );
        const selected = params?.limit === undefined ? requests : requests.slice(0, params.limit);
        const [initiatorUids, targetUid] = await Promise.all([
            client.uin2uids(selected.map(event => event.user_id)),
            client.uin2uid(client.uin),
        ]);
        return selected.map((event, index) => ({
            request_id: this.createId(event.flag),
            user_id: this.createId(event.user_id),
            user_name: event.nickname,
            message: event.comment,
            time: event.time,
            initiator_uid: initiatorUids[index],
            target_user_id: this.createId(client.uin),
            target_user_uid: targetUid,
            state: "pending",
            via: event.source,
            is_filtered: false,
        }));
    }

    /** ICQQ 原生客户端只在适配器实现内部可见，不越过通用 Adapter seam。 */
    protected requireNativeClient(uin: string): Client {
        const client = this.requireBot(uin).getClient();
        if (!client)
            throw new ICQQError(`ICQQ 账号 ${uin} 尚未连接`, {
                code: "ICQQ_NOT_CONNECTED",
                category: ErrorCategory.RUNTIME,
                details: { uin },
            });
        return client;
    }

    protected requireAccount(uin: string): Account<"icqq", ICQQBot> {
        const account = this.getAccount(uin);
        if (!account)
            throw new ICQQError(`ICQQ 账号 ${uin} 不存在`, {
                code: "ICQQ_ACCOUNT_NOT_FOUND",
                category: ErrorCategory.RESOURCE,
                details: { uin },
            });
        return account;
    }

    protected requireBot(uin: string): ICQQBot {
        return this.requireAccount(uin).client;
    }

    protected assertNativeAccepted(accepted: boolean, operation: string): void {
        if (!accepted) throw icqqOperationRejected(operation);
    }

    protected numericId(value: string, field: string): number {
        return parseICQQNumericId(value, field);
    }

    protected convertNativeMessage(
        message: PrivateMessage | GroupMessage | ForwardMessage,
        fallbackMessageId?: string,
    ): Adapter.MessageInfo {
        const groupId = message.message_type === "group" ? message.group_id : undefined;
        const isGroup = groupId !== undefined;
        const messageId = "message_id" in message ? message.message_id : fallbackMessageId;
        if (!messageId) throw invalidICQQParam("ICQQ 消息缺少可用的 message_id", message);
        const senderName = "sender" in message ? message.sender?.nickname : message.nickname;
        const segments = projectICQQMessageSegments(message.message);
        this.rememberResourceUrls(segments);
        return {
            message_id: this.createId(messageId),
            time: message.time,
            sender: {
                scene_type: isGroup ? "group" : "private",
                sender_id: this.createId(message.user_id),
                scene_id: this.createId(groupId ?? message.user_id),
                sender_name: senderName ?? "",
                scene_name: isGroup && "group_name" in message ? message.group_name : "",
            },
            message: segments,
        };
    }

    private rememberResourceUrls(segments: CommonTypes.Segment[]): void {
        const resources = (this.resourceUrls ??= new Map());
        for (const segment of segments) {
            if (segment.type !== "image" && segment.type !== "record" && segment.type !== "video") {
                continue;
            }
            const id = segment.data.file;
            const url = segment.data.url;
            if (typeof id !== "string" || !id || typeof url !== "string" || !url) continue;
            resources.delete(id);
            resources.set(id, url);
        }
        while (resources.size > 1000) {
            const oldest = resources.keys().next().value;
            if (typeof oldest !== "string") break;
            resources.delete(oldest);
        }
    }
}
