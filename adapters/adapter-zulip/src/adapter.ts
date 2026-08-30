import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    readPackageVersion,
    type CommonTypes,
} from "onebots";
import { zulipCapabilities } from "./capabilities.js";
import { ZulipClient } from "./client.js";
import { toGroupInfo, toGroupMember, toMessageInfo, toUserInfo } from "./entities.js";
import { ZulipError } from "./errors.js";
import { projectZulipEvents } from "./events.js";
import { loadZulipUpload, resolveZulipMedia } from "./media.js";
import { compileZulipMessage } from "./messages.js";
import { executeZulipPlatformAction, ZULIP_PLATFORM_ACTIONS } from "./platform-actions.js";
import { parseZulipMessages } from "./responses.js";
import { directNarrow, parseDirectRecipients, parseStreamScene, streamNarrow } from "./scenes.js";
import type { ZulipConfig, ZulipEvent, ZulipStream, ZulipUser } from "./types.js";

/** Zulip 组织、频道和 Event Queue 适配器。 */
export class ZulipAdapter extends Adapter<ZulipClient, "zulip"> {
    constructor(app: BaseApp) {
        super(app, "zulip", zulipCapabilities);
        this.icon = "https://zulip.com/static/images/logo/zulip-icon-circle.png";
    }

    /** 发送频道、单人私聊或多人私聊消息。 */
    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const client = this.requireClient(uin);
        const content = await compileZulipMessage(params.message, this.compiler(uin));
        const source = this.platformSource(params.scene_id);
        const stream = params.scene_type === "group" || params.scene_type === "channel";
        const response = stream
            ? await client.sendMessage({
                  type: "channel",
                  ...parseStreamScene(source, client.config.default_topic),
                  content,
              })
            : await client.sendMessage({
                  type: "direct",
                  to: parseDirectRecipients(source),
                  content,
              });
        return { message_id: this.createId(response.id) };
    }

    /** 删除一条 Zulip 消息。 */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        await this.requireClient(uin).deleteMessage(this.platformId(params.message_id));
    }

    /** 获取单条消息及原始 Markdown。 */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const client = this.requireClient(uin);
        const response = await client.getMessage(this.platformId(params.message_id));
        return toMessageInfo(
            response.message,
            value => this.createId(value),
            response.raw_content,
            client.config.server_url,
            client.config.email,
        );
    }

    /** 获取频道、话题或精确私聊会话历史。 */
    async getMessageHistory(
        uin: string,
        params: Adapter.GetMessageHistoryParams,
    ): Promise<Adapter.MessageInfo[]> {
        const client = this.requireClient(uin);
        const limit = Math.min(Math.max(params.limit || 50, 1), 1000);
        const offset = Math.max(params.offset || 0, 0);
        const scene = this.platformSource(params.scene_id);
        const stream = params.scene_type === "group" || params.scene_type === "channel";
        const narrow = stream ? streamNarrow(scene) : directNarrow(scene);
        const response = await client.call("messages", "GET", {
            anchor: "newest",
            num_before: Math.min(limit + offset, 5000),
            num_after: 0,
            narrow,
            apply_markdown: false,
            allow_empty_topic_name: true,
        });
        const messages = parseZulipMessages(response);
        const end = Math.max(0, messages.length - offset);
        return messages
            .slice(Math.max(0, end - limit), end)
            .map(message =>
                toMessageInfo(
                    message,
                    value => this.createId(value),
                    message.content,
                    client.config.server_url,
                    client.config.email,
                ),
            );
    }

    /** 更新消息正文。 */
    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        const content = await compileZulipMessage(params.message, this.compiler(uin));
        await this.requireClient(uin).updateMessage(this.platformId(params.message_id), content);
    }

    /** 将指定消息标记为已读。 */
    async markMessageAsRead(uin: string, params: Adapter.MarkMessageAsReadParams): Promise<void> {
        if (!params.message_id) {
            throw new ZulipError("Zulip mark_message_as_read 需要 message_id", {
                code: "ZULIP_MESSAGE_ID_REQUIRED",
            });
        }
        await this.requireClient(uin).updateMessageFlag(
            [this.platformId(params.message_id)],
            "add",
            "read",
        );
    }

    /** 获取当前 Bot 身份。 */
    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        return toUserInfo(await this.requireClient(uin).getMe(), value => this.createId(value));
    }

    /** 获取组织成员资料。 */
    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        return toUserInfo(
            await this.requireClient(uin).getUser(this.platformId(params.user_id)),
            value => this.createId(value),
        );
    }

    /** 获取当前凭证可访问的频道。 */
    async getGroupList(
        uin: string,
        _params?: Adapter.GetGroupListParams,
    ): Promise<Adapter.GroupInfo[]> {
        const streams = await this.requireClient(uin).getStreams();
        return streams.streams.map(stream => toGroupInfo(stream, value => this.createId(value)));
    }

    /** 获取频道资料。 */
    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const streamId = parseStreamScene(this.platformSource(params.group_id)).to;
        const stream = (await this.requireClient(uin).getStreams()).streams.find(
            item => item.stream_id === streamId,
        );
        if (!stream) throw notFound("频道", streamId);
        return toGroupInfo(stream, value => this.createId(value));
    }

    /** 重命名频道。 */
    async setGroupName(uin: string, params: Adapter.SetGroupNameParams): Promise<void> {
        await this.requireClient(uin).call(`streams/${this.platformId(params.group_id)}`, "PATCH", {
            new_name: params.group_name,
        });
    }

    /** 取消当前 Bot 对频道的订阅。 */
    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        const stream = await this.requireStream(uin, params.group_id);
        await this.requireClient(uin).call("users/me/subscriptions", "DELETE", {
            subscriptions: [stream.name],
        });
    }

    /** 获取频道的真实订阅成员。 */
    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const client = this.requireClient(uin);
        const streamId = this.platformId(params.group_id);
        const [subscriberIds, users] = await Promise.all([
            client.getSubscribers(streamId),
            client.getUsers(),
        ]);
        const byId = new Map(users.map(user => [user.user_id, user]));
        return subscriberIds.map(id =>
            toGroupMember(params.group_id, byId.get(id) || fallbackUser(id), value =>
                this.createId(value),
            ),
        );
    }

    /** 获取频道内单个订阅成员。 */
    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const memberIds = await this.requireClient(uin).getSubscribers(
            this.platformId(params.group_id),
        );
        const userId = this.platformId(params.user_id);
        if (!memberIds.includes(userId)) throw notFound("频道成员", userId);
        return toGroupMember(
            params.group_id,
            await this.requireClient(uin).getUser(userId),
            value => this.createId(value),
        );
    }

    /** 邀请组织成员订阅频道。 */
    async inviteGroupMember(uin: string, params: Adapter.InviteGroupMemberParams): Promise<void> {
        const stream = await this.requireStream(uin, params.group_id);
        await this.requireClient(uin).call("users/me/subscriptions", "POST", {
            subscriptions: [{ name: stream.name }],
            principals: [this.platformId(params.user_id)],
        });
    }

    /** 取消组织成员对频道的订阅。 */
    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        const stream = await this.requireStream(uin, params.group_id);
        await this.requireClient(uin).call("users/me/subscriptions", "DELETE", {
            subscriptions: [stream.name],
            principals: [this.platformId(params.user_id)],
        });
    }

    /** 上传文件并返回可用于 Zulip Markdown 的 URL。 */
    async uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        const source = await loadZulipUpload(params);
        const result = await this.requireClient(uin).upload(
            source.data,
            source.filename,
            source.mimeType,
        );
        const url = result.url || result.uri;
        if (!url)
            throw new ZulipError("Zulip 上传结果缺少 URL", { code: "ZULIP_UPLOAD_URL_MISSING" });
        return {
            file_id: this.createId(url),
            file_name: result.filename || source.filename,
            file_size: source.data.byteLength,
            url,
        };
    }

    /** 执行能力清单内的 Zulip 原生动作。 */
    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!ZULIP_PLATFORM_ACTIONS.has(action))
            return super.executePlatformAction(uin, action, params);
        return executeZulipPlatformAction(this.requireClient(uin), action, params);
    }

    /** 判断原生动作是否由本适配器实现。 */
    isPlatformActionImplemented(action: string): boolean {
        return ZULIP_PLATFORM_ACTIONS.has(action);
    }

    /** Zulip 支持通过 Markdown 发送图片。 */
    async canSendImage(): Promise<boolean> {
        return true;
    }

    /** Zulip 没有独立的语音消息能力。 */
    async canSendRecord(): Promise<boolean> {
        return false;
    }

    /** 获取适配器实现版本。 */
    async getVersion(): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots Zulip Adapter",
            app_version: await readPackageVersion(import.meta.url),
            impl: "Zulip REST API / Event Queue",
            version: "v1",
        };
    }

    /** 获取账号连接健康状态。 */
    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        const online = account?.status === AccountStatus.Online;
        const selfId = account?.client.getCachedMe()?.user_id ?? account?.account_id ?? uin;
        return {
            online,
            good: online,
            bots: [{ self: this.createId(selfId), online }],
        };
    }

    /** 创建具有可靠 Event Queue 生命周期的 Zulip 账号。 */
    createAccount(config: Account.Config<"zulip">): Account<"zulip", ZulipClient> {
        const client = new ZulipClient(normalizeConfig(config));
        const account = new Account<"zulip", ZulipClient>(this, client, config);
        client.on("event", (event: ZulipEvent) => {
            const selfId = client.getCachedMe()?.user_id;
            if (event.type === "message" && isOwnMessage(event, selfId)) return;
            return account.dispatchManyAwaited(
                projectZulipEvents(event, {
                    botId: this.createId(selfId ?? account.account_id),
                    botUserId: selfId,
                    serverUrl: client.config.server_url,
                    createId: value => this.createId(value),
                }),
            );
        });
        client.on("connected", () => {
            account.status = AccountStatus.Online;
        });
        client.on("disconnected", error => {
            account.status = AccountStatus.OffLine;
            this.logger.warn(`Zulip Event Queue 暂时断开: ${error.message}`);
        });
        client.on("client_error", error => this.logger.error("Zulip 客户端错误", error));
        account.on("start", async () => {
            account.status = AccountStatus.Pending;
            try {
                await client.start();
                const me = client.getCachedMe() || (await client.getMe());
                account.nickname = me.full_name;
                account.avatar = me.avatar_url || "";
                account.status = AccountStatus.Online;
                this.logger.info(`Zulip Bot ${account.account_id} 已启动`);
            } catch (error) {
                account.status = AccountStatus.OffLine;
                this.logger.error(`启动 Zulip Bot ${account.account_id} 失败`, error);
                throw error;
            }
        });
        account.on("stop", async () => {
            await client.stop();
            account.status = AccountStatus.OffLine;
        });
        return account;
    }

    private requireClient(uin: string): ZulipClient {
        const account = this.getAccount(uin);
        if (!account)
            throw new ZulipError(`Zulip 账号 ${uin} 不存在`, { code: "ZULIP_ACCOUNT_NOT_FOUND" });
        return account.client;
    }

    private platformSource(value: CommonTypes.Id | string | number): string {
        return String(this.coerceId(value).source);
    }

    private platformId(value: CommonTypes.Id | string | number): number {
        const result = Number(this.platformSource(value).split("/", 1)[0]);
        if (!Number.isSafeInteger(result)) {
            throw new ZulipError(`Zulip ID 必须是整数: ${this.platformSource(value)}`, {
                code: "ZULIP_INVALID_ID",
            });
        }
        return result;
    }

    private compiler(uin: string) {
        const client = this.requireClient(uin);
        return {
            resolveMention: async (value: string) => {
                const user = await client.getUser(this.platformId(value));
                return { id: user.user_id, name: user.full_name };
            },
            upload: async (segment: CommonTypes.Segment) => {
                const media = await resolveZulipMedia(segment);
                if (media.directUrl) {
                    return {
                        url: media.directUrl,
                        name: stringValue(segment.data.name) || segment.type,
                    };
                }
                const source = media.upload!;
                const result = await client.upload(source.data, source.filename, source.mimeType);
                const url = result.url || result.uri;
                if (!url) {
                    throw new ZulipError("Zulip 上传结果缺少 URL", {
                        code: "ZULIP_UPLOAD_URL_MISSING",
                    });
                }
                return { url, name: source.filename };
            },
        };
    }

    private async requireStream(uin: string, id: CommonTypes.Id): Promise<ZulipStream> {
        const streamId = this.platformId(id);
        const stream = (await this.requireClient(uin).getStreams()).streams.find(
            item => item.stream_id === streamId,
        );
        if (!stream) throw notFound("频道", streamId);
        return stream;
    }
}

function normalizeConfig(config: Account.Config<"zulip">): ZulipConfig {
    return {
        account_id: config.account_id,
        receive_mode: config.receive_mode,
        server_url: config.server_url,
        email: config.email,
        api_key: config.api_key,
        default_topic: config.default_topic,
        proxy: config.proxy,
        event_queue: config.event_queue,
    };
}

function isOwnMessage(event: ZulipEvent, selfId: number | undefined): boolean {
    return isRecord(event.message) && event.message.sender_id === selfId;
}

function fallbackUser(id: number): ZulipUser {
    return { user_id: id, email: String(id), full_name: String(id) };
}

function notFound(kind: string, id: string | number): ZulipError {
    return new ZulipError(`未找到 Zulip ${kind} ${id}`, { code: "ZULIP_NOT_FOUND" });
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            zulip: ZulipConfig;
        }
    }
}

AdapterRegistry.register("zulip", ZulipAdapter, {
    name: "zulip",
    displayName: "Zulip 适配器",
    description: "Zulip 适配器，支持官方 REST API、Event Queue、频道话题和私聊",
    icon: "https://zulip.com/static/images/logo/zulip-icon-circle.png",
    homepage: "https://zulip.com/",
    author: "凉菜",
    capabilities: zulipCapabilities,
});
