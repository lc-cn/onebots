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

interface SceneGroupMemberResponse {
    result?: {
        member_user_ids?: string[];
        next_cursor?: string;
        has_more?: boolean;
        staff_id_nick_map?: Record<string, string> | string;
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
        const message = buildDingTalkOutboundMessage(params.message);
        const result = await bot.sendMessage(params.scene_id.string, scene, message);
        return { message_id: this.createId(dingtalkMessageId(result)) };
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const me = this.requireBot(uin).getCachedMe();
        return {
            user_id: this.createId(me?.userid || this.getAccount(uin)?.config.account_id || uin),
            user_name: me?.name || "钉钉机器人",
            user_displayname: me?.name || "钉钉机器人",
            avatar: me?.avatar,
        };
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        return this.toUserInfo(await this.requireBot(uin).getUserInfo(params.user_id.string));
    }

    /** 钉钉没有好友模型，以应用可见的根部门通讯录投影。 */
    async getFriendList(uin: string): Promise<Adapter.FriendInfo[]> {
        const users = await this.requireBot(uin).getDepartmentUsers();
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
        const bot = this.requireBot(uin);
        const members: Adapter.GroupMemberInfo[] = [];
        let cursor = "0";
        do {
            const response = await bot.callApi<SceneGroupMemberResponse>(
                "/topapi/im/chat/scenegroup/member/get",
                {
                    method: "POST",
                    auth: "legacy",
                    body: { open_conversation_id: params.group_id.string, cursor, size: 100 },
                },
            );
            const result = response.result;
            const nicknames = nicknameMap(result?.staff_id_nick_map);
            for (const userId of result?.member_user_ids || []) {
                members.push({
                    group_id: params.group_id,
                    user_id: this.createId(userId),
                    user_name: nicknames[userId] || userId,
                    card: nicknames[userId],
                    role: "member",
                });
            }
            cursor = result?.has_more ? result.next_cursor || "" : "";
        } while (cursor);
        return members;
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const user = await this.requireBot(uin).getUserInfo(params.user_id.string);
        return {
            group_id: params.group_id,
            user_id: this.createId(user.userid),
            user_name: user.name,
            card: user.name,
            role: user.admin ? "admin" : "member",
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
        return {
            online: account?.status === AccountStatus.Online,
            good: account?.status === AccountStatus.Online,
        };
    }

    createAccount(config: Account.Config<"dingtalk">): Account<"dingtalk", DingTalkBot> {
        return createDingTalkAccount(this, config);
    }

    private requireBot(uin: string): DingTalkBot {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);
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

function nicknameMap(value: Record<string, string> | string | undefined): Record<string, string> {
    if (!value) return {};
    if (typeof value === "object") return value;
    try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, string>)
            : {};
    } catch {
        return {};
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
