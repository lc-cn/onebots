import {
    type Account as DouyinAccount,
    type ChatContact,
    type Friend,
    type Group,
    type GroupJoinRequest,
    type Stranger,
} from "douyin-im";
import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    AdapterError,
    readPackageVersion,
    type CommonTypes,
} from "onebots";
import { DouyinAccountFactory } from "./account.js";
import { douyinCapabilities } from "./capabilities.js";
import { compileDouyinMessage } from "./messages.js";
import type { DouyinConfig } from "./types.js";
import { DouyinVerificationProxy } from "./verification-proxy.js";

const GROUP_REQUEST_TTL_MS = 15 * 60 * 1000;
const MAX_GROUP_REQUESTS = 1_024;

interface RememberedGroupRequest {
    request: GroupJoinRequest;
    expiresAt: number;
}

export class DouyinAdapter extends Adapter<DouyinAccount, "douyin"> {
    private readonly accountFactory: DouyinAccountFactory;
    private readonly groupRequests = new Map<string, RememberedGroupRequest>();
    private readonly verificationProxy: DouyinVerificationProxy;

    constructor(app: BaseApp) {
        super(app, "douyin", douyinCapabilities);
        this.icon = "https://lf1-cdn-tos.bytegoofy.com/goofy/ies/douyin_web/public/favicon.ico";
        this.verificationProxy = new DouyinVerificationProxy(app);
        this.accountFactory = new DouyinAccountFactory(this);
    }

    publishVerificationPage(accountId: string, type: string, localUrl: string): string {
        return this.verificationProxy.publish(accountId, type, localUrl);
    }

    revokeVerificationPage(accountId: string, type?: string): void {
        this.verificationProxy.revoke(accountId, type);
    }

    createAccount(config: Account.Config<"douyin">): Account<"douyin", DouyinAccount> {
        return this.accountFactory.create(config);
    }

    override resolveAccountStartupTimeoutSeconds(config: Account.Config<"douyin">): number {
        return Math.max(
            super.resolveAccountStartupTimeoutSeconds(config),
            config.login_timeout_seconds ?? 300,
        );
    }

    override async submitVerification(
        accountId: string,
        type: string,
        data: Record<string, unknown>,
    ): Promise<void> {
        const account = this.requireSdkAccount(accountId);
        if (data.action === "request-voice") {
            await account.requestLoginVoiceCode();
            return;
        }
        if (type === "sms" || type === "voice" || type === "sms-required") {
            const code = stringValue(data.code ?? data.value);
            if (!code) throw fault("PARAM_INVALID", "请输入抖音验证码");
            await account.continueLoginWithSms(code);
            return;
        }
        if (type === "account-select") {
            const action = stringValue(data.action);
            if (action === "register-new") {
                await account.continueLoginWithSubAccount({ registerNewUser: true });
                return;
            }
            if (action?.startsWith("select:")) {
                await account.continueLoginWithSubAccount({ secUid: action.slice(7) });
                return;
            }
        }
        throw fault("VERIFICATION_TYPE_UNSUPPORTED", `抖音不支持验证类型 ${type}`);
    }

    override requestSmsCode(accountId: string): Promise<void> {
        return this.requireSdkAccount(accountId).requestLoginSmsCode();
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const sdk = this.requireSdkAccount(uin);
        const operations = compileDouyinMessage(params.message, value => {
            if (value && typeof value === "object" && "source" in value) {
                return String((value as CommonTypes.Id).source);
            }
            return String(value ?? "");
        });
        if (operations.length !== 1) {
            throw fault(
                "MESSAGE_MULTI_OPERATION_UNSUPPORTED",
                "抖音单次 send_message 只能对应一条平台消息，请拆分文本与图片后分别发送",
            );
        }
        const contact = await this.resolveContact(sdk, params.scene_type, params.scene_id);
        const response = await contact.sendMsg(operations[0]!);
        assertSucceeded(response.statusCode, response.statusMsg, "发送消息");
        const messageId = response.serverMessageId ?? response.clientMessageId;
        if (!messageId) throw fault("UPSTREAM_INVALID", "抖音发送成功但未返回消息 ID");
        return { message_id: this.createId(messageId) };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        if (!params.scene_type || !params.scene_id) {
            throw fault("CONTEXT_REQUIRED", "抖音撤回消息需要 scene_type 和 scene_id");
        }
        const contact = await this.resolveContact(
            this.requireSdkAccount(uin),
            params.scene_type,
            params.scene_id,
        );
        const response = await contact.recallMsg(String(this.resolveId(params.message_id).source));
        assertRecallSucceeded(response.statusCode, response.statusMsg);
    }

    async markMessageAsRead(uin: string, params: Adapter.MarkMessageAsReadParams): Promise<void> {
        const contact = await this.resolveContact(
            this.requireSdkAccount(uin),
            params.scene_type,
            params.scene_id,
        );
        if (!params.message_id) {
            throw fault("PARAM_REQUIRED", "抖音标记已读需要 message_id");
        }
        const response = await contact.markRead({
            serverMessageId: String(this.resolveId(params.message_id).source),
            readBadgeCount: 1,
        });
        assertSucceeded(response.statusCode, response.statusMsg, "标记已读");
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.requireSdkAccount(uin);
        const profile = account.profile ?? (await account.getProfile());
        return {
            user_id: this.createId(profile.uid),
            user_name: profile.nickname,
            user_displayname: profile.nickname,
            avatar: profile.avatarThumb,
            remark: profile.remark,
        };
    }

    async getFriendList(
        uin: string,
        _params?: Adapter.GetFriendListParams,
    ): Promise<Adapter.FriendInfo[]> {
        // douyin-im 1.0 的 getFriendList() 没有 force 参数，并且每次都会从服务端分页刷新。
        const friends = await this.requireSdkAccount(uin).getFriendList();
        return friends.map(friend => this.projectFriend(friend));
    }

    async getFriendInfo(
        uin: string,
        params: Adapter.GetFriendInfoParams,
    ): Promise<Adapter.FriendInfo> {
        const sdk = this.requireSdkAccount(uin);
        const uid = String(this.resolveId(params.user_id).source);
        const friend =
            (params.no_cache === true ? undefined : sdk.pickFriend(uid)) ??
            (await sdk.getFriendList()).find(item => item.uid === uid);
        if (!friend) throw fault("FRIEND_NOT_FOUND", `未找到抖音好友 ${uid}`);
        return this.projectFriend(friend);
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const sdk = this.requireSdkAccount(uin);
        const uid = String(this.resolveId(params.user_id).source);
        const contact = await this.resolvePrivateContact(sdk, uid);
        const profile = await contact.getProfile();
        return {
            user_id: this.createId(profile.uid),
            user_name: profile.nickname,
            user_displayname: profile.nickname,
            avatar: profile.avatarThumb,
            remark: profile.remark,
        };
    }

    async getGroupList(
        uin: string,
        params?: Adapter.GetGroupListParams,
    ): Promise<Adapter.GroupInfo[]> {
        const groups = await this.requireSdkAccount(uin).getGroupList(params?.no_cache === true);
        return groups.map(group => this.projectGroup(group));
    }

    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const group = await this.requireGroup(
            this.requireSdkAccount(uin),
            params.group_id,
            params.no_cache,
        );
        return this.projectGroup(group);
    }

    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        if (params.is_dismiss) throw fault("PARAM_UNSUPPORTED", "抖音不支持解散群语义");
        const group = await this.requireGroup(this.requireSdkAccount(uin), params.group_id, false);
        const response = await group.leave();
        assertSucceeded(response.statusCode, response.statusMsg, "退出群聊");
    }

    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const group = await this.requireGroup(this.requireSdkAccount(uin), params.group_id, false);
        const members = await group.getMemberList(params.no_cache === true);
        return [...members.values()].map(member => ({
            group_id: params.group_id,
            user_id: this.createId(member.uid),
            user_name: member.nickname ?? member.uid,
            card: member.alias ?? "",
            avatar: member.avatar,
            role:
                member.roleName === "visitor" || member.roleName === "unknown"
                    ? "member"
                    : member.roleName,
        }));
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const refresh = params.no_cache === true;
        const group = await this.requireGroup(
            this.requireSdkAccount(uin),
            params.group_id,
            refresh,
        );
        const uid = String(this.resolveId(params.user_id).source);
        const member =
            (refresh ? undefined : group.pickMember(uid)) ??
            (await group.getMemberList(true)).get(uid);
        if (!member) throw fault("MEMBER_NOT_FOUND", `未找到抖音群成员 ${uid}`);
        return {
            group_id: params.group_id,
            user_id: this.createId(member.uid),
            user_name: member.nickname ?? member.uid,
            card: member.alias ?? "",
            role:
                member.roleName === "visitor" || member.roleName === "unknown"
                    ? "member"
                    : member.roleName,
        };
    }

    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        const group = await this.requireGroup(this.requireSdkAccount(uin), params.group_id, false);
        const response = await group.removeMembers([String(this.resolveId(params.user_id).source)]);
        assertSucceeded(response.statusCode, response.statusMsg, "移除群成员");
    }

    async inviteGroupMember(uin: string, params: Adapter.InviteGroupMemberParams): Promise<void> {
        const group = await this.requireGroup(this.requireSdkAccount(uin), params.group_id, false);
        const response = await group.inviteMembers([String(this.resolveId(params.user_id).source)]);
        assertSucceeded(response.statusCode, response.statusMsg, "邀请群成员");
    }

    async handleGroupRequest(uin: string, params: Adapter.HandleGroupRequestParams): Promise<void> {
        this.requireSdkAccount(uin);
        assertGroupRequestParams(params);
        this.pruneGroupRequests();
        const requestId =
            params.flag ??
            (params.request_id
                ? normalizeGroupRequestId(String(this.resolveId(params.request_id).source))
                : "");
        const key = groupRequestKey(uin, requestId);
        const remembered = this.groupRequests.get(key);
        if (!remembered) throw fault("REQUEST_NOT_FOUND", `未找到抖音入群申请 ${requestId}`);

        // 先 claim 再访问上游：并发调用只能有一个进入，失败也不会留下可重放的申请。
        this.groupRequests.delete(key);
        const response = await (params.approve
            ? remembered.request.approve()
            : remembered.request.reject());
        assertSucceeded(response.statusCode, response.statusMsg, "处理入群申请");
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        const online = account?.status === AccountStatus.Online;
        return { online, good: online };
    }

    async getVersion(_uin: string): Promise<Adapter.VersionInfo> {
        const [appVersion, sdkVersion] = await Promise.all([
            readPackageVersion(import.meta.url),
            readPackageVersion(import.meta.resolve("douyin-im")),
        ]);
        return {
            app_name: "onebots Douyin Adapter",
            app_version: appVersion,
            impl: "douyin-im",
            version: sdkVersion,
        };
    }

    rememberGroupRequest(request: GroupJoinRequest): void {
        const accountId = [...this.accounts].find(
            ([, account]) => account.client === request.account,
        )?.[0];
        if (!accountId) {
            this.logger.warn(`忽略无法归属账号的抖音入群申请 ${request.requestId}`);
            return;
        }
        this.pruneGroupRequests();
        const key = groupRequestKey(accountId, request.requestId);
        this.groupRequests.delete(key);
        while (this.groupRequests.size >= MAX_GROUP_REQUESTS) {
            const oldest = this.groupRequests.keys().next().value;
            if (oldest === undefined) break;
            this.groupRequests.delete(oldest);
        }
        this.groupRequests.set(key, {
            request,
            expiresAt: Date.now() + GROUP_REQUEST_TTL_MS,
        });
    }

    private pruneGroupRequests(now = Date.now()): void {
        for (const [key, remembered] of this.groupRequests) {
            if (remembered.expiresAt <= now) this.groupRequests.delete(key);
        }
    }

    private requireSdkAccount(uin: string): DouyinAccount {
        const account = this.getAccount(uin);
        if (!account) throw fault("ACCOUNT_NOT_FOUND", `未找到抖音账号 ${uin}`);
        return account.client;
    }

    private async resolveContact(
        account: DouyinAccount,
        sceneType: CommonTypes.Scene,
        sceneId: CommonTypes.Id,
    ): Promise<ChatContact> {
        const id = String(this.resolveId(sceneId).source);
        if (sceneType === "group") return this.requireGroup(account, sceneId, false);
        if (sceneType === "private" || sceneType === "direct") {
            return this.resolvePrivateContact(account, id);
        }
        throw fault("SCENE_NOT_SUPPORTED", `抖音不支持 ${sceneType} 场景`);
    }

    private async resolvePrivateContact(
        account: DouyinAccount,
        uid: string,
    ): Promise<Friend | Stranger> {
        let contact = account.pickFriend(uid) ?? account.pickStranger(uid);
        if (!contact) {
            const [friends, strangers] = await Promise.all([
                account.getFriendList(),
                account.getStrangerList(),
            ]);
            contact =
                friends.find(item => item.uid === uid) ?? strangers.find(item => item.uid === uid);
        }
        if (!contact) throw fault("USER_NOT_FOUND", `未找到抖音联系人 ${uid}`);
        return contact;
    }

    private async requireGroup(
        account: DouyinAccount,
        groupId: CommonTypes.Id,
        refresh = false,
    ): Promise<Group> {
        const id = String(this.resolveId(groupId).source);
        const group =
            (!refresh ? account.pickGroup(id) : undefined) ??
            (await account.getGroupList(refresh)).find(item => item.groupId === id);
        if (!group) throw fault("GROUP_NOT_FOUND", `未找到抖音群 ${id}`);
        return group;
    }

    private projectFriend(friend: Friend): Adapter.FriendInfo {
        return {
            user_id: this.createId(friend.uid),
            user_name: friend.nickname ?? friend.uid,
            remark: friend.remark,
        };
    }

    private projectGroup(group: Group): Adapter.GroupInfo {
        return {
            group_id: this.createId(group.groupId),
            group_name: group.name ?? group.groupId,
            member_count: group.memberCount,
            description: group.description,
            announcement: group.notice,
        };
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            douyin: DouyinConfig;
        }
    }
}

AdapterRegistry.register("douyin", DouyinAdapter, {
    name: "douyin",
    displayName: "抖音",
    description: "基于 douyin-im 的抖音私聊与群聊适配器，支持二维码、短信和密码登录",
    icon: "https://lf1-cdn-tos.bytegoofy.com/goofy/ies/douyin_web/public/favicon.ico",
    homepage: "https://github.com/zhinjs/douyin-im",
    author: "凉菜",
    capabilities: douyinCapabilities,
});

function assertSucceeded(statusCode: number, statusMessage: string, operation: string): void {
    if (statusCode !== 0) {
        throw fault("DOUYIN_API_ERROR", `${operation}失败: ${statusCode} ${statusMessage}`);
    }
}

function assertRecallSucceeded(statusCode: number, statusMessage: string): void {
    if (statusCode !== 0 && statusCode !== 200) {
        throw fault("DOUYIN_API_ERROR", `撤回消息失败: ${statusCode} ${statusMessage}`);
    }
}

function assertGroupRequestParams(params: Adapter.HandleGroupRequestParams): void {
    if (params.type !== "request") {
        throw fault("PARAM_UNSUPPORTED", "抖音当前只能处理用户主动提交的入群申请");
    }
    if (params.sub_type !== undefined && params.sub_type !== "add") {
        throw fault("PARAM_UNSUPPORTED", "抖音当前不支持处理群邀请");
    }
    if (params.block === true) {
        throw fault("PARAM_UNSUPPORTED", "抖音拒绝入群申请时不支持阻止后续申请");
    }
}

function normalizeGroupRequestId(requestId: string): string {
    return requestId.startsWith("request:") ? requestId.slice("request:".length) : requestId;
}

function groupRequestKey(accountId: string, requestId: string): string {
    return JSON.stringify([accountId, requestId]);
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fault(code: string, message: string): AdapterError {
    return new AdapterError(message, { code, context: { platform: "douyin" } });
}
