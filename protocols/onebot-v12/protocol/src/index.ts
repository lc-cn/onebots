import {
    Protocol,
    ProtocolRegistry,
    requireNonEmptyStringParam,
    requirePositiveIntegerParam,
} from "onebots";
import type { Schema } from "onebots";
import { Account } from "onebots";
import { Adapter } from "onebots";
import { CommonEvent, CommonTypes } from "onebots";
import { OneBotV12 } from "./types.js";
import { WebSocket } from "ws";
import { OneBotV12Config } from "./config.js";
import { projectOneBotV12Actions } from "./supported-actions.js";

const onebotV12Schema: Schema = {
    use_http: { type: "boolean", default: true, label: "启用 HTTP", ui: { section: "transport" } },
    use_ws: {
        type: "boolean",
        default: false,
        label: "启用 WebSocket",
        ui: { section: "transport" },
    },
    http_webhook: {
        type: "array",
        default: [],
        label: "HTTP Webhook",
        description: "将事件 POST 到已有的 HTTP 服务，可配置多个目标。",
        ui: {
            widget: "endpoint-list",
            section: "delivery",
            itemLabel: "Webhook",
            addLabel: "添加 Webhook",
            schemes: ["http:", "https:"],
        },
    },
    ws_reverse: {
        type: "array",
        default: [],
        label: "反向 WebSocket",
        description: "由 OneBots 主动连接下游 WebSocket 服务，可配置多个目标。",
        ui: {
            widget: "endpoint-list",
            section: "delivery",
            itemLabel: "连接",
            addLabel: "添加连接",
            schemes: ["ws:", "wss:"],
        },
    },
    request_timeout: {
        type: "number",
        label: "请求超时(秒)",
        ui: { section: "advanced" },
    },
    access_token: {
        type: "string",
        label: "Access Token",
        sensitive: true,
        ui: { section: "credentials" },
    },
    heartbeat_interval: {
        type: "number",
        label: "心跳间隔(秒)",
        ui: { section: "advanced" },
    },
    enable_cors: {
        type: "boolean",
        label: "启用 CORS",
        ui: { section: "advanced" },
    },
    filters: Protocol.FilterSchema,
};

ProtocolRegistry.registerSchema("onebot.v12", onebotV12Schema);

/**
 * OneBot V12 Protocol Implementation
 * Implements the OneBot 12 standard
 * Reference: https://12.onebot.dev
 */
export class OneBotV12Protocol extends Protocol<"v12", OneBotV12Config.Config> {
    public readonly name = "onebot";
    public readonly version = "v12" as const;
    private eventIdCounter = 0;

    // Heartbeat timer
    private heartbeatTimer?: NodeJS.Timeout;
    constructor(adapter: Adapter, account: Account, config: OneBotV12Config.Config) {
        super(adapter, account, {
            ...config,
            protocol: "onebot",
            version: "v12",
        });
    }

    /**
     * Start the OneBot V12 protocol service
     */
    start(): void {
        // Initialize communication methods
        if (this.config.use_http) {
            this.startHttp();
        }
        if (this.config.use_ws) {
            this.startWebSocket();
        }
        if (this.config.http_webhook?.length > 0) {
            this.config.http_webhook.forEach(url => this.startHttpWebhook(url));
        }
        if (this.config.ws_reverse?.length > 0) {
            this.config.ws_reverse.forEach(url => this.startWsReverse(url));
        }

        // 正向/反向 WebSocket 均需要心跳，不能只在 startWebSocket 里启动
        if (this.config.use_ws || this.config.ws_reverse?.length > 0) {
            this.setupHeartbeat();
        }
    }

    /**
     * Stop the protocol service
     */
    async stop(_force?: boolean): Promise<void> {
        this.logger.info(`Stopping OneBot V12 protocol`);

        // Clear heartbeat timer
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }

        this.removeAllListeners();
    }

    /**
     * Dispatch event to OneBot V12 format
     */
    dispatch(event: CommonEvent.Event): void {
        if (!this.filterFn(event)) {
            return;
        }

        const v12Event = this.convertToV12Format(event);
        if (v12Event) {
            this.logger.debug(`OneBot V12 dispatch:`, v12Event);
            this.emit("dispatch", JSON.stringify(v12Event));
        }
    }

    /**
     * Format event data to OneBot V12 specification
     */
    format(event: string, payload: Record<string, unknown>): Record<string, unknown> {
        return {
            id: this.generateEventId(),
            time: Math.floor(Date.now() / 1000),
            type: event,
            self: this.getSelfInfo(),
            ...payload,
        };
    }

    /**
     * Apply OneBot V12 API action
     */
    async apply(action: string, params?: Record<string, unknown>): Promise<OneBotV12.Response> {
        this.logger.debug(`OneBot V12 action: ${action}`, params);

        try {
            const result = await this.executeAction(action, params);
            return {
                status: "ok",
                retcode: 0,
                data: result,
                message: "",
            };
        } catch (error) {
            this.logger.error(`OneBot V12 action ${action} failed:`, error);
            return {
                status: "failed",
                retcode: -1,
                data: null,
                message: error.message || String(error),
            };
        }
    }

    /**
     * Execute OneBot V12 action
     */
    private async executeAction(
        action: string,
        params: Record<string, unknown> = {},
    ): Promise<unknown> {
        switch (action) {
            // Message API
            case "send_message":
                return this.sendMessage(params as unknown as OneBotV12.SendMessageParams);
            case "delete_message":
                return this.deleteMessage(params as unknown as OneBotV12.DeleteMessageParams);

            // Bot self API
            case "get_self_info":
                return this.getSelfUserInfo();
            case "get_supported_actions":
                return this.getSupportedActions();
            case "get_status":
                return this.getStatus();
            case "get_version":
                return this.getVersionInfo();

            // User API
            case "get_user_info":
                return this.getUserInfo(params as unknown as OneBotV12.GetUserInfoParams);
            case "get_friend_list":
                return this.getFriendList();

            // Group API
            case "get_group_info":
                return this.getGroupInfo(params as unknown as OneBotV12.GetGroupInfoParams);
            case "get_group_list":
                return this.getGroupList();
            case "get_group_member_info":
                return this.getGroupMemberInfo(
                    params as unknown as OneBotV12.GetGroupMemberInfoParams,
                );
            case "get_group_member_list":
                return this.getGroupMemberList(
                    params as unknown as OneBotV12.GetGroupMemberListParams,
                );
            case "set_group_name":
                return this.setGroupName(params as unknown as OneBotV12.SetGroupNameParams);
            case "leave_group":
                return this.leaveGroup(params as unknown as OneBotV12.LeaveGroupParams);
            case "invite_friend_to_group":
                return this.inviteFriendToGroup(params);
            case "accept_friend_request":
                return this.acceptFriendRequest(params);

            // Guild API
            case "get_guild_info":
                return this.getGuildInfo(params as unknown as OneBotV12.GetGuildInfoParams);
            case "get_guild_list":
                return this.getGuildList();
            case "get_guild_member_info":
                return this.getGuildMemberInfo(
                    params as unknown as OneBotV12.GetGuildMemberInfoParams,
                );
            case "get_guild_member_list":
                return this.getGuildMemberList(
                    params as unknown as OneBotV12.GetGuildMemberListParams,
                );

            // Channel API
            case "get_channel_info":
                return this.getChannelInfo(params as unknown as OneBotV12.GetChannelInfoParams);
            case "get_channel_list":
                return this.getChannelList(params as unknown as OneBotV12.GetChannelListParams);
            case "set_channel_name":
                return this.setChannelName(params as unknown as OneBotV12.SetChannelNameParams);
            case "get_channel_member_info":
                return this.getChannelMemberInfo(
                    params as unknown as OneBotV12.GetChannelMemberInfoParams,
                );
            case "get_channel_member_list":
                return this.getChannelMemberList(
                    params as unknown as OneBotV12.GetChannelMemberListParams,
                );

            // File API
            case "upload_file":
                return this.uploadFile(params as unknown as OneBotV12.UploadFileParams);
            case "upload_file_fragmented_prepare":
                return this.uploadFileFragmentedPrepare(
                    params as unknown as OneBotV12.UploadFileFragmentedPrepareParams,
                );
            case "upload_file_fragmented_transfer":
                return this.uploadFileFragmentedTransfer(
                    params as unknown as OneBotV12.UploadFileFragmentedTransferParams,
                );
            case "upload_file_fragmented_finish":
                return this.uploadFileFragmentedFinish(
                    params as unknown as OneBotV12.UploadFileFragmentedFinishParams,
                );
            case "get_file":
                return this.getFile(params as unknown as OneBotV12.GetFileParams);
            case "get_file_fragmented_prepare":
                return this.getFileFragmentedPrepare(
                    params as unknown as OneBotV12.GetFileFragmentedPrepareParams,
                );
            case "get_file_fragmented_transfer":
                return this.getFileFragmentedTransfer(
                    params as unknown as OneBotV12.GetFileFragmentedTransferParams,
                );

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

    // ============ Message API Implementations ============

    private async sendMessage(
        params: OneBotV12.SendMessageParams,
    ): Promise<OneBotV12.SendMessageResponse> {
        const { detail_type, user_id, group_id, guild_id, channel_id, message } = params;

        let scene_type: CommonTypes.Scene;
        let scene_id: string;

        if (detail_type === "private" && user_id) {
            scene_type = "private";
            scene_id = user_id;
        } else if (detail_type === "group" && group_id) {
            scene_type = "group";
            scene_id = group_id;
        } else if (detail_type === "channel" && guild_id && channel_id) {
            scene_type = "channel";
            scene_id = `${guild_id}:${channel_id}`;
        } else {
            throw new Error("Invalid message parameters");
        }

        const segments = this.convertToCommonSegments(message);
        const result = await this.adapter.sendMessage(this.account.account_id, {
            scene_type,
            scene_id: this.adapter.resolveId(scene_id),
            message: segments,
        });

        return {
            message_id: result.message_id.string,
            time: Math.floor(Date.now() / 1000),
        };
    }

    private async deleteMessage(params: OneBotV12.DeleteMessageParams): Promise<void> {
        await this.adapter.deleteMessage(this.account.account_id, {
            message_id: this.adapter.resolveId(params.message_id),
        });
    }

    // ============ Bot Self API Implementations ============

    private getSelfInfo(): OneBotV12.BotSelf {
        return {
            platform: this.account.platform as string,
            user_id: this.adapter.resolveId(this.account.account_id).string,
        };
    }

    /**
     * Get self info as UserInfo (for get_self_info action)
     */
    private getSelfUserInfo(): OneBotV12.UserInfo {
        return {
            user_id: this.adapter.resolveId(this.account.account_id).string,
            user_name: this.account.account_id,
            user_displayname: this.account.account_id,
        };
    }

    private getSupportedActions(): string[] {
        return projectOneBotV12Actions(
            this.adapter.describeCapabilities(this.account.account_id),
        );
    }

    private async getStatus(): Promise<OneBotV12.Status> {
        const status = await this.adapter.getStatus(this.account.account_id);
        return {
            good: status.good,
            bots: [
                {
                    self: this.getSelfInfo(),
                    online: status.online ?? status.good,
                },
            ],
        };
    }

    private async getVersionInfo(): Promise<OneBotV12.VersionInfo> {
        const version = await this.adapter.getVersion(this.account.account_id);
        return {
            impl: version.impl ?? version.app_name ?? "onebots",
            version: version.version ?? version.app_version ?? "unknown",
            onebot_version: "12",
        };
    }

    // ============ User API Implementations ============

    private async getUserInfo(params: OneBotV12.GetUserInfoParams): Promise<OneBotV12.UserInfo> {
        const userInfo = await this.adapter.getUserInfo(this.account.account_id, {
            user_id: this.adapter.resolveId(params.user_id),
        });

        return {
            user_id: userInfo.user_id.string,
            user_name: userInfo.user_name,
        };
    }

    private async getFriendList(): Promise<OneBotV12.UserInfo[]> {
        const friends = await this.adapter.getFriendList(this.account.account_id);

        return friends.map(friend => ({
            user_id: friend.user_id.string,
            user_name: friend.user_name,
            user_remark: friend.remark,
        }));
    }

    // ============ Group API Implementations ============

    private async getGroupInfo(params: OneBotV12.GetGroupInfoParams): Promise<OneBotV12.GroupInfo> {
        const groupInfo = await this.adapter.getGroupInfo(this.account.account_id, {
            group_id: this.adapter.resolveId(params.group_id),
        });

        return {
            group_id: groupInfo.group_id.string,
            group_name: groupInfo.group_name,
        };
    }

    private async getGroupList(): Promise<OneBotV12.GroupInfo[]> {
        const groups = await this.adapter.getGroupList(this.account.account_id);

        return groups.map(group => ({
            group_id: group.group_id.string,
            group_name: group.group_name,
        }));
    }

    private async getGroupMemberInfo(
        params: OneBotV12.GetGroupMemberInfoParams,
    ): Promise<OneBotV12.GroupMemberInfo> {
        const memberInfo = await this.adapter.getGroupMemberInfo(this.account.account_id, {
            group_id: this.adapter.resolveId(params.group_id),
            user_id: this.adapter.resolveId(params.user_id),
        });

        return {
            user_id: memberInfo.user_id.string,
            user_name: memberInfo.user_name,
        };
    }

    private async getGroupMemberList(
        params: OneBotV12.GetGroupMemberListParams,
    ): Promise<OneBotV12.GroupMemberInfo[]> {
        const members = await this.adapter.getGroupMemberList(this.account.account_id, {
            group_id: this.adapter.resolveId(params.group_id),
        });

        return members.map(member => ({
            user_id: member.user_id.string,
            user_name: member.user_name,
        }));
    }

    private async setGroupName(params: OneBotV12.SetGroupNameParams): Promise<void> {
        await this.adapter.setGroupName(this.account.account_id, {
            group_id: this.adapter.resolveId(params.group_id),
            group_name: params.group_name,
        });
    }

    private async leaveGroup(params: OneBotV12.LeaveGroupParams): Promise<void> {
        await this.adapter.leaveGroup(this.account.account_id, {
            group_id: this.adapter.resolveId(params.group_id),
        });
    }

    /** OneBots 扩展：邀请机器人好友加入指定群。 */
    private async inviteFriendToGroup(
        params: Record<string, unknown>,
    ): Promise<Record<string, never>> {
        const groupId = requirePositiveIntegerParam(params, "group_id");
        const userId = requirePositiveIntegerParam(params, "user_id");
        await this.adapter.inviteGroupMember(this.account.account_id, {
            group_id: this.adapter.resolveId(groupId),
            user_id: this.adapter.resolveId(userId),
        });
        return {};
    }

    /** OneBots 扩展：同意好友申请。 */
    private async acceptFriendRequest(
        params: Record<string, unknown>,
    ): Promise<Record<string, never>> {
        const flag = requireNonEmptyStringParam(params, "flag");
        await this.adapter.handleFriendRequest(this.account.account_id, {
            flag,
            approve: true,
            remark: typeof params.remark === "string" ? params.remark : undefined,
        });
        return {};
    }

    // ============ Guild API Implementations ============

    private async getGuildInfo(params: OneBotV12.GetGuildInfoParams): Promise<OneBotV12.GuildInfo> {
        const guild = await this.adapter.getGuildInfo(this.account.account_id, {
            guild_id: this.adapter.resolveId(params.guild_id),
        });
        return { guild_id: guild.guild_id.string, guild_name: guild.guild_name };
    }

    private async getGuildList(): Promise<OneBotV12.GuildInfo[]> {
        const guilds = await this.adapter.getGuildList(this.account.account_id);
        return guilds.map(guild => ({
            guild_id: guild.guild_id.string,
            guild_name: guild.guild_name,
        }));
    }

    private async getGuildMemberInfo(
        params: OneBotV12.GetGuildMemberInfoParams,
    ): Promise<OneBotV12.GuildMemberInfo> {
        const member = await this.adapter.getGuildMemberInfo(this.account.account_id, {
            guild_id: this.adapter.resolveId(params.guild_id),
            user_id: this.adapter.resolveId(params.user_id),
        });
        return {
            user_id: member.user_id.string,
            user_name: member.user_name,
            user_displayname: member.nickname,
        };
    }

    private async getGuildMemberList(
        params: OneBotV12.GetGuildMemberListParams,
    ): Promise<OneBotV12.GuildMemberInfo[]> {
        const members = await this.adapter.getGuildMemberList(this.account.account_id, {
            guild_id: this.adapter.resolveId(params.guild_id),
        });
        return members.map(member => ({
            user_id: member.user_id.string,
            user_name: member.user_name,
            user_displayname: member.nickname,
        }));
    }

    // ============ Channel API Implementations ============

    private async getChannelInfo(
        params: OneBotV12.GetChannelInfoParams,
    ): Promise<OneBotV12.ChannelInfo> {
        const channelInfo = await this.adapter.getChannelInfo(this.account.account_id, {
            channel_id: this.adapter.resolveId(params.channel_id),
            guild_id: this.adapter.resolveId(params.guild_id),
        });

        return {
            channel_id: channelInfo.channel_id.string,
            channel_name: channelInfo.channel_name,
        };
    }

    private async getChannelList(
        params: OneBotV12.GetChannelListParams,
    ): Promise<OneBotV12.ChannelInfo[]> {
        const channels = await this.adapter.getChannelList(this.account.account_id, {
            guild_id: this.adapter.resolveId(params.guild_id),
        });
        return channels.map(channel => ({
            channel_id: channel.channel_id.string,
            channel_name: channel.channel_name,
        }));
    }

    private async setChannelName(params: OneBotV12.SetChannelNameParams): Promise<void> {
        await this.adapter.updateChannel(this.account.account_id, {
            channel_id: this.adapter.resolveId(params.channel_id),
            channel_name: params.channel_name,
        });
    }

    private async getChannelMemberInfo(
        params: OneBotV12.GetChannelMemberInfoParams,
    ): Promise<OneBotV12.ChannelMemberInfo> {
        const member = await this.adapter.getChannelMemberInfo(this.account.account_id, {
            channel_id: this.adapter.resolveId(params.channel_id),
            user_id: this.adapter.resolveId(params.user_id),
        });
        return {
            user_id: member.user_id.string,
            user_name: member.user_name,
            user_displayname: member.user_name,
        };
    }

    private async getChannelMemberList(
        params: OneBotV12.GetChannelMemberListParams,
    ): Promise<OneBotV12.ChannelMemberInfo[]> {
        const members = await this.adapter.getChannelMemberList(this.account.account_id, {
            channel_id: this.adapter.resolveId(params.channel_id),
        });
        return members.map(member => ({
            user_id: member.user_id.string,
            user_name: member.user_name,
            user_displayname: member.user_name,
        }));
    }

    // ============ File API Implementations ============

    private async uploadFile(_params: OneBotV12.UploadFileParams): Promise<OneBotV12.FileInfo> {
        // Implementation depends on adapter support
        throw new Error("upload_file not implemented");
    }

    private async uploadFileFragmentedPrepare(
        _params: OneBotV12.UploadFileFragmentedPrepareParams,
    ): Promise<{ file_id: string }> {
        // Implementation depends on adapter support
        throw new Error("upload_file_fragmented_prepare not implemented");
    }

    private async uploadFileFragmentedTransfer(
        _params: OneBotV12.UploadFileFragmentedTransferParams,
    ): Promise<void> {
        // Implementation depends on adapter support
        throw new Error("upload_file_fragmented_transfer not implemented");
    }

    private async uploadFileFragmentedFinish(
        _params: OneBotV12.UploadFileFragmentedFinishParams,
    ): Promise<OneBotV12.FileInfo> {
        // Implementation depends on adapter support
        throw new Error("upload_file_fragmented_finish not implemented");
    }

    private async getFile(_params: OneBotV12.GetFileParams): Promise<OneBotV12.FileInfo> {
        // Implementation depends on adapter support
        throw new Error("get_file not implemented");
    }

    private async getFileFragmentedPrepare(
        _params: OneBotV12.GetFileFragmentedPrepareParams,
    ): Promise<{ name: string; total_size: number; sha256?: string }> {
        // Implementation depends on adapter support
        throw new Error("get_file_fragmented_prepare not implemented");
    }

    private async getFileFragmentedTransfer(
        _params: OneBotV12.GetFileFragmentedTransferParams,
    ): Promise<{ data: string | Uint8Array }> {
        // Implementation depends on adapter support
        throw new Error("get_file_fragmented_transfer not implemented");
    }

    // ============ Utility Methods ============

    /**
     * Convert common event to OneBot V12 format
     */
    private convertToV12Format(event: CommonEvent.Event): OneBotV12.Event | null {
        const base = {
            id: event.id.string,
            time: Math.floor(event.timestamp / 1000),
            self: this.getSelfInfo(),
        };

        if (event.type === "message") {
            const messageEvent: OneBotV12.MessageEvent = {
                ...base,
                type: "message",
                detail_type:
                    event.message_type === "private"
                        ? "private"
                        : event.message_type === "group"
                          ? "group"
                          : event.message_type === "channel"
                            ? "channel"
                            : "private",
                sub_type: "",
                message_id: event.message_id.string,
                message: this.convertToV12Segments(event.message),
                alt_message: event.raw_message,
                user_id: event.sender.id.string,
            };

            if (event.group) {
                (messageEvent as OneBotV12.GroupMessageEvent).group_id = event.group.id.string;
            }

            return messageEvent;
        } else if (event.type === "notice") {
            const noticeEvent: Record<string, unknown> = {
                ...base,
                type: "notice",
                detail_type: event.notice_type as string,
                sub_type: "",
            };

            // 添加 notice 事件的必要字段
            if (event.user) {
                noticeEvent.user_id = event.user.id.string;
            }
            if (event.operator) {
                noticeEvent.operator_id = event.operator.id.string;
            }
            if (event.group) {
                noticeEvent.group_id = event.group.id.string;
            }

            return noticeEvent as unknown as OneBotV12.NoticeEvent;
        } else if (event.type === "request") {
            const requestEvent: Record<string, unknown> = {
                ...base,
                type: "request",
                detail_type: event.request_type as string,
                sub_type: "",
                user_id: event.user.id.string,
                comment: event.comment || "",
                flag: event.flag,
            };

            // 添加 request 事件的必要字段
            if (event.group) {
                requestEvent.group_id = event.group.id.string;
            }

            return requestEvent as unknown as OneBotV12.RequestEvent;
        } else if (event.type === "meta") {
            return {
                ...base,
                type: "meta",
                detail_type: event.meta_type as string,
                sub_type: event.sub_type || "",
            };
        }

        return null;
    }

    /**
     * Convert common segments to V12 segments
     */
    private convertToV12Segments(segments: CommonTypes.Segment[]): OneBotV12.Segment[] {
        return segments.map(seg => {
            // Map common segment types to V12 format
            if (seg.type === "at") {
                return {
                    type: "mention",
                    data: { user_id: seg.data.qq || seg.data.user_id },
                };
            }
            return {
                type: seg.type,
                data: seg.data,
            };
        });
    }

    /**
     * Convert V12 segments to common segments
     */
    private convertToCommonSegments(segments: OneBotV12.Segment[]): CommonTypes.Segment[] {
        return segments.map(seg => {
            // Map V12 segment types to common format
            if (seg.type === "mention") {
                return {
                    type: "at",
                    data: { qq: seg.data.user_id },
                };
            }
            return {
                type: seg.type,
                data: seg.data,
            };
        });
    }

    /**
     * Generate unique event ID
     */
    private generateEventId(): string {
        return `${this.account.platform}.${this.account.account_id}.${Date.now()}.${++this.eventIdCounter}`;
    }

    /**
     * 启动心跳定时器（每个协议实例仅一次）
     */
    private setupHeartbeat(): void {
        if (!this.config.heartbeat_interval || this.heartbeatTimer) {
            return;
        }

        // 配置为秒，转换为毫秒；至少 1 秒
        const intervalMs = Math.max(Number(this.config.heartbeat_interval) || 1, 1) * 1000;
        this.heartbeatTimer = setInterval(() => {
            this.dispatchMetaEvent("heartbeat", {
                interval: intervalMs,
            });
        }, intervalMs);
    }

    /**
     * Dispatch meta event
     */
    private dispatchMetaEvent(detailType: string, extra: Record<string, unknown> = {}): void {
        const event: OneBotV12.MetaEvent = {
            id: this.generateEventId(),
            time: Math.floor(Date.now() / 1000),
            type: "meta",
            detail_type: detailType,
            sub_type: "",
            self: this.getSelfInfo(),
            ...extra,
        };

        this.emit("dispatch", JSON.stringify(event));
    }

    /**
     * Verify access token
     */
    private verifyToken(token?: string): boolean {
        if (!this.config.access_token) return true;
        return token === this.config.access_token;
    }

    /**
     * Start HTTP server
     */
    private startHttp(): void {
        this.logger.info("Starting HTTP server");

        // Register HTTP POST endpoint for API calls
        this.router.post(`${this.path}/:action`, async ctx => {
            // Verify access token（12.onebot.dev：先 Authorization 头，再 access_token Query）
            const authHeader = ctx.headers.authorization;
            const token =
                (typeof authHeader === "string"
                    ? authHeader.replace(/^Bearer\s+/i, "").trim()
                    : undefined) || ctx.query.access_token;
            if (!this.verifyToken(token as string)) {
                ctx.status = 401;
                ctx.body = { status: "failed", retcode: 1403, message: "Unauthorized", data: null };
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
                    data: null,
                };
            }
        });

        this.logger.info(`HTTP server listening on ${this.path}/:action`);
    }

    /**
     * Start WebSocket server
     */
    private startWebSocket(): void {
        this.logger.info("Starting WebSocket server");

        const wss = this.router.ws(this.path);

        wss.on("connection", (ws, request) => {
            // Verify access token（12.onebot.dev：先 Authorization 头，再 access_token Query）
            const authHeader = request.headers.authorization;
            const url = new URL(request.url!, `ws://localhost`);
            const token =
                (typeof authHeader === "string"
                    ? authHeader.replace(/^Bearer\s+/i, "").trim()
                    : undefined) || url.searchParams.get("access_token");

            if (!this.verifyToken(token as string)) {
                ws.close(1008, "Unauthorized");
                return;
            }

            this.logger.info(`WebSocket client connected: ${this.path}`);

            // 必须先注册监听器，再发送 connect，否则客户端收不到
            const onDispatch = (data: string) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(data);
                }
            };
            this.on("dispatch", onDispatch);

            // Send connect meta event
            this.dispatchMetaEvent("connect", {
                version: this.getVersionInfo(),
            });

            // Handle incoming API calls
            ws.on("message", async data => {
                try {
                    const request = JSON.parse(data.toString());
                    const { action, params, echo } = request;

                    const result = await this.apply(action, params);

                    // Add echo if present
                    const response = echo !== undefined ? { ...result, echo } : result;
                    ws.send(JSON.stringify(response));
                } catch (error) {
                    this.logger.error("WebSocket message error:", error);
                    ws.send(
                        JSON.stringify({
                            status: "failed",
                            retcode: -1,
                            message: error.message,
                            data: null,
                        }),
                    );
                }
            });

            ws.on("close", () => {
                this.logger.info(`WebSocket client disconnected: ${this.path}`);
                this.off("dispatch", onDispatch);
            });

            ws.on("error", error => {
                this.logger.error("WebSocket error:", error);
            });
        });

        this.logger.info(`WebSocket server listening on ${this.path}`);
    }

    /**
     * Start HTTP webhook
     */
    private startHttpWebhook(url: string): void {
        this.logger.info(`Starting HTTP webhook to ${url}`);

        // Listen for dispatch events and POST to external server
        const onDispatch = async (data: string) => {
            try {
                const headers: Record<string, string> = {
                    "Content-Type": "application/json",
                    "User-Agent": "OneBot/12",
                    "X-OneBot-Version": "12",
                    "X-Impl": "onebots",
                };

                // Add access token if configured
                if (this.config.access_token) {
                    headers["Authorization"] = `Bearer ${this.config.access_token}`;
                }

                const response = await fetch(url, {
                    method: "POST",
                    headers,
                    body: data,
                    signal: AbortSignal.timeout(this.config.request_timeout || 15000),
                });

                if (!response.ok) {
                    this.logger.warn(
                        `HTTP webhook POST failed: ${response.status} ${response.statusText}`,
                    );
                }
            } catch (error) {
                this.logger.error(`HTTP webhook POST error:`, error);
            }
        };

        this.on("dispatch", onDispatch);
        this.logger.info(`HTTP webhook configured to POST events to ${url}`);
    }

    /**
     * Start WebSocket reverse
     */
    private startWsReverse(url: string): void {
        this.logger.info(`Starting WebSocket reverse to ${url}`);

        let ws: WebSocket | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

        const connect = () => {
            try {
                // Add access token to URL if configured
                let wsUrl = url;
                if (this.config.access_token) {
                    const separator = url.includes("?") ? "&" : "?";
                    wsUrl = `${url}${separator}access_token=${this.config.access_token}`;
                }

                ws = new WebSocket(wsUrl, {
                    headers: {
                        "User-Agent": "OneBot/12",
                        "X-OneBot-Version": "12",
                        "X-Impl": "onebots",
                    },
                });

                ws.on("open", () => {
                    this.logger.info(`WebSocket reverse connected to ${url}`);

                    // Send connect meta event
                    this.dispatchMetaEvent("connect", {
                        version: this.getVersionInfo(),
                    });

                    // Clear reconnect timer
                    if (reconnectTimer) {
                        clearTimeout(reconnectTimer);
                        reconnectTimer = null;
                    }
                });

                ws.on("message", async (data: Buffer) => {
                    try {
                        const request = JSON.parse(data.toString());
                        const { action, params, echo } = request;

                        const result = await this.apply(action, params);

                        // Add echo if present
                        const response = echo !== undefined ? { ...result, echo } : result;
                        ws.send(JSON.stringify(response));
                    } catch (error) {
                        this.logger.error("WebSocket reverse message error:", error);
                    }
                });

                ws.on("close", () => {
                    // 移除派发监听，避免重连后监听器累积导致事件重复发送
                    this.off("dispatch", onDispatch);
                    this.logger.warn(
                        `WebSocket reverse disconnected from ${url}, reconnecting in 5s...`,
                    );
                    reconnectTimer = setTimeout(connect, 5000);
                });

                ws.on("error", (error: Error) => {
                    this.logger.error("WebSocket reverse error:", error);
                });

                // Listen for dispatch events and send to server
                const onDispatch = (data: string) => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(data);
                    }
                };
                this.on("dispatch", onDispatch);
            } catch (error) {
                this.logger.error(`WebSocket reverse connection failed:`, error);
                reconnectTimer = setTimeout(connect, 5000);
            }
        };

        connect();
    }
}

ProtocolRegistry.register("onebot", "v12", OneBotV12Protocol);

export * from "./types.js";
export * from "./config.js";
