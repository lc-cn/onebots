import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    readPackageVersion,
    readPackageVersionFile,
} from "onebots";
import { createDingTalkAccount } from "./account.js";
import { DingTalkBot } from "./bot.js";
import { dingTalkCapabilities } from "./capabilities.js";
import { DingTalkError } from "./errors.js";
import { buildDingTalkOutboundMessage, dingtalkMessageId } from "./messages.js";
import { DINGTALK_PLATFORM_ACTIONS, executeDingTalkPlatformAction } from "./platform-actions.js";
import type { DingTalkUser } from "./types.js";

interface SceneGroupResponse {
    result?: {
        open_conversation_id?: string;
        title?: string;
        owner_user_id?: string;
        member_user_ids?: string[];
    };
}

export class DingTalkAdapter extends Adapter<DingTalkBot, "dingtalk"> {
    constructor(app: BaseApp) {
        super(app, "dingtalk", dingTalkCapabilities);
        this.icon = "https://open.dingtalk.com/favicon.ico";
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const bot = this.requireBot(uin);
        const scene =
            params.scene_type === "private" || params.scene_type === "direct" ? "private" : "group";
        const message = buildDingTalkOutboundMessage(params.message, {
            resolveUserId: value => String(this.resolveId(value).source),
        });
        const result = await bot.sendMessage(params.scene_id.string, scene, message);
        return { message_id: this.createId(dingtalkMessageId(result)) };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const scene = params.scene_type;
        if (scene !== "private" && scene !== "direct" && scene !== "group") {
            throw DingTalkError.invalid(
                "撤回钉钉机器人消息必须提供 private、direct 或 group 场景",
                "DINGTALK_RECALL_SCENE_REQUIRED",
            );
        }
        if (params.message_id.string.startsWith("webhook:")) {
            throw DingTalkError.invalid(
                "自定义机器人 Webhook 不返回可撤回的 processQueryKey",
                "DINGTALK_WEBHOOK_MESSAGE_NOT_RECALLABLE",
            );
        }
        const bot = this.requireBot(uin);
        const robotCode = bot.config.robot_code || bot.config.app_key;
        if (!robotCode) {
            throw DingTalkError.config(
                "撤回钉钉机器人消息必须配置 robot_code 或 app_key",
                "DINGTALK_ROBOT_CODE_REQUIRED",
            );
        }
        const body: Record<string, unknown> = {
            robotCode,
            processQueryKeys: [params.message_id.string],
        };
        if (scene === "group") {
            if (!params.scene_id) {
                throw DingTalkError.invalid(
                    "撤回钉钉群消息必须提供 scene_id",
                    "DINGTALK_RECALL_GROUP_REQUIRED",
                );
            }
            body.openConversationId = params.scene_id.string;
        }
        await bot.callApi(
            scene === "group"
                ? "/v1.0/robot/groupMessages/recall"
                : "/v1.0/robot/otoMessages/batchRecall",
            { method: "POST", body },
        );
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const bot = this.requireBot(uin);
        const me = bot.getCachedMe();
        return {
            user_id: this.createId(me?.userid || bot.getPlatformBotId()),
            user_name: me?.name || "钉钉机器人",
            user_displayname: me?.name || "钉钉机器人",
            avatar: me?.avatar,
        };
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        return this.toUserInfo(await this.requireBot(uin).getUserInfo(params.user_id.string));
    }

    /** 钉钉没有好友模型，以应用可见的完整组织通讯录投影。 */
    async getFriendList(uin: string): Promise<Adapter.FriendInfo[]> {
        const users = await this.requireBot(uin).getVisibleUsers();
        return users.map(user => ({
            user_id: this.createId(user.userid),
            user_name: user.name,
            remark: user.name,
        }));
    }

    async getFriendInfo(
        uin: string,
        params: Adapter.GetFriendInfoParams,
    ): Promise<Adapter.FriendInfo> {
        const user = await this.requireBot(uin).getUserInfo(params.user_id.string);
        return {
            user_id: this.createId(user.userid),
            user_name: user.name,
            remark: user.name,
        };
    }

    /** 获取场景群信息；普通群必须先具备对应开放平台上下文。 */
    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const response = await this.requireBot(uin).callApi<SceneGroupResponse>(
            "/topapi/im/chat/scenegroup/get",
            {
                method: "POST",
                auth: "legacy",
                body: { open_conversation_id: params.group_id.string },
            },
        );
        const group = response.result;
        return {
            group_id: this.createId(group?.open_conversation_id || params.group_id.string),
            group_name: group?.title || "",
        };
    }

    async setGroupName(uin: string, params: Adapter.SetGroupNameParams): Promise<void> {
        await this.requireBot(uin).callApi("/topapi/im/chat/scenegroup/update", {
            method: "POST",
            auth: "legacy",
            body: { open_conversation_id: params.group_id.string, title: params.group_name },
        });
    }

    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const members = await this.requireBot(uin).getSceneGroupMembers(params.group_id.string);
        return members.map(member => ({
            group_id: params.group_id,
            user_id: this.createId(member.userId),
            user_name: member.nickname || member.userId,
            card: member.nickname,
            role: "member",
        }));
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const bot = this.requireBot(uin);
        const member = (await bot.getSceneGroupMembers(params.group_id.string)).find(
            item => item.userId === params.user_id.string,
        );
        if (!member) {
            throw DingTalkError.resource(
                `钉钉用户 ${params.user_id.string} 不是场景群 ${params.group_id.string} 的成员`,
                "DINGTALK_GROUP_MEMBER_NOT_FOUND",
                { group_id: params.group_id.string, user_id: params.user_id.string },
            );
        }
        const user = await bot.getUserInfo(member.userId);
        return {
            group_id: params.group_id,
            user_id: this.createId(user.userid),
            user_name: user.name,
            card: member.nickname,
            role: "member",
        };
    }

    async inviteGroupMember(uin: string, params: Adapter.InviteGroupMemberParams): Promise<void> {
        await this.updateSceneGroupMembers(
            uin,
            params.group_id.string,
            params.user_id.string,
            "add",
        );
    }

    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        await this.updateSceneGroupMembers(
            uin,
            params.group_id.string,
            params.user_id.string,
            "delete",
        );
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!DINGTALK_PLATFORM_ACTIONS.has(action)) {
            return super.executePlatformAction(uin, action, params);
        }
        return executeDingTalkPlatformAction(this.requireBot(uin), action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return DINGTALK_PLATFORM_ACTIONS.has(action);
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        const [adapterVersion, sdkVersion] = await Promise.all([
            readPackageVersion(import.meta.url),
            readPackageVersionFile(
                new URL("../package.json", import.meta.resolve("dingtalk-stream")),
            ),
        ]);
        return {
            app_name: "onebots 钉钉 Adapter",
            app_version: adapterVersion,
            impl: "dingtalk",
            version: sdkVersion,
            impl_version: sdkVersion,
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        const online = account?.status === AccountStatus.Online;
        return {
            online,
            good: online,
            bots: account
                ? [{ self: this.createId(account.client.getPlatformBotId()), online }]
                : [],
        };
    }

    createAccount(config: Account.Config<"dingtalk">): Account<"dingtalk", DingTalkBot> {
        return createDingTalkAccount(this, config);
    }

    private requireBot(uin: string): DingTalkBot {
        const account = this.getAccount(uin);
        if (!account) {
            throw DingTalkError.resource(`钉钉账号 ${uin} 不存在`, "DINGTALK_ACCOUNT_NOT_FOUND", {
                account_id: uin,
            });
        }
        return account.client;
    }

    private toUserInfo(user: DingTalkUser): Adapter.UserInfo {
        return {
            user_id: this.createId(user.userid),
            user_name: user.name,
            user_displayname: user.name,
            avatar: user.avatar,
        };
    }

    private async updateSceneGroupMembers(
        uin: string,
        groupId: string,
        userId: string,
        operation: "add" | "delete",
    ): Promise<void> {
        await this.requireBot(uin).callApi(`/topapi/im/chat/scenegroup/member/${operation}`, {
            method: "POST",
            auth: "legacy",
            body: { open_conversation_id: groupId, user_ids: [userId] },
        });
    }
}

AdapterRegistry.register("dingtalk", DingTalkAdapter, {
    name: "dingtalk",
    displayName: "钉钉官方机器人",
    description: "钉钉官方机器人适配器，支持 Stream、HTTP 回调和开放平台 API",
    icon: "https://open.dingtalk.com/favicon.ico",
    homepage: "https://open.dingtalk.com/",
    author: "凉菜",
    capabilities: dingTalkCapabilities,
});
