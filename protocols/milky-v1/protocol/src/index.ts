import {
    Protocol,
    ProtocolRegistry,
    Account,
    Adapter,
    requireBooleanParam,
    requireNonEmptyStringParam,
    requirePositiveIntegerParam,
    ReverseWebSocketSession,
} from "onebots";
import type { CommonEvent, Schema } from "onebots";
import { Milky } from "./types.js";
import { MilkyConfig } from "./config.js";
import { createHmac } from "crypto";
import { WebSocket } from "ws";
import { projectMilkyEvent } from "./event-projector.js";
import { executeMilkyAccountAction, MILKY_ACCOUNT_ACTIONS } from "./account-actions.js";
import { executeMilkyGroupAction, MILKY_GROUP_ACTIONS } from "./group-actions.js";
import { projectMilkyGroup, projectMilkyGroupMember } from "./group-entities.js";
import {
    executeMilkyGroupRequestAction,
    getMilkyGroupNotifications,
    MILKY_GROUP_REQUEST_ACTIONS,
} from "./group-requests.js";
import { compileMilkySegments, projectMilkySegments } from "./message-segments.js";

const milkySchema: Schema = {
    use_http: { type: "boolean", label: "启用 HTTP", ui: { section: "transport" } },
    use_ws: { type: "boolean", label: "启用 WebSocket", ui: { section: "transport" } },
    http_reverse: {
        type: "array",
        default: [],
        label: "HTTP 反向上报",
        description: "将事件 POST 到下游服务。展开单项可覆盖鉴权与超时。",
        ui: {
            widget: "endpoint-list",
            section: "delivery",
            itemLabel: "Webhook",
            addLabel: "添加 Webhook",
            schemes: ["http:", "https:"],
            fields: [
                {
                    key: "access_token",
                    label: "Access Token",
                    sensitive: true,
                    placeholder: "留空则使用全局 Token",
                },
                {
                    key: "secret",
                    label: "签名 Secret",
                    sensitive: true,
                    placeholder: "留空则使用全局 Secret",
                },
                {
                    key: "post_timeout",
                    label: "超时（秒）",
                    type: "number",
                    placeholder: "例如 15",
                },
            ],
        },
    },
    ws_reverse: {
        type: "array",
        default: [],
        label: "反向 WebSocket",
        description: "由 OneBots 主动连接下游服务。展开单项可覆盖鉴权与重连间隔。",
        ui: {
            widget: "endpoint-list",
            section: "delivery",
            itemLabel: "连接",
            addLabel: "添加连接",
            schemes: ["ws:", "wss:"],
            fields: [
                {
                    key: "access_token",
                    label: "Access Token",
                    sensitive: true,
                    placeholder: "留空则使用全局 Token",
                },
                {
                    key: "reconnect_interval",
                    label: "重连间隔（秒）",
                    type: "number",
                    placeholder: "例如 5",
                },
            ],
        },
    },
    access_token: {
        type: "string",
        label: "Access Token",
        sensitive: true,
        ui: { section: "credentials" },
    },
    secret: {
        type: "string",
        label: "Secret",
        sensitive: true,
        ui: { section: "credentials" },
    },
    filters: Protocol.FilterSchema,
};

ProtocolRegistry.registerSchema("milky.v1", milkySchema);

/**
 * Milky Protocol V1 Implementation
 * Milky is a QQ bot protocol similar to OneBot but with different message formats
 * Reference: https://milky.ntqqrev.org/
 */
export class MilkyV1 extends Protocol<"v1", MilkyConfig.Config> {
    public readonly name = "milky";
    public readonly version = "v1" as const;
    private readonly reverseWebSocketCleanups = new Set<() => void>();

    constructor(
        public adapter: Adapter,
        public account: Account,
        config: Protocol.Config,
    ) {
        super(adapter, account, {
            ...config,
            protocol: "milky",
            version: "v1",
        });
    }

    start(): void {
        // Initialize Milky protocol services
        if (this.config.use_http) {
            this.startHttp();
        }
        if (this.config.use_ws) {
            this.startWs();
        }
        if (this.config.http_reverse) {
            this.config.http_reverse.forEach(cfg => {
                const config = typeof cfg === "string" ? { url: cfg } : cfg;
                this.startHttpReverse(config);
            });
        }
        if (this.config.ws_reverse) {
            this.config.ws_reverse.forEach(cfg => {
                const config = typeof cfg === "string" ? { url: cfg } : cfg;
                this.startWsReverse(config);
            });
        }
    }

    async stop(_force?: boolean): Promise<void> {
        this.logger.info(`Stopping Milky protocol v1`);
        for (const cleanup of this.reverseWebSocketCleanups) cleanup();
        this.reverseWebSocketCleanups.clear();
        this.removeAllListeners();
    }

    /**
     * 上报事件到 Milky 客户端（HTTP 反连 / WebSocket 等）。
     * Account.dispatch 传入的是 CommonEvent；内部调用也可以传入已构造的 Milky event_type 事件。
     */
    dispatch(event: unknown): void {
        if (!this.filterFn(event as Record<string, unknown>)) {
            return;
        }
        let milkyEvent: Milky.Event | null = null;
        if (this.isMilkyShapedEvent(event)) {
            milkyEvent = event;
        } else {
            milkyEvent = projectMilkyEvent(event as CommonEvent.Event);
        }
        if (milkyEvent) {
            this.logger.debug(`Milky dispatch:`, milkyEvent);
            this.emit("dispatch", JSON.stringify(milkyEvent));
        }
    }

    /** 协议内部构造的事件（event_type）无需从 CommonEvent 转换 */
    private isMilkyShapedEvent(e: unknown): e is Milky.Event {
        return (
            typeof e === "object" &&
            e !== null &&
            "event_type" in e &&
            typeof (e as { event_type: unknown }).event_type === "string"
        );
    }

    /**
     * 与 dispatch 相同，便于阅读；Account 只调用各协议的 dispatch(CommonEvent)
     */
    dispatchCommonEvent(commonEvent: CommonEvent.Event): void {
        this.dispatch(commonEvent);
    }

    format(event: string, payload: Record<string, unknown>): Record<string, unknown> {
        return {
            time: Math.floor(Date.now() / 1000),
            self_id: Number(this.account.account_id) || 0,
            event_type: event,
            data: payload,
        };
    }

    async apply(action: string, params?: Record<string, unknown>): Promise<Milky.Response> {
        // Execute Milky API action
        this.logger.debug(`Milky action: ${action}`, params);

        try {
            const result = await this.executeAction(action, params);
            return {
                status: "ok",
                retcode: 0,
                data: result,
            };
        } catch (error) {
            this.logger.error(`Milky action ${action} failed:`, error);
            return {
                status: "failed",
                retcode: -1,
                message: error.message,
            };
        }
    }

    /**
     * Execute Milky action
     */
    private async executeAction(
        action: string,
        params: Record<string, unknown> = {},
    ): Promise<unknown> {
        if (MILKY_ACCOUNT_ACTIONS.has(action)) {
            return executeMilkyAccountAction(this.adapter, this.account.account_id, action, params);
        }
        if (MILKY_GROUP_ACTIONS.has(action)) {
            return executeMilkyGroupAction(this.adapter, this.account.account_id, action, params);
        }
        if (MILKY_GROUP_REQUEST_ACTIONS.has(action)) {
            return executeMilkyGroupRequestAction(
                this.adapter,
                this.account.account_id,
                action,
                params,
            );
        }
        switch (action) {
            case "send_private_message":
                return this.sendPrivateMessage(params);
            case "send_group_message":
                return this.sendGroupMessage(params);
            case "recall_private_message":
                return this.recallMessage("friend", params);
            case "recall_group_message":
                return this.recallMessage("group", params);
            case "get_message":
                return this.getMessage(params);
            case "get_history_messages":
                return this.getHistoryMessages(params);
            case "mark_message_as_read":
                return this.markMessageAsRead(params);
            case "get_forwarded_messages":
                return this.getForwardMessage(params);
            case "get_login_info":
                return this.getLoginInfo();
            case "get_impl_info":
                return this.getImplInfo();
            case "get_status":
                return this.getStatus();
            case "get_user_profile":
                return this.getStrangerInfo(params);
            case "get_friend_info":
                return this.getFriendInfo(params);
            case "get_friend_list":
                return this.getFriendList();
            case "get_cookies":
                return this.getCookies(params);
            case "get_csrf_token":
                return this.getCsrfToken();
            case "send_friend_nudge":
                return this.sendFriendNudge(params);
            case "send_profile_like":
                return this.sendProfileLike(params);
            case "get_friend_requests":
                return this.getFriendRequests(params);
            case "get_group_info":
                return this.getGroupInfo(params);
            case "get_group_list":
                return this.getGroupList();
            case "get_group_member_info":
                return this.getGroupMemberInfo(params);
            case "get_group_member_list":
                return this.getGroupMemberList(params);
            case "get_group_notifications":
                return getMilkyGroupNotifications(this.adapter, this.account.account_id, params);
            case "accept_friend_request":
                return this.handleFriendRequest(params, true);
            case "reject_friend_request":
                return this.handleFriendRequest(params, false);
            case "get_group_files":
                return this.getGroupFiles(params);
            case "create_group_folder":
                return this.createGroupFolder(params);
            case "upload_private_file":
                return this.uploadFile("private", params);
            case "upload_group_file":
                return this.uploadFile("group", params);
            case "get_private_file_download_url":
                return this.getFileDownloadUrl("private", params);
            case "get_group_file_download_url":
                return this.getFileDownloadUrl("group", params);
            case "move_group_file":
                return this.moveGroupFile(params);
            case "rename_group_file":
                return this.renameGroupFile(params);
            case "delete_group_file":
                return this.deleteGroupFile(params);
            case "rename_group_folder":
                return this.renameGroupFolder(params);
            case "delete_group_folder":
                return this.deleteGroupFolder(params);
            default:
                if (
                    typeof this.adapter.describeCapabilities === "function" &&
                    this.adapter.describeCapabilities(this.account.account_id).actions[action]
                ) {
                    return this.adapter.callAction(this.account.account_id, action, params);
                }
                throw new Error(`Unknown action: ${action}`);
        }
    }

    // Action implementations
    private async sendPrivateMessage(
        params: Record<string, unknown>,
    ): Promise<Milky.SendMessageResult> {
        const { user_id, message } = params as { user_id: string; message: Milky.Segment[] };
        const result = await this.adapter.sendMessage(this.account.account_id, {
            scene_type: "private",
            scene_id: this.adapter.resolveId(user_id),
            message: compileMilkySegments(
                message,
                sequence => this.adapter.resolveId(sequence).string,
            ),
        });
        return { message_seq: result.message_id.number, time: Math.floor(Date.now() / 1000) };
    }

    private async sendGroupMessage(
        params: Record<string, unknown>,
    ): Promise<Milky.SendMessageResult> {
        const { group_id, message } = params as { group_id: string; message: Milky.Segment[] };
        const result = await this.adapter.sendMessage(this.account.account_id, {
            scene_type: "group",
            scene_id: this.adapter.resolveId(group_id),
            message: compileMilkySegments(
                message,
                sequence => this.adapter.resolveId(sequence).string,
            ),
        });
        return { message_seq: result.message_id.number, time: Math.floor(Date.now() / 1000) };
    }

    private async recallMessage(
        scene: "friend" | "group",
        params: Record<string, unknown>,
    ): Promise<void> {
        const { message_seq, user_id, group_id } = params as {
            message_seq: number;
            user_id?: number;
            group_id?: number;
        };
        await this.adapter.deleteMessage(this.account.account_id, {
            message_id: this.adapter.resolveId(message_seq),
            scene_type: scene === "friend" ? "private" : "group",
            scene_id: this.adapter.resolveId(scene === "friend" ? user_id! : group_id!),
        });
    }

    private async getMessage(params: Record<string, unknown>): Promise<Milky.MessageInfo> {
        const messageId =
            typeof params.message_id === "string"
                ? this.adapter.resolveId(params.message_id)
                : this.adapter.resolveId(requirePositiveIntegerParam(params, "message_seq"));
        const msg = await this.adapter.getMessage(this.account.account_id, {
            message_id: messageId,
        });
        return this.toMilkyMessageInfo(msg);
    }

    private async getHistoryMessages(
        params: Record<string, unknown>,
    ): Promise<{ messages: Milky.MessageInfo[] }> {
        const scene = this.requireMilkyMessageScene(params);
        const messages = await this.adapter.getMessageHistory(this.account.account_id, {
            scene_type: scene,
            scene_id: this.adapter.resolveId(requirePositiveIntegerParam(params, "peer_id")),
            limit:
                params.limit === undefined
                    ? undefined
                    : requirePositiveIntegerParam(params, "limit"),
            offset:
                params.start_message_seq === undefined
                    ? undefined
                    : requirePositiveIntegerParam(params, "start_message_seq"),
        });
        return { messages: messages.map(message => this.toMilkyMessageInfo(message)) };
    }

    private async markMessageAsRead(params: Record<string, unknown>): Promise<void> {
        const scene = this.requireMilkyMessageScene(params);
        await this.adapter.markMessageAsRead(this.account.account_id, {
            scene_type: scene,
            scene_id: this.adapter.resolveId(requirePositiveIntegerParam(params, "peer_id")),
            message_id:
                params.message_seq === undefined
                    ? undefined
                    : this.adapter.resolveId(requirePositiveIntegerParam(params, "message_seq")),
        });
    }

    private toMilkyMessageInfo(msg: Adapter.MessageInfo): Milky.MessageInfo {
        return {
            time: msg.time || Math.floor(Date.now() / 1000),
            message_type: msg.sender.scene_type as "private" | "group",
            message_id: msg.message_id.string,
            real_id: 0,
            sender: {
                user_id: msg.sender.sender_id.string,
                nickname: msg.sender.sender_name,
            },
            message: projectMilkySegments(msg.message),
        };
    }

    private requireMilkyMessageScene(params: Record<string, unknown>): "private" | "group" {
        if (params.message_scene === "friend") return "private";
        if (params.message_scene === "group") return "group";
        throw new TypeError("message_scene 必须是 friend 或 group");
    }

    private async getForwardMessage(
        params: Record<string, unknown>,
    ): Promise<{ messages: Record<string, unknown>[] }> {
        const resourceId = requireNonEmptyStringParam(params, "resource_id");
        const messages = await this.adapter.getForwardMessage(this.account.account_id, {
            resource_id: resourceId,
        });
        return {
            messages: messages.map(message => ({
                sender_id: message.sender.sender_id.number,
                sender_name: message.sender.sender_name,
                time: message.time,
                segments: message.message,
            })),
        };
    }

    private async getLoginInfo(): Promise<Milky.LoginInfo> {
        const info = await this.adapter.getLoginInfo(this.account.account_id);
        return {
            uin: info.user_id.number,
            nickname: info.user_name,
        };
    }

    private async getImplInfo(): Promise<Record<string, string>> {
        const version = await this.adapter.getVersion(this.account.account_id);
        return {
            impl_name: version.app_name ?? version.impl ?? "onebots",
            impl_version:
                version.app_version ?? version.impl_version ?? version.version ?? "unknown",
            milky_version: "1.0",
        };
    }

    private async getStatus(): Promise<Adapter.StatusInfo> {
        return this.adapter.getStatus(this.account.account_id);
    }

    private async getStrangerInfo(params: Record<string, unknown>): Promise<Milky.User> {
        const { user_id } = params as { user_id: string };
        const info = await this.adapter.getUserInfo(this.account.account_id, {
            user_id: this.adapter.resolveId(user_id),
        });
        return {
            user_id: info.user_id.string,
            nickname: info.user_name,
        };
    }

    private async getFriendInfo(
        params: Record<string, unknown>,
    ): Promise<{ friend: Milky.FriendInfo }> {
        const { user_id } = params as { user_id: string };
        const info = await this.adapter.getFriendInfo(this.account.account_id, {
            user_id: this.adapter.resolveId(user_id),
        });
        return {
            friend: {
                user_id: info.user_id.number,
                nickname: info.user_name,
                remark: info.remark ?? "",
            },
        };
    }

    private async getFriendList(): Promise<{ friends: Milky.FriendInfo[] }> {
        const result = await this.adapter.getFriendList(this.account.account_id);
        return {
            friends: result.map(info => ({
                user_id: info.user_id.number,
                nickname: info.user_name,
                remark: info.remark || "",
            })),
        };
    }

    private async getCookies(params: Record<string, unknown>): Promise<{ cookies: string }> {
        const domain =
            typeof params.domain === "string" && params.domain.trim() !== ""
                ? params.domain
                : undefined;
        return {
            cookies: await this.adapter.getCookies(this.account.account_id, { domain }),
        };
    }

    private async getCsrfToken(): Promise<{ csrf_token: number }> {
        return {
            csrf_token: await this.adapter.getCsrfToken(this.account.account_id),
        };
    }

    private async sendFriendNudge(params: Record<string, unknown>): Promise<void> {
        const userId = requirePositiveIntegerParam(params, "user_id");
        await this.adapter.sendFriendNudge(this.account.account_id, {
            user_id: this.adapter.resolveId(userId),
            is_self:
                params.is_self === undefined ? undefined : requireBooleanParam(params, "is_self"),
        });
    }

    private async sendProfileLike(params: Record<string, unknown>): Promise<void> {
        const userId = requirePositiveIntegerParam(params, "user_id");
        const count = requirePositiveIntegerParam(params, "count");
        await this.adapter.sendLike(this.account.account_id, {
            user_id: this.adapter.resolveId(userId),
            count,
        });
    }

    private async getFriendRequests(
        params: Record<string, unknown>,
    ): Promise<{ requests: Record<string, unknown>[] }> {
        const requests = await this.adapter.getFriendRequests(this.account.account_id, {
            limit:
                params.limit === undefined
                    ? undefined
                    : requirePositiveIntegerParam(params, "limit"),
            is_filtered:
                params.is_filtered === undefined
                    ? undefined
                    : requireBooleanParam(params, "is_filtered"),
        });
        return {
            requests: requests.map(request => ({
                initiator_id: request.user_id.number,
                initiator_uid: request.request_id.string,
                comment: request.message ?? "",
                time: request.time,
                is_filtered: false,
            })),
        };
    }

    private async getGroupInfo(
        params: Record<string, unknown>,
    ): Promise<{ group: Milky.GroupInfo }> {
        const { group_id } = params as { group_id: string };
        const info = await this.adapter.getGroupInfo(this.account.account_id, {
            group_id: this.adapter.resolveId(group_id),
        });
        return { group: projectMilkyGroup(info) };
    }

    private async getGroupList(): Promise<{ groups: Milky.GroupInfo[] }> {
        const result = await this.adapter.getGroupList(this.account.account_id);
        return { groups: result.map(projectMilkyGroup) };
    }

    private async getGroupMemberInfo(
        params: Record<string, unknown>,
    ): Promise<{ member: Milky.GroupMemberInfo }> {
        const { group_id, user_id } = params as { group_id: string; user_id: string };
        const info = await this.adapter.getGroupMemberInfo(this.account.account_id, {
            group_id: this.adapter.resolveId(group_id),
            user_id: this.adapter.resolveId(user_id),
        });
        return { member: projectMilkyGroupMember(info) };
    }

    private async getGroupMemberList(
        params: Record<string, unknown>,
    ): Promise<{ members: Milky.GroupMemberInfo[] }> {
        const { group_id } = params as { group_id: string };
        const list = await this.adapter.getGroupMemberList(this.account.account_id, {
            group_id: this.adapter.resolveId(group_id),
        });
        return { members: list.map(projectMilkyGroupMember) };
    }

    private async getGroupFiles(params: Record<string, unknown>): Promise<unknown> {
        const groupId = requirePositiveIntegerParam(params, "group_id");
        const result = await this.adapter.getGroupFiles(this.account.account_id, {
            group_id: this.adapter.resolveId(groupId),
            parent_folder_id:
                typeof params.parent_folder_id === "string"
                    ? this.adapter.resolveId(params.parent_folder_id)
                    : undefined,
        });
        return {
            files: result.files.map(file => ({
                group_id: file.group_id?.number ?? groupId,
                file_id: file.file_id.string,
                file_name: file.file_name,
                parent_folder_id: file.parent_folder_id?.string ?? "/",
                file_size: file.file_size ?? 0,
                uploaded_time: requireNonNegativeInteger(file.uploaded_time, "uploaded_time"),
                ...(file.expire_time === undefined ? {} : { expire_time: file.expire_time }),
                uploader_id: requirePositiveId(file.uploader_id?.number, "uploader_id"),
                downloaded_times: requireNonNegativeInteger(
                    file.downloaded_times,
                    "downloaded_times",
                ),
            })),
            folders: result.folders.map(folder => ({
                group_id: folder.group_id?.number ?? groupId,
                folder_id: folder.folder_id.string,
                parent_folder_id: folder.parent_folder_id?.string ?? "/",
                folder_name: folder.folder_name,
                created_time: requireNonNegativeInteger(folder.created_time, "created_time"),
                last_modified_time: requireNonNegativeInteger(
                    folder.last_modified_time,
                    "last_modified_time",
                ),
                creator_id: requirePositiveId(folder.creator_id?.number, "creator_id"),
                file_count: requireNonNegativeInteger(folder.file_count, "file_count"),
            })),
        };
    }

    private async createGroupFolder(
        params: Record<string, unknown>,
    ): Promise<{ folder_id: string }> {
        const groupId = requirePositiveIntegerParam(params, "group_id");
        const folder = await this.adapter.createGroupFolder(this.account.account_id, {
            group_id: this.adapter.resolveId(groupId),
            folder_name: requireNonEmptyStringParam(params, "folder_name"),
        });
        return { folder_id: folder.folder_id.string };
    }

    private async uploadFile(
        scene: "private" | "group",
        params: Record<string, unknown>,
    ): Promise<{ file_id: string }> {
        const sceneKey = scene === "private" ? "user_id" : "group_id";
        const sceneId = requirePositiveIntegerParam(params, sceneKey);
        const file = requireNonEmptyStringParam(params, "file_uri");
        const upload = await this.adapter.uploadFile(this.account.account_id, {
            scene_type: scene,
            scene_id: this.adapter.resolveId(sceneId),
            name: requireNonEmptyStringParam(params, "file_name"),
            ...(file.startsWith("base64://")
                ? { data: file.slice("base64://".length) }
                : file.startsWith("http://") || file.startsWith("https://")
                  ? { url: file }
                  : { path: file }),
            folder_id:
                scene === "group"
                    ? this.adapter.resolveId(
                          typeof params.parent_folder_id === "string"
                              ? params.parent_folder_id
                              : "/",
                      )
                    : undefined,
        });
        return { file_id: upload.file_id.string };
    }

    private async getFileDownloadUrl(
        scene: "private" | "group",
        params: Record<string, unknown>,
    ): Promise<{ download_url: string }> {
        const sceneKey = scene === "private" ? "user_id" : "group_id";
        const sceneId = requirePositiveIntegerParam(params, sceneKey);
        const url = await this.adapter.getFileDownloadUrl(this.account.account_id, {
            scene_type: scene,
            scene_id: this.adapter.resolveId(sceneId),
            file_id: this.adapter.resolveId(requireNonEmptyStringParam(params, "file_id")),
            file_hash:
                scene === "private" ? requireNonEmptyStringParam(params, "file_hash") : undefined,
            is_self_send:
                scene === "private" && params.is_self_send !== undefined
                    ? requireBooleanParam(params, "is_self_send")
                    : undefined,
        });
        return { download_url: url };
    }

    private async moveGroupFile(params: Record<string, unknown>): Promise<void> {
        await this.adapter.moveGroupFile(this.account.account_id, {
            group_id: this.adapter.resolveId(requirePositiveIntegerParam(params, "group_id")),
            file_id: this.adapter.resolveId(requireNonEmptyStringParam(params, "file_id")),
            target_folder_id: this.adapter.resolveId(
                typeof params.target_folder_id === "string" ? params.target_folder_id : "/",
            ),
        });
    }

    private async renameGroupFile(params: Record<string, unknown>): Promise<void> {
        await this.adapter.renameGroupFile(this.account.account_id, {
            group_id: this.adapter.resolveId(requirePositiveIntegerParam(params, "group_id")),
            file_id: this.adapter.resolveId(requireNonEmptyStringParam(params, "file_id")),
            new_name: requireNonEmptyStringParam(params, "new_file_name"),
        });
    }

    private async deleteGroupFile(params: Record<string, unknown>): Promise<void> {
        const groupId = requirePositiveIntegerParam(params, "group_id");
        await this.adapter.deleteFile(this.account.account_id, {
            scene_type: "group",
            scene_id: this.adapter.resolveId(groupId),
            file_id: this.adapter.resolveId(requireNonEmptyStringParam(params, "file_id")),
        });
    }

    private async renameGroupFolder(params: Record<string, unknown>): Promise<void> {
        await this.adapter.renameGroupFolder(this.account.account_id, {
            group_id: this.adapter.resolveId(requirePositiveIntegerParam(params, "group_id")),
            folder_id: this.adapter.resolveId(requireNonEmptyStringParam(params, "folder_id")),
            new_name: requireNonEmptyStringParam(params, "new_folder_name"),
        });
    }

    private async deleteGroupFolder(params: Record<string, unknown>): Promise<void> {
        await this.adapter.deleteGroupFolder(this.account.account_id, {
            group_id: this.adapter.resolveId(requirePositiveIntegerParam(params, "group_id")),
            folder_id: this.adapter.resolveId(requireNonEmptyStringParam(params, "folder_id")),
        });
    }

    private async handleFriendRequest(
        params: Record<string, unknown>,
        approve: boolean,
    ): Promise<void> {
        const flag = requireNonEmptyStringParam(params, "initiator_uid");
        await this.adapter.handleFriendRequest(this.account.account_id, {
            flag,
            approve,
            remark: typeof params.remark === "string" ? params.remark : undefined,
        });
    }

    /**
     * Verify access token
     */
    private verifyToken(token?: string): boolean {
        const requiredToken = this.config.access_token;
        if (!requiredToken) return true;
        return token === requiredToken;
    }

    /**
     * Verify signature
     */
    private verifySignature(body: string, signature?: string): boolean {
        const secret = this.config.secret;
        if (!secret) return true;
        if (!signature) return false;

        const hmac = createHmac("sha1", secret);
        const expected = "sha1=" + hmac.update(body).digest("hex");
        return signature === expected;
    }

    // Service implementations
    private startHttp(): void {
        this.logger.info("Starting Milky HTTP server");

        // Register HTTP POST endpoint for API calls
        this.router.post(`${this.path}/api/:action`, async ctx => {
            // Milky 通信规范：不支持的 Content-Type 返回 415
            const contentType = ctx.headers["content-type"] || "";
            if (!contentType.toLowerCase().includes("application/json")) {
                ctx.status = 415;
                return;
            }
            // Verify access token（Authorization: Bearer 优先，再 Query）
            const authHeader = ctx.headers.authorization;
            const token =
                (typeof authHeader === "string"
                    ? authHeader.replace(/^Bearer\s+/i, "").trim()
                    : undefined) || ctx.query.access_token;
            if (!this.verifyToken(token as string)) {
                ctx.status = 401;
                ctx.body = { status: "failed", retcode: 1403, message: "Unauthorized" };
                return;
            }

            const action = ctx.params.action;
            const params = ((ctx.request as unknown as Record<string, unknown>).body ??
                {}) as Record<string, unknown>;

            try {
                const result = await this.apply(action, params);
                ctx.body = result;
            } catch (error) {
                this.logger.error(`HTTP API ${action} failed:`, error);
                ctx.body = {
                    status: "failed",
                    retcode: -1,
                    message: error.message,
                };
            }
        });

        this.logger.info(`Milky HTTP server listening on ${this.path}/api/:action`);
    }

    private startWs(): void {
        this.logger.info("Starting Milky WebSocket server");

        const wss = this.router.ws(this.path + "/event");

        wss.on("connection", (ws, request) => {
            // Verify access token
            const url = new URL(request.url!, `ws://localhost`);
            const token =
                url.searchParams.get("access_token") ||
                request.headers.authorization?.replace("Bearer ", "");

            if (!this.verifyToken(token as string)) {
                ws.close(1008, "Unauthorized");
                return;
            }

            this.logger.info(`Milky WebSocket client connected: ${this.path}`);

            // Listen for dispatch events and send to client
            const onDispatch = (data: string) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(data);
                }
            };
            this.on("dispatch", onDispatch);

            // Handle incoming API calls
            ws.on("message", async data => {
                try {
                    const request = JSON.parse(data.toString());
                    const { action, params, echo } = request;

                    const result = await this.apply(action, params);
                    ws.send(JSON.stringify({ ...result, echo }));
                } catch (error) {
                    this.logger.error("WebSocket message error:", error);
                    ws.send(
                        JSON.stringify({
                            status: "failed",
                            retcode: -1,
                            message: error.message,
                        }),
                    );
                }
            });

            ws.on("close", () => {
                this.logger.info(`Milky WebSocket client disconnected: ${this.path}`);
                this.off("dispatch", onDispatch);
            });

            ws.on("error", error => {
                this.logger.error("WebSocket error:", error);
            });
        });

        this.logger.info(`Milky WebSocket server listening on ${this.path}`);
    }

    private startHttpReverse(config: MilkyConfig.HttpReverseConfig): void {
        this.logger.info(`Starting Milky HTTP reverse: ${config.url}`);

        // Listen for dispatch events and POST to external server
        const onDispatch = async (data: string) => {
            try {
                const headers: Record<string, string> = {
                    "Content-Type": "application/json",
                    "User-Agent": "Milky/1.0",
                    "X-Self-ID": this.account.account_id,
                };

                // Add access token if configured
                const token = config.access_token || this.config.access_token;
                if (token) {
                    headers["Authorization"] = `Bearer ${token}`;
                }

                // Add signature if secret is configured
                const secret = config.secret || this.config.secret;
                if (secret) {
                    const hmac = createHmac("sha1", secret);
                    headers["X-Signature"] = "sha1=" + hmac.update(data).digest("hex");
                }

                const response = await fetch(config.url, {
                    method: "POST",
                    headers,
                    body: data,
                    signal: AbortSignal.timeout((config.post_timeout || 5) * 1000),
                });

                if (!response.ok) {
                    this.logger.warn(`HTTP POST failed: ${response.status} ${response.statusText}`);
                }
            } catch (error) {
                this.logger.error(`HTTP POST error:`, error);
            }
        };

        this.on("dispatch", onDispatch);
        this.logger.info(`Milky HTTP reverse configured to POST events to ${config.url}`);
    }

    private startWsReverse(config: MilkyConfig.WsReverseConfig): void {
        this.logger.info(`Starting Milky WebSocket reverse: ${config.url}`);
        const wsUrl = new URL(config.url);
        const token = config.access_token || this.config.access_token;
        if (token) {
            wsUrl.searchParams.set("access_token", token);
        }
        const session = new ReverseWebSocketSession({
            url: wsUrl.toString(),
            headers: {
                "User-Agent": "Milky/1.0",
                "X-Self-ID": this.account.account_id,
                "X-Client-Role": "Universal",
            },
            logger: this.logger,
            reconnectDelayMs: (config.reconnect_interval || 5) * 1_000,
            onMessage: async data => {
                const request = JSON.parse(data.toString()) as Record<string, unknown>;
                const action = requireNonEmptyStringParam(request, "action");
                const params =
                    request.params && typeof request.params === "object"
                        ? (request.params as Record<string, unknown>)
                        : undefined;
                const result = await this.apply(action, params);
                const response =
                    request.echo !== undefined ? { ...result, echo: request.echo } : result;
                session.send(JSON.stringify(response));
            },
        });
        const onDispatch = (data: string) => session.send(data);
        const cleanup = () => {
            this.off("dispatch", onDispatch);
            session.stop();
        };
        this.on("dispatch", onDispatch);
        this.reverseWebSocketCleanups.add(cleanup);
        session.start();
    }
}

function requireNonNegativeInteger(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`Adapter 返回的 ${field} 必须是非负整数`);
    }
    return value;
}

function requirePositiveId(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`Adapter 返回的 ${field} 必须是正整数 ID`);
    }
    return value;
}

ProtocolRegistry.register("milky", "v1", MilkyV1);
export * from "./types.js";
export * from "./config.js";
