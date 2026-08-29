/**
 * 飞书适配器
 * 继承 Adapter 基类，实现飞书平台功能
 */
import {
    Account,
    AdapterRegistry,
    AccountStatus,
    readPackageVersion,
    toUnixSeconds,
} from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { FeishuBot } from "./bot.js";
import { type CommonTypes } from "onebots";
import { type FeishuConfig, type FeishuAPIResponse, type FeishuMessage } from "./types.js";
import { feishuCapabilities } from "./capabilities.js";
import { createFeishuAccount } from "./account.js";
import { executeFeishuPlatformAction, FEISHU_PLATFORM_ACTIONS } from "./platform-actions.js";
import { projectFeishuMessageSegments } from "./events.js";
import { compileFeishuMessage } from "./messages.js";

export class FeishuAdapter extends Adapter<FeishuBot, "feishu"> {
    constructor(app: BaseApp) {
        super(app, "feishu", feishuCapabilities);
        this.icon = "https://open.feishu.cn/favicon.ico";
    }

    /**
     * 判断是否为 Lark（国际版）
     */
    private isLarkEndpoint(endpoint: string): boolean {
        return endpoint.includes("larksuite.com");
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!FEISHU_PLATFORM_ACTIONS.has(action)) {
            return super.executePlatformAction(uin, action, params);
        }
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        return executeFeishuPlatformAction(account.client, action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return FEISHU_PLATFORM_ACTIONS.has(action);
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
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const { scene_type } = params;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);
        const compiled = await compileFeishuMessage(params.message, {
            client: bot,
            resolveUserId: value => String(this.resolveId(value).source),
        });

        // 根据场景类型发送消息
        let receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id" = "open_id";

        if (scene_type === "private" || scene_type === "direct") {
            receiveIdType = "open_id";
        } else if (scene_type === "group" || scene_type === "channel") {
            receiveIdType = "chat_id";
        }

        const result = compiled.replyTo
            ? ((await bot.callApi(`/im/v1/messages/${encodeURIComponent(compiled.replyTo)}/reply`, {
                  method: "POST",
                  body: {
                      msg_type: compiled.msgType,
                      content: JSON.stringify(compiled.content),
                  },
              })) as import("./types.js").FeishuSendMessageResponse)
            : await bot.sendMessage(
                  sceneId.string,
                  receiveIdType,
                  compiled.content,
                  compiled.msgType,
              );

        const messageId = result.data?.message_id;
        if (!messageId) {
            throw new Error("发送消息失败: 响应中缺少 message_id");
        }

        return {
            message_id: this.createId(messageId),
        };
    }

    /**
     * 删除/撤回消息
     */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msgId = this.coerceId(params.message_id as CommonTypes.Id | string | number).string;
        // 飞书删除消息 API
        const http = bot.getHttpClient();
        await http.delete(`/im/v1/messages/${encodeURIComponent(msgId)}`);
    }

    /**
     * 获取消息
     */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msgId = this.coerceId(params.message_id as CommonTypes.Id | string | number).string;

        // 飞书获取消息 API
        const http = bot.getHttpClient();
        const response = await http.get<FeishuAPIResponse>(
            `/im/v1/messages/${encodeURIComponent(msgId)}`,
        );

        if (response.data.code !== 0) {
            throw new Error(`获取消息失败: ${response.data.msg}`);
        }

        const dataPayload = response.data.data as { items?: FeishuMessage[] } | undefined;
        const items = dataPayload?.items;
        const msg = Array.isArray(items) && items.length > 0 ? items[0] : undefined;
        if (!msg) {
            throw new Error("获取消息失败: 响应中无消息内容");
        }

        const senderId = msg.sender?.id ?? "";

        return {
            message_id: this.createId(msg.message_id),
            time: toUnixSeconds(msg.create_time),
            sender: {
                scene_type: msg.chat_id ? "group" : "private",
                sender_id: this.createId(senderId),
                scene_id: this.createId(msg.chat_id || senderId),
                sender_name: senderId,
                scene_name: "",
            },
            message: projectFeishuMessageSegments(msg as unknown as Record<string, unknown>),
        };
    }

    /**
     * 更新消息
     */
    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const msgId = this.coerceId(params.message_id as CommonTypes.Id | string | number).string;

        const compiled = await compileFeishuMessage(params.message, {
            client: bot,
            resolveUserId: value => String(this.resolveId(value).source),
        });
        if (compiled.replyTo) throw new Error("飞书更新消息不能改变回复关系");
        if (compiled.msgType !== "interactive") {
            throw new Error("飞书开放平台只支持更新 interactive 消息卡片");
        }

        await bot.callApi(`/im/v1/messages/${encodeURIComponent(msgId)}`, {
            method: "PATCH",
            body: {
                content: JSON.stringify(compiled.content),
            },
        });
    }

    // ============================================
    // 用户相关方法
    // ============================================

    /**
     * 获取机器人自身信息
     */
    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const me = bot.getCachedMe();

        return {
            user_id: this.createId(me?.user_id || me?.open_id || ""),
            user_name: me?.name || "",
            user_displayname: me?.nickname || me?.name || "",
            avatar: me?.avatar_url || me?.avatar_big,
        };
    }

    /**
     * 获取用户信息
     */
    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = params.user_id.string;
        const user = await bot.getUserInfo(userId);

        return {
            user_id: this.createId(user.user_id || user.open_id),
            user_name: user.name || "",
            user_displayname: user.nickname || user.name || "",
            avatar: user.avatar_url || user.avatar_big,
        };
    }

    // ============================================
    // 好友（私聊会话）相关方法
    // ============================================

    /** 获取应用可见范围内的通讯录用户。 */
    async getFriendList(
        uin: string,
        _params?: Adapter.GetFriendListParams,
    ): Promise<Adapter.FriendInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const users = await account.client.getUserList();
        return users.map(user => ({
            user_id: this.createId(user.open_id || user.user_id),
            user_name: user.name || "",
            remark: user.nickname || user.name || "",
        }));
    }

    /**
     * 获取好友信息
     */
    async getFriendInfo(
        uin: string,
        params: Adapter.GetFriendInfoParams,
    ): Promise<Adapter.FriendInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = params.user_id.string;
        const user = await bot.getUserInfo(userId);

        return {
            user_id: this.createId(user.user_id || user.open_id),
            user_name: user.name || "",
            remark: user.nickname || user.name || "",
        };
    }

    // ============================================
    // 群组相关方法
    // ============================================

    /** 获取机器人所在的群聊列表。 */
    async getGroupList(
        uin: string,
        _params?: Adapter.GetGroupListParams,
    ): Promise<Adapter.GroupInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        const chats = await account.client.getChatList();
        return chats.map(chat => ({
            group_id: this.createId(chat.chat_id),
            group_name: chat.name || "",
        }));
    }

    /**
     * 获取群信息
     */
    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const chatId = params.group_id.string;
        const chat = await bot.getChatInfo(chatId);

        return {
            group_id: this.createId(chat.chat_id),
            group_name: chat.name || "",
        };
    }

    /** 更新群名称。 */
    async setGroupName(uin: string, params: Adapter.SetGroupNameParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
        await account.client.put(`/im/v1/chats/${params.group_id.string}`, {
            name: params.group_name,
        });
    }

    /**
     * 退出群组
     */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const chatId = params.group_id.string;

        const me = bot.getCachedMe();
        if (!me?.open_id) throw new Error("飞书机器人身份尚未初始化");
        await bot.delete(
            `/im/v1/chats/${chatId}/members`,
            { id_list: [me.open_id] },
            { member_id_type: "open_id" },
        );
    }

    /**
     * 获取群成员列表
     */
    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const chatId = params.group_id.string;
        const members = await bot.getChatMembers(chatId);

        return members.map(user => ({
            group_id: params.group_id,
            user_id: this.createId(user.user_id || user.open_id),
            user_name: user.name || "",
            card: user.nickname || user.name || "",
            role: "member",
        }));
    }

    /**
     * 获取群成员信息
     */
    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userId = params.user_id.string;
        const user = await bot.getUserInfo(userId);

        return {
            group_id: params.group_id,
            user_id: this.createId(user.user_id || user.open_id),
            user_name: user.name || "",
            card: user.nickname || user.name || "",
            role: "member",
        };
    }

    /**
     * 踢出群成员
     */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const chatId = params.group_id.string;
        const userId = params.user_id.string;

        await bot.delete(
            `/im/v1/chats/${chatId}/members`,
            { id_list: [userId] },
            { member_id_type: "open_id" },
        );
    }

    // ============================================
    // 系统相关方法
    // ============================================

    /**
     * 获取版本信息
     */
    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        const account = this.getAccount(uin);
        const isLark = account ? this.isLarkEndpoint(account.client.endpoint) : false;
        const platformName = isLark ? "Lark" : "飞书";
        const [appVersion, sdkVersion] = await Promise.all([
            readPackageVersion(import.meta.url),
            readPackageVersion(import.meta.resolve("@larksuiteoapi/node-sdk")),
        ]);

        return {
            app_name: `onebots ${platformName} Adapter`,
            app_version: appVersion,
            impl: "@larksuiteoapi/node-sdk",
            version: sdkVersion,
        };
    }

    /**
     * 获取运行状态
     */
    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        return {
            online: account?.status === AccountStatus.Online,
            good: account?.status === AccountStatus.Online,
        };
    }

    // ============================================
    // 账号创建
    // ============================================

    createAccount(config: Account.Config<"feishu">): Account<"feishu", FeishuBot> {
        return createFeishuAccount(this, config);
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            feishu: FeishuConfig;
        }
    }
}

AdapterRegistry.register("feishu", FeishuAdapter, {
    name: "feishu",
    displayName: "飞书官方机器人",
    description: "飞书官方机器人适配器，支持单聊、群聊和富文本消息",
    icon: "https://open.feishu.cn/favicon.ico",
    homepage: "https://open.feishu.cn/",
    author: "凉菜",
    capabilities: feishuCapabilities,
});
