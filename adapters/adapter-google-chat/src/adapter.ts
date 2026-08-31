import {
    Account,
    AccountStatus,
    Adapter,
    BaseApp,
    readPackageVersion,
    type AdapterCapabilityManifest,
    type CommonTypes,
} from "onebots";
import {
    googleChatContentType,
    materializeGoogleChatUpload,
    normalizeGoogleChatConfig,
} from "./adapter-support.js";
import {
    googleChatGroup,
    googleChatMember,
    googleChatMessage,
    googleChatUser,
    isDirectSpace,
    paginateGoogleChat,
    requireMessageName,
    requireSpaceName,
    requireUserName,
} from "./adapter-helpers.js";
import { describeGoogleChatCapabilities, googleChatCapabilities } from "./capabilities.js";
import { GoogleChatClient } from "./client.js";
import {
    parseAttachmentUpload,
    parseCreatedMessageName,
    parseMembershipList,
    parseMessageList,
    parseMessageResponse,
    parseReactionResponse,
    parseSpaceList,
    parseSpaceResponse,
} from "./entities.js";
import { GoogleChatError } from "./errors.js";
import { projectGoogleChatEvent } from "./events.js";
import { GoogleChatHttpHost } from "./http-host.js";
import { compileGoogleChatMessage } from "./messages.js";
import {
    executeGoogleChatPlatformAction,
    GOOGLE_CHAT_PLATFORM_ACTIONS,
} from "./platform-actions.js";
import type { GoogleChatEventEnvelope, GoogleChatMembership, GoogleChatSpace } from "./types.js";

export class GoogleChatAdapter extends Adapter<GoogleChatClient, "google-chat"> {
    private readonly reactions = new Map<string, string>();
    private readonly httpHost: GoogleChatHttpHost;

    constructor(app: BaseApp) {
        super(app, "google-chat", googleChatCapabilities);
        this.icon = "https://ssl.gstatic.com/workspace/favicon/chat.ico";
        this.httpHost = new GoogleChatHttpHost(
            app,
            accountId => this.getAccount(accountId)?.client,
        );
    }

    describeCapabilities(uin?: string): AdapterCapabilityManifest {
        const config = uin ? this.getAccount(uin)?.client.config : undefined;
        return config ? describeGoogleChatCapabilities(config) : googleChatCapabilities;
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        this.assertScene(params.scene_type);
        const response = await this.requireClient(uin).call(
            "POST",
            `/v1/${requireSpaceName(params.scene_id.string)}/messages`,
            { body: compileGoogleChatMessage(params.message) },
        );
        return { message_id: this.createId(parseCreatedMessageName(response)) };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        await this.requireClient(uin).call(
            "DELETE",
            `/v1/${requireMessageName(params.message_id.string)}`,
        );
    }

    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const message = parseMessageResponse(
            await this.requireClient(uin).call(
                "GET",
                `/v1/${requireMessageName(params.message_id.string)}`,
            ),
        );
        return googleChatMessage(value => this.createId(value), this.requireClient(uin), message);
    }

    async getMessageHistory(
        uin: string,
        params: Adapter.GetMessageHistoryParams,
    ): Promise<Adapter.MessageInfo[]> {
        this.assertScene(params.scene_type);
        if (params.offset !== undefined || params.start_message_id) {
            throw new GoogleChatError(
                "Google Chat 使用不透明 pageToken；canonical offset/start_message_id 无等价语义",
                { code: "GOOGLE_CHAT_UNSUPPORTED_PAGINATION" },
            );
        }
        const client = this.requireClient(uin);
        const page = parseMessageList(
            await client.call("GET", `/v1/${requireSpaceName(params.scene_id.string)}/messages`, {
                query: { pageSize: Math.min(params.limit || 25, 1000) },
            }),
        );
        return page.items.map(message =>
            googleChatMessage(value => this.createId(value), client, message),
        );
    }

    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        const compiled = compileGoogleChatMessage(params.message);
        if (compiled.attachment?.length) {
            throw new GoogleChatError("Google Chat canonical 编辑仅支持文本，不能替换附件", {
                code: "GOOGLE_CHAT_EDIT_ATTACHMENT_UNSUPPORTED",
            });
        }
        const name = requireMessageName(params.message_id.string);
        await this.requireClient(uin).call("PATCH", `/v1/${name}`, {
            query: { updateMask: "text" },
            body: { name, text: compiled.text || "" },
        });
    }

    async markMessageAsRead(uin: string, params: Adapter.MarkMessageAsReadParams): Promise<void> {
        if (!params.message_id)
            throw GoogleChatError.invalid("mark_message_as_read 需要 message_id");
        const client = this.requireClient(uin);
        if (client.principalName === "users/app") {
            throw new GoogleChatError("Google Chat app 身份没有用户 read state", {
                code: "GOOGLE_CHAT_USER_AUTH_REQUIRED",
            });
        }
        const message = parseMessageResponse(
            await client.call("GET", `/v1/${requireMessageName(params.message_id.string)}`),
        );
        if (!message.createTime) throw GoogleChatError.invalid("消息响应缺少 createTime");
        const spaceId = requireSpaceName(params.scene_id.string).slice("spaces/".length);
        const name = `${client.principalName}/spaces/${spaceId}/spaceReadState`;
        const lastReadTime = new Date(Date.parse(message.createTime) + 1).toISOString();
        await client.call("PATCH", `/v1/${name}`, {
            query: { updateMask: "lastReadTime" },
            body: { name, lastReadTime },
        });
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const client = this.requireClient(uin);
        const user = client.getCachedUser(client.principalName);
        return googleChatUser(
            value => this.createId(value),
            client.principalName,
            user,
            client.config.app_display_name,
        );
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const client = this.requireClient(uin);
        const name = requireUserName(params.user_id.string);
        const user = client.getCachedUser(name);
        if (!user) {
            throw new GoogleChatError("Google Chat 用户尚未出现在事件或 membership 上下文中", {
                code: "GOOGLE_CHAT_USER_CONTEXT_MISSING",
                status: 404,
            });
        }
        return googleChatUser(value => this.createId(value), name, user);
    }

    async createUserChannel(
        uin: string,
        params: Adapter.CreateUserChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        const space = parseSpaceResponse(
            await this.requireClient(uin).call("GET", "/v1/spaces:findDirectMessage", {
                query: { name: requireUserName(params.user_id.string) },
            }),
        );
        return { channel_id: this.createId(space.name), channel_name: space.displayName || "DM" };
    }

    async getGroupList(uin: string): Promise<Adapter.GroupInfo[]> {
        const client = this.requireClient(uin);
        const spaces = await paginateGoogleChat(
            token => client.call("GET", "/v1/spaces", { query: { pageToken: token } }),
            parseSpaceList,
        );
        return spaces
            .filter(space => !isDirectSpace(space))
            .map(space => googleChatGroup(value => this.createId(value), space));
    }

    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        return googleChatGroup(
            value => this.createId(value),
            await this.loadSpace(this.requireClient(uin), params.group_id.string),
        );
    }

    async setGroupName(uin: string, params: Adapter.SetGroupNameParams): Promise<void> {
        const name = requireSpaceName(params.group_id.string);
        await this.requireClient(uin).call("PATCH", `/v1/${name}`, {
            query: { updateMask: "displayName" },
            body: { name, displayName: params.group_name },
        });
    }

    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        if (params.is_dismiss) {
            throw new GoogleChatError("Google Chat leaveGroup 不提供解散语义", {
                code: "GOOGLE_CHAT_DISMISS_UNSUPPORTED",
            });
        }
        const client = this.requireClient(uin);
        const space = requireSpaceName(params.group_id.string);
        if (client.principalName === "users/app") {
            await client.call("DELETE", `/v1/${space}/members/app`);
            return;
        }
        if (client.principalName === "users/me") {
            throw new GoogleChatError(
                "leave_group 需要 principal_name 使用可解析的 users/{id|email}，不能使用 users/me",
                { code: "GOOGLE_CHAT_PRINCIPAL_RESOURCE_REQUIRED" },
            );
        }
        const membership = await this.findMembership(client, space, client.principalName);
        await client.call("DELETE", `/v1/${membership.name}`);
    }

    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const memberships = await this.loadMemberships(
            this.requireClient(uin),
            params.group_id.string,
        );
        return memberships
            .filter(item => item.member)
            .map(item => googleChatMember(value => this.createId(value), item));
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        return googleChatMember(
            value => this.createId(value),
            await this.findMembership(
                this.requireClient(uin),
                params.group_id.string,
                params.user_id.string,
            ),
        );
    }

    async inviteGroupMember(uin: string, params: Adapter.InviteGroupMemberParams): Promise<void> {
        await this.requireClient(uin).call(
            "POST",
            `/v1/${requireSpaceName(params.group_id.string)}/members`,
            { body: { member: { name: requireUserName(params.user_id.string), type: "HUMAN" } } },
        );
    }

    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        if (params.reject_add_request) {
            throw new GoogleChatError("Google Chat 删除成员不支持阻止其再次加入", {
                code: "GOOGLE_CHAT_BLOCK_UNSUPPORTED",
            });
        }
        const membership = await this.findMembership(
            this.requireClient(uin),
            params.group_id.string,
            params.user_id.string,
        );
        await this.requireClient(uin).call("DELETE", `/v1/${membership.name}`);
    }

    async sendGroupMessageReaction(
        uin: string,
        params: Adapter.SendGroupMessageReactionParams,
    ): Promise<void> {
        if (params.reaction_type !== "emoji") {
            throw GoogleChatError.invalid("Google Chat reaction_type 必须是 emoji");
        }
        const client = this.requireClient(uin);
        const messageName = requireMessageName(params.message_id.string);
        const key = `${uin}\u0000${messageName}\u0000${params.reaction}`;
        if (params.is_add) {
            const reaction = parseReactionResponse(
                await client.call("POST", `/v1/${messageName}/reactions`, {
                    body: { emoji: { unicode: params.reaction } },
                }),
            );
            this.reactions.set(key, reaction.name);
            return;
        }
        const reactionName = this.reactions.get(key);
        if (!reactionName) {
            throw new GoogleChatError("缺少当前进程创建的 Google Chat reaction 上下文", {
                code: "GOOGLE_CHAT_REACTION_CONTEXT_MISSING",
            });
        }
        await client.call("DELETE", `/v1/${reactionName}`);
        this.reactions.delete(key);
    }

    async uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        this.assertScene(params.scene_type);
        const data = materializeGoogleChatUpload(params);
        const reference = parseAttachmentUpload(
            await this.requireClient(uin).call(
                "POST",
                `/upload/v1/${requireSpaceName(params.scene_id.string)}/attachments:upload`,
                {
                    query: { uploadType: "multipart" },
                    upload: data,
                    uploadMetadata: { filename: params.name },
                    contentType: googleChatContentType(params.name, params.data),
                },
            ),
        );
        const resourceName = String(reference.resourceName);
        return {
            file_id: this.createId(resourceName),
            file_name: params.name,
            file_size: data.byteLength,
            url: resourceName,
        };
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        return GOOGLE_CHAT_PLATFORM_ACTIONS.has(action)
            ? executeGoogleChatPlatformAction(this.requireClient(uin), action, params)
            : super.executePlatformAction(uin, action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return GOOGLE_CHAT_PLATFORM_ACTIONS.has(action);
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots Google Chat Adapter",
            app_version: await readPackageVersion(import.meta.url),
            impl: "Google Chat REST API",
            version: "v1",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        const online = account?.status === AccountStatus.Online;
        return {
            online,
            good: online,
            bots: account ? [{ self: this.createId(account.client.principalName), online }] : [],
        };
    }

    async canSendImage(): Promise<boolean> {
        return true;
    }

    async canSendRecord(): Promise<boolean> {
        return true;
    }

    createAccount(config: Account.Config<"google-chat">): Account<"google-chat", GoogleChatClient> {
        const accountPath = `/google-chat/${config.account_id}`;
        const client = new GoogleChatClient(normalizeGoogleChatConfig(config, accountPath), {
            reportError: error => this.logger.error("Google Chat 接收管线异常", error),
        });
        const account = new Account<"google-chat", GoogleChatClient>(this, client, config);
        client.on("event", (event: GoogleChatEventEnvelope) =>
            account.dispatchManyAwaited(
                projectGoogleChatEvent(event, {
                    botId: this.createId(client.principalName),
                    principalName: client.principalName,
                    createId: value => this.createId(value),
                }),
            ),
        );
        this.httpHost.mount(account.account_id, client);
        account.on("start", async () => {
            try {
                await client.start();
                account.status = AccountStatus.Online;
                account.nickname = config.app_display_name || client.principalName;
                this.logger.info(
                    `Google Chat ${account.account_id} 已就绪（${client.receiveMode}）`,
                );
            } catch (error) {
                account.status = AccountStatus.OffLine;
                this.logger.error(`启动 Google Chat ${account.account_id} 失败`, error);
                throw error;
            }
        });
        account.on("stop", async () => {
            try {
                await client.stop();
            } finally {
                account.status = AccountStatus.OffLine;
            }
        });
        return account;
    }

    private requireClient(uin: string): GoogleChatClient {
        const client = this.getAccount(uin)?.client;
        if (!client) {
            throw new GoogleChatError(`Google Chat 账号 ${uin} 不存在`, {
                code: "ACCOUNT_NOT_FOUND",
                status: 404,
            });
        }
        return client;
    }

    private assertScene(scene: CommonTypes.Scene): void {
        if (scene !== "group" && scene !== "direct") {
            throw GoogleChatError.invalid("Google Chat 目标必须是 group 或 direct space");
        }
    }

    private async loadSpace(client: GoogleChatClient, name: string): Promise<GoogleChatSpace> {
        const resource = requireSpaceName(name);
        return parseSpaceResponse(await client.call("GET", `/v1/${resource}`));
    }

    private async loadMemberships(
        client: GoogleChatClient,
        spaceName: string,
    ): Promise<GoogleChatMembership[]> {
        const parent = requireSpaceName(spaceName);
        return paginateGoogleChat(
            token =>
                client.call("GET", `/v1/${parent}/members`, {
                    query: { pageToken: token, showGroups: true },
                }),
            parseMembershipList,
        );
    }

    private async findMembership(
        client: GoogleChatClient,
        spaceName: string,
        userName: string,
    ): Promise<GoogleChatMembership> {
        const normalizedUser = requireUserName(userName);
        const membership = (await this.loadMemberships(client, spaceName)).find(
            item => item.member?.name === normalizedUser,
        );
        if (!membership) {
            throw new GoogleChatError("Google Chat Space 中不存在该成员", {
                code: "GOOGLE_CHAT_MEMBERSHIP_NOT_FOUND",
                status: 404,
            });
        }
        return membership;
    }
}
