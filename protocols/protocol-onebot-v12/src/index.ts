import { Protocol } from "onebots";
import { Account } from "onebots";
import { Adapter } from "onebots";
import { CommonEvent,CommonTypes } from "onebots";
import { OneBotV12 } from "./types.js";
import { WebSocket } from "ws";
import { OneBotV12Config } from "./config.js";

/**
 * OneBot V12 Protocol Implementation
 * Implements the OneBot 12 standard
 * Reference: https://12.onebot.dev
 */
export default class OneBotV12Protocol extends Protocol<"v12", OneBotV12Config.Config> {
    public readonly name = "onebot";
    public readonly version = "v12" as const;
    private eventIdCounter = 0;
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

        // Send connect meta event
        this.dispatchMetaEvent("connect", {
            version: this.getVersionInfo(),
        });
    }

    /**
     * Stop the protocol service
     */
    async stop(force?: boolean): Promise<void> {
        this.logger.info(`Stopping OneBot V12 protocol`);
        this.removeAllListeners();
    }

    /**
     * Dispatch event to OneBot V12 format
     */
    dispatch(event: any): void {
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
    format(event: string, payload: any): any {
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
    async apply(action: string, params?: any): Promise<OneBotV12.Response> {
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
    private async executeAction(action: string, params: any = {}): Promise<any> {
        switch (action) {
            // Message API
            case "send_message":
                return this.sendMessage(params);
            case "delete_message":
                return this.deleteMessage(params);

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
                return this.getUserInfo(params);
            case "get_friend_list":
                return this.getFriendList();

            // Group API
            case "get_group_info":
                return this.getGroupInfo(params);
            case "get_group_list":
                return this.getGroupList();
            case "get_group_member_info":
                return this.getGroupMemberInfo(params);
            case "get_group_member_list":
                return this.getGroupMemberList(params);
            case "set_group_name":
                return this.setGroupName(params);
            case "leave_group":
                return this.leaveGroup(params);

            // Guild API
            case "get_guild_info":
                return this.getGuildInfo(params);
            case "get_guild_list":
                return this.getGuildList();
            case "set_guild_name":
                return this.setGuildName(params);
            case "get_guild_member_info":
                return this.getGuildMemberInfo(params);
            case "get_guild_member_list":
                return this.getGuildMemberList(params);
            case "leave_guild":
                return this.leaveGuild(params);

            // Channel API
            case "get_channel_info":
                return this.getChannelInfo(params);
            case "get_channel_list":
                return this.getChannelList(params);
            case "set_channel_name":
                return this.setChannelName(params);
            case "get_channel_member_info":
                return this.getChannelMemberInfo(params);
            case "get_channel_member_list":
                return this.getChannelMemberList(params);
            case "leave_channel":
                return this.leaveChannel(params);

            // File API
            case "upload_file":
                return this.uploadFile(params);
            case "upload_file_fragmented_prepare":
                return this.uploadFileFragmentedPrepare(params);
            case "upload_file_fragmented_transfer":
                return this.uploadFileFragmentedTransfer(params);
            case "upload_file_fragmented_finish":
                return this.uploadFileFragmentedFinish(params);
            case "get_file":
                return this.getFile(params);
            case "get_file_fragmented_prepare":
                return this.getFileFragmentedPrepare(params);
            case "get_file_fragmented_transfer":
                return this.getFileFragmentedTransfer(params);

            default:
                throw new Error(`Unknown action: ${action}`);
        }
    }

    // ============ Message API Implementations ============

    private async sendMessage(params: OneBotV12.SendMessageParams): Promise<OneBotV12.SendMessageResponse> {
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
            message_id: String(result.message_id),
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
        return [
            "send_message",
            "delete_message",
            "get_self_info",
            "get_user_info",
            "get_friend_list",
            "get_group_info",
            "get_group_list",
            "get_group_member_info",
            "get_group_member_list",
            "set_group_name",
            "leave_group",
            "get_status",
            "get_version",
            "get_supported_actions",
        ];
    }

    private async getStatus(): Promise<OneBotV12.Status> {
        return {
            good: true,
            bots: [{
                self: this.getSelfInfo(),
                online: true,
            }],
        };
    }

    private getVersionInfo(): OneBotV12.VersionInfo {
        return {
            impl: "onebots",
            version: "1.0.0",
            onebot_version: "12",
        };
    }

    // ============ User API Implementations ============

    private async getUserInfo(params: OneBotV12.GetUserInfoParams): Promise<OneBotV12.UserInfo> {
        const userInfo = await this.adapter.getUserInfo(this.account.account_id, {
            user_id: this.adapter.resolveId(params.user_id),
        });

        return {
            user_id: String(userInfo.user_id),
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
            group_id: String(group.group_id),
            group_name: group.group_name,
        }));
    }

    private async getGroupMemberInfo(params: OneBotV12.GetGroupMemberInfoParams): Promise<OneBotV12.GroupMemberInfo> {
        const memberInfo = await this.adapter.getGroupMemberInfo(this.account.account_id, {
            group_id: this.adapter.resolveId(params.group_id),
            user_id: this.adapter.resolveId(params.user_id),
        });

        return {
            user_id: memberInfo.user_id.string,
            user_name: memberInfo.user_name,
        };
    }

    private async getGroupMemberList(params: OneBotV12.GetGroupMemberListParams): Promise<OneBotV12.GroupMemberInfo[]> {
        const members = await this.adapter.getGroupMemberList(this.account.account_id, {
            group_id: this.adapter.resolveId(params.group_id),
        });

        return members.map(member => ({
            user_id: member.user_id.string,
            user_name: member.user_name,
        }));
    }

    private async setGroupName(params: OneBotV12.SetGroupNameParams): Promise<void> {
        // Implementation depends on adapter support
        throw new Error("set_group_name not implemented");
    }

    private async leaveGroup(params: OneBotV12.LeaveGroupParams): Promise<void> {
        // Implementation depends on adapter support
        throw new Error("leave_group not implemented");
    }

    // ============ Guild API Implementations ============

    private async getGuildInfo(params: OneBotV12.GetGuildInfoParams): Promise<OneBotV12.GuildInfo> {
        // Implementation depends on adapter support
        throw new Error("get_guild_info not implemented");
    }

    private async getGuildList(): Promise<OneBotV12.GuildInfo[]> {
        // Implementation depends on adapter support
        throw new Error("get_guild_list not implemented");
    }

    private async setGuildName(params: OneBotV12.SetGuildNameParams): Promise<void> {
        // Implementation depends on adapter support
        throw new Error("set_guild_name not implemented");
    }

    private async getGuildMemberInfo(params: OneBotV12.GetGuildMemberInfoParams): Promise<OneBotV12.GuildMemberInfo> {
        // Implementation depends on adapter support
        throw new Error("get_guild_member_info not implemented");
    }

    private async getGuildMemberList(params: OneBotV12.GetGuildMemberListParams): Promise<OneBotV12.GuildMemberInfo[]> {
        // Implementation depends on adapter support
        throw new Error("get_guild_member_list not implemented");
    }

    private async leaveGuild(params: OneBotV12.LeaveGuildParams): Promise<void> {
        // Implementation depends on adapter support
        throw new Error("leave_guild not implemented");
    }

    // ============ Channel API Implementations ============

    private async getChannelInfo(params: OneBotV12.GetChannelInfoParams): Promise<OneBotV12.ChannelInfo> {
        const channelInfo = await this.adapter.getChannelInfo(this.account.account_id, {
            channel_id: this.adapter.resolveId(params.channel_id),
        });

        return {
            channel_id: channelInfo.channel_id.string,
            channel_name: channelInfo.channel_name,
        };
    }

    private async getChannelList(params: OneBotV12.GetChannelListParams): Promise<OneBotV12.ChannelInfo[]> {
        // Implementation depends on adapter support
        throw new Error("get_channel_list not implemented");
    }

    private async setChannelName(params: OneBotV12.SetChannelNameParams): Promise<void> {
        // Implementation depends on adapter support
        throw new Error("set_channel_name not implemented");
    }

    private async getChannelMemberInfo(params: OneBotV12.GetChannelMemberInfoParams): Promise<OneBotV12.ChannelMemberInfo> {
        // Implementation depends on adapter support
        throw new Error("get_channel_member_info not implemented");
    }

    private async getChannelMemberList(params: OneBotV12.GetChannelMemberListParams): Promise<OneBotV12.ChannelMemberInfo[]> {
        // Implementation depends on adapter support
        throw new Error("get_channel_member_list not implemented");
    }

    private async leaveChannel(params: OneBotV12.LeaveChannelParams): Promise<void> {
        // Implementation depends on adapter support
        throw new Error("leave_channel not implemented");
    }

    // ============ File API Implementations ============

    private async uploadFile(params: OneBotV12.UploadFileParams): Promise<OneBotV12.FileInfo> {
        // Implementation depends on adapter support
        throw new Error("upload_file not implemented");
    }

    private async uploadFileFragmentedPrepare(params: OneBotV12.UploadFileFragmentedPrepareParams): Promise<{ file_id: string }> {
        // Implementation depends on adapter support
        throw new Error("upload_file_fragmented_prepare not implemented");
    }

    private async uploadFileFragmentedTransfer(params: OneBotV12.UploadFileFragmentedTransferParams): Promise<void> {
        // Implementation depends on adapter support
        throw new Error("upload_file_fragmented_transfer not implemented");
    }

    private async uploadFileFragmentedFinish(params: OneBotV12.UploadFileFragmentedFinishParams): Promise<OneBotV12.FileInfo> {
        // Implementation depends on adapter support
        throw new Error("upload_file_fragmented_finish not implemented");
    }

    private async getFile(params: OneBotV12.GetFileParams): Promise<OneBotV12.FileInfo> {
        // Implementation depends on adapter support
        throw new Error("get_file not implemented");
    }

    private async getFileFragmentedPrepare(params: OneBotV12.GetFileFragmentedPrepareParams): Promise<{ name: string; total_size: number; sha256?: string }> {
        // Implementation depends on adapter support
        throw new Error("get_file_fragmented_prepare not implemented");
    }

    private async getFileFragmentedTransfer(params: OneBotV12.GetFileFragmentedTransferParams): Promise<{ data: string | Uint8Array }> {
        // Implementation depends on adapter support
        throw new Error("get_file_fragmented_transfer not implemented");
    }

    // ============ Utility Methods ============

    /**
     * Convert common event to OneBot V12 format
     */
    private convertToV12Format(event: CommonEvent.Event): OneBotV12.BaseEvent | null {
        const base = {
            id: event.id.string,
            time: Math.floor(event.timestamp / 1000),
            self: this.getSelfInfo(),
        };

        if (event.type === "message") {
            const messageEvent: OneBotV12.MessageEvent = {
                ...base,
                type: "message",
                detail_type: event.message_type === "private" ? "private" :
                    event.message_type === "group" ? "group" :
                        event.message_type === "channel" ? "channel" : "private",
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
            return {
                ...base,
                type: "notice",
                detail_type: event.notice_type as any,
                sub_type: "",
            };
        } else if (event.type === "request") {
            return {
                ...base,
                type: "request",
                detail_type: event.request_type as any,
                sub_type: "",
            };
        } else if (event.type === "meta") {
            return {
                ...base,
                type: "meta",
                detail_type: event.meta_type as any,
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
     * Dispatch meta event
     */
    private dispatchMetaEvent(detailType: string, extra: any = {}): void {
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
        this.router.post(`${this.path}/:action`, async (ctx) => {
            // Verify access token
            const token = ctx.query.access_token || ctx.headers.authorization?.replace('Bearer ', '');
            if (!this.verifyToken(token as string)) {
                ctx.status = 401;
                ctx.body = { status: "failed", retcode: 1403, message: "Unauthorized", data: null };
                return;
            }

            const action = ctx.params.action;
            const params = ctx.request.body;

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
            // Verify access token
            const url = new URL(request.url!, `ws://localhost`);
            const token = url.searchParams.get('access_token') || request.headers.authorization?.replace('Bearer ', '');

            if (!this.verifyToken(token as string)) {
                ws.close(1008, "Unauthorized");
                return;
            }

            this.logger.info(`WebSocket client connected: ${this.path}`);

            // Send connect meta event
            this.dispatchMetaEvent("connect", {
                version: this.getVersionInfo(),
            });

            // Listen for dispatch events and send to client
            const onDispatch = (data: string) => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(data);
                }
            };
            this.on("dispatch", onDispatch);

            // Handle incoming API calls
            ws.on("message", async (data) => {
                try {
                    const request = JSON.parse(data.toString());
                    const { action, params, echo } = request;

                    const result = await this.apply(action, params);

                    // Add echo if present
                    const response = echo !== undefined ? { ...result, echo } : result;
                    ws.send(JSON.stringify(response));
                } catch (error) {
                    this.logger.error("WebSocket message error:", error);
                    ws.send(JSON.stringify({
                        status: "failed",
                        retcode: -1,
                        message: error.message,
                        data: null,
                    }));
                }
            });

            ws.on("close", () => {
                this.logger.info(`WebSocket client disconnected: ${this.path}`);
                this.off("dispatch", onDispatch);
            });

            ws.on("error", (error) => {
                this.logger.error("WebSocket error:", error);
            });
        });

        // Setup heartbeat
        if (this.config.heartbeat_interval) {
            setInterval(() => {
                this.dispatchMetaEvent("heartbeat", {
                    interval: this.config.heartbeat_interval,
                });
            }, this.config.heartbeat_interval);
        }

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
                const headers: any = {
                    'Content-Type': 'application/json',
                    'User-Agent': 'OneBot/12',
                    'X-OneBot-Version': '12',
                    'X-Impl': 'onebots',
                };

                // Add access token if configured
                if (this.config.access_token) {
                    headers['Authorization'] = `Bearer ${this.config.access_token}`;
                }

                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: data,
                    signal: AbortSignal.timeout(this.config.request_timeout || 15000),
                });

                if (!response.ok) {
                    this.logger.warn(`HTTP webhook POST failed: ${response.status} ${response.statusText}`);
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

        let ws: any = null;
        let reconnectTimer: any = null;

        const connect = () => {
            try {
                // Add access token to URL if configured
                let wsUrl = url;
                if (this.config.access_token) {
                    const separator = url.includes('?') ? '&' : '?';
                    wsUrl = `${url}${separator}access_token=${this.config.access_token}`;
                }

                ws = new WebSocket(wsUrl, {
                    headers: {
                        'User-Agent': 'OneBot/12',
                        'X-OneBot-Version': '12',
                        'X-Impl': 'onebots',
                    },
                });

                ws.on('open', () => {
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

                ws.on('message', async (data: Buffer) => {
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

                ws.on('close', () => {
                    this.logger.warn(`WebSocket reverse disconnected from ${url}, reconnecting in 5s...`);
                    reconnectTimer = setTimeout(connect, 5000);
                });

                ws.on('error', (error: Error) => {
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

export * from "./types.js";
export * from "./config.js";
