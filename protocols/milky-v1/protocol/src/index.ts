import { Protocol,ProtocolRegistry,Account,Adapter } from "onebots";
import type { CommonEvent, CommonTypes, Schema } from "onebots";
import { Milky } from "./types.js";
import { MilkyConfig } from "./config.js";
import { createHmac } from "crypto";
import { WebSocket } from "ws";

const milkySchema: Schema = {
    use_http: { type: 'boolean', label: '启用 HTTP' },
    use_ws: { type: 'boolean', label: '启用 WebSocket' },
    http_reverse: {
        type: 'array', default: [], label: 'HTTP 反向上报',
        description: '将事件 POST 到下游服务。展开单项可覆盖鉴权与超时。',
        ui: {
            widget: 'endpoint-list', itemLabel: 'Webhook', addLabel: '添加 Webhook', schemes: ['http:', 'https:'],
            fields: [
                { key: 'access_token', label: 'Access Token', sensitive: true, placeholder: '留空则使用全局 Token' },
                { key: 'secret', label: '签名 Secret', sensitive: true, placeholder: '留空则使用全局 Secret' },
                { key: 'post_timeout', label: '超时（秒）', type: 'number', placeholder: '例如 15' },
            ],
        },
    },
    ws_reverse: {
        type: 'array', default: [], label: '反向 WebSocket',
        description: '由 OneBots 主动连接下游服务。展开单项可覆盖鉴权与重连间隔。',
        ui: {
            widget: 'endpoint-list', itemLabel: '连接', addLabel: '添加连接', schemes: ['ws:', 'wss:'],
            fields: [
                { key: 'access_token', label: 'Access Token', sensitive: true, placeholder: '留空则使用全局 Token' },
                { key: 'reconnect_interval', label: '重连间隔（秒）', type: 'number', placeholder: '例如 5' },
            ],
        },
    },
    access_token: { type: 'string', label: 'Access Token' },
    secret: { type: 'string', label: 'Secret' },
    filters: Protocol.FilterSchema,
};

ProtocolRegistry.registerSchema('milky.v1', milkySchema);

/**
 * Milky Protocol V1 Implementation
 * Milky is a QQ bot protocol similar to OneBot but with different message formats
 * Reference: https://milky.ntqqrev.org/
 */
export class MilkyV1 extends Protocol<"v1", MilkyConfig.Config> {
    public readonly name = "milky";
    public readonly version = "v1" as const;

    constructor(
        public adapter: Adapter,
        public account: Account,
        config: Protocol.Config,
    ) {
        super(adapter,account,{
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

    async stop(force?: boolean): Promise<void> {
        this.logger.info(`Stopping Milky protocol v1`);
        // Clean up Milky protocol resources
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
            milkyEvent = this.convertToMilkyFormat(event as CommonEvent.Event);
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
    private async executeAction(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
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
            case "get_forwarded_messages":
                return this.getForwardMessage(params);
            case "get_login_info":
                return this.getLoginInfo();
            case "get_user_profile":
                return this.getStrangerInfo(params);
            case "get_friend_info":
                return this.getFriendInfo(params);
            case "get_friend_list":
                return this.getFriendList();
            case "get_group_info":
                return this.getGroupInfo(params);
            case "get_group_list":
                return this.getGroupList();
            case "get_group_member_info":
                return this.getGroupMemberInfo(params);
            case "get_group_member_list":
                return this.getGroupMemberList(params);
            case "kick_group_member":
                return this.kickGroupMember(params);
            case "set_group_member_mute":
                return this.setGroupMemberMute(params);
            case "set_group_member_admin":
                return this.setGroupMemberAdmin(params);
            case "set_group_member_card":
                return this.setGroupMemberCard(params);
            case "set_group_name":
                return this.setGroupName(params);
            case "quit_group":
                return this.quitGroup(params);
            case "accept_friend_request":
                return this.handleFriendRequest(params, true);
            case "reject_friend_request":
                return this.handleFriendRequest(params, false);
            case "accept_group_request":
            case "accept_group_invitation":
                return this.handleGroupRequest(action, params, true);
            case "reject_group_request":
            case "reject_group_invitation":
                return this.handleGroupRequest(action, params, false);
            default:
                throw new Error(`Unknown action: ${action}`);
        }
    }

    /**
     * Convert CommonEvent to Milky-specific format
     */
    private convertToMilkyFormat(event: CommonEvent.Event): Milky.Event | null {
        switch (event.type) {
            case "message":
                return this.formatMilkyMessage(event);
            case "notice":
                return this.formatMilkyNotice(event);
            case "request":
                return this.formatMilkyRequest(event);
            case "meta":
                return this.formatMilkyMeta(event);
            default:
                return null;
        }
    }

    private formatMilkyMessage(event: CommonEvent.Message): Milky.MessageEvent {
        const isGroup = event.message_type === "group" && event.group !== undefined;
        const sender = event.sender.id.number;
        const peer = isGroup ? event.group!.id.number : sender;
        return {
            time: Math.floor(event.timestamp / 1000),
            self_id: event.bot_id.number,
            event_type: "message_receive",
            data: {
                message_scene: isGroup ? "group" : "friend",
                peer_id: peer,
                message_seq: event.message_id.number,
                sender_id: sender,
                time: Math.floor(event.timestamp / 1000),
                segments: event.message.map(seg => ({
                    type: seg.type as Milky.SegmentType,
                    data: seg.data,
                })),
                ...(isGroup
                    ? {
                          group: {
                              group_id: peer,
                              group_name: event.group?.name,
                          },
                          group_member: {
                              user_id: sender,
                              nickname: event.sender.name,
                          },
                      }
                    : {
                          friend: {
                              user_id: sender,
                              nickname: event.sender.name,
                          },
                      }),
            },
        };
    }

    private formatMilkyNotice(event: CommonEvent.Notice): Milky.NoticeEvent {
        const eventTypes: Partial<Record<CommonEvent.NoticeType, string>> = {
            group_increase: "group_member_increase",
            group_decrease: "group_member_decrease",
            group_admin: "group_admin_change",
            group_ban: "group_member_mute",
            friend_add: "friend_increase",
        };
        return {
            time: Math.floor(event.timestamp / 1000),
            self_id: event.bot_id.number,
            event_type: eventTypes[event.notice_type] ?? "custom_notice",
            data: {
                ...(event.user ? { user_id: event.user.id.number } : {}),
                ...(event.group ? { group_id: event.group.id.number } : {}),
                ...(event.operator ? { operator_id: event.operator.id.number } : {}),
            },
        };
    }

    private formatMilkyRequest(event: CommonEvent.Request): Milky.RequestEvent {
        const subType = (event as CommonEvent.Request & { sub_type?: string }).sub_type;
        const isGroup = event.request_type === "group";
        return {
            time: Math.floor(event.timestamp / 1000),
            self_id: event.bot_id.number,
            event_type: isGroup
                ? subType === "invite"
                    ? "group_invited_join_request"
                    : "group_join_request"
                : "friend_request",
            data: isGroup
                ? {
                      group_id: event.group?.id.number,
                      initiator_id: event.user.id.number,
                      notification_seq: event.id.number,
                      comment: event.comment ?? "",
                      is_filtered: false,
                  }
                : {
                      initiator_id: event.user.id.number,
                      initiator_uid: event.flag,
                      comment: event.comment ?? "",
                      is_filtered: false,
                  },
        };
    }

    private formatMilkyMeta(event: CommonEvent.Meta): Milky.MetaEvent | null {
        if (event.meta_type !== "lifecycle" || event.sub_type !== "disable") return null;
        return {
            time: Math.floor(event.timestamp / 1000),
            self_id: event.bot_id.number,
            event_type: "bot_offline",
            data: { reason: "adapter offline" },
        };
    }

    private extractPlainText(segments: CommonTypes.Segment[]): string {
        return segments
            .filter(seg => seg.type === "text")
            .map(seg => seg.data.text || "")
            .join("");
    }

    // Action implementations
    private async sendPrivateMessage(params: Record<string, unknown>): Promise<Milky.SendMessageResult> {
        const { user_id, message } = params as { user_id: string; message: Milky.Segment[] };
        const result = await this.adapter.sendMessage(this.account.account_id, {
            scene_type: "private",
            scene_id: this.adapter.resolveId(user_id),
            message,
        });
        return { message_seq: result.message_id.number, time: Math.floor(Date.now() / 1000) };
    }

    private async sendGroupMessage(params: Record<string, unknown>): Promise<Milky.SendMessageResult> {
        const { group_id, message } = params as { group_id: string; message: Milky.Segment[] };
        const result = await this.adapter.sendMessage(this.account.account_id, {
            scene_type: "group",
            scene_id: this.adapter.resolveId(group_id),
            message,
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
        const { message_id } = params as { message_id: string };
        const msg = await this.adapter.getMessage(this.account.account_id, {
            message_id: this.adapter.resolveId(message_id),
        });
        return {
            time: msg.time || Math.floor(Date.now() / 1000),
            message_type: (msg.sender.scene_type as "private" | "group"),
            message_id: msg.message_id.string,
            real_id: 0,
            sender: {
                user_id: msg.sender.sender_id.string,
                nickname: msg.sender.sender_name,
            },
            message: msg.message as unknown as Milky.Segment[],
        };
    }

    private async getForwardMessage(_params: Record<string, unknown>): Promise<unknown> {
        // Forward message handling - platform specific
        throw new Error("Forward message not supported by this adapter");
    }

    private async getLoginInfo(): Promise<Milky.LoginInfo> {
        const info = await this.adapter.getLoginInfo(this.account.account_id);
        return {
            uin: info.user_id.number,
            nickname: info.user_name,
        };
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

    private async getFriendInfo(params: Record<string, unknown>): Promise<{ friend: Milky.FriendInfo }> {
        const { user_id } = params as { user_id: string };
        const info = await this.adapter.getFriendInfo(this.account.account_id, {
            user_id: this.adapter.resolveId(user_id),
        });
        return { friend: {
            user_id: info.user_id.number,
            nickname: info.user_name,
            remark: info.remark ?? "",
        } };
    }

    private async getFriendList(): Promise<{ friends: Milky.FriendInfo[] }> {
        const result = await this.adapter.getFriendList(this.account.account_id);
        return { friends: result.map(info => ({
            user_id: info.user_id.number,
            nickname: info.user_name,
            remark: info.remark || "",
        })) };
    }

    private async getGroupInfo(params: Record<string, unknown>): Promise<{ group: Milky.GroupInfo }> {
        const { group_id } = params as { group_id: string };
        const info = await this.adapter.getGroupInfo(this.account.account_id, {
            group_id: this.adapter.resolveId(group_id),
        });
        return { group: {
            group_id: info.group_id.number,
            group_name: info.group_name,
            member_count: info.member_count || 0,
            max_member_count: info.max_member_count || 0,
        } };
    }

    private async getGroupList(): Promise<{ groups: Milky.GroupInfo[] }> {
        const result = await this.adapter.getGroupList(this.account.account_id);
        return { groups: result.map(info => ({
            group_id: info.group_id.number,
            group_name: info.group_name,
            member_count: info.member_count || 0,
            max_member_count: info.max_member_count || 0,
        })) };
    }

    private async getGroupMemberInfo(params: Record<string, unknown>): Promise<{ member: Milky.GroupMemberInfo }> {
        const { group_id, user_id } = params as { group_id: string; user_id: string };
        const info = await this.adapter.getGroupMemberInfo(this.account.account_id, {
            group_id: this.adapter.resolveId(group_id),
            user_id: this.adapter.resolveId(user_id),
        });
        return { member: {
            group_id: info.group_id.number,
            user_id: info.user_id.number,
            nickname: info.user_name,
            card: info.card || "",
            sex: "unknown",
            age: 0,
            area: "",
            join_time: 0,
            last_sent_time: 0,
            level: "",
            role: info.role || "member",
            unfriendly: false,
            title: "",
            title_expire_time: 0,
            card_changeable: false,
        } };
    }

    private async getGroupMemberList(params: Record<string, unknown>): Promise<{ members: Milky.GroupMemberInfo[] }> {
        const { group_id } = params as { group_id: string };
        const list = await this.adapter.getGroupMemberList(this.account.account_id, {
            group_id: this.adapter.resolveId(group_id),
        });
        return { members: list.map(info => ({
            group_id: info.group_id.number,
            user_id: info.user_id.number,
            nickname: info.user_name,
            card: info.card || "",
            sex: "unknown",
            age: 0,
            area: "",
            join_time: 0,
            last_sent_time: 0,
            level: "",
            role: info.role || "member",
            unfriendly: false,
            title: "",
            title_expire_time: 0,
            card_changeable: false,
        })) };
    }

    private async kickGroupMember(params: Record<string, unknown>): Promise<void> {
        const { group_id, user_id, reject_add_request } = params as {
            group_id: number;
            user_id: number;
            reject_add_request?: boolean;
        };
        await this.adapter.kickGroupMember(this.account.account_id, {
            group_id: this.adapter.resolveId(group_id),
            user_id: this.adapter.resolveId(user_id),
            reject_add_request,
        });
    }

    private async setGroupMemberMute(params: Record<string, unknown>): Promise<void> {
        const { group_id, user_id, duration } = params as {
            group_id: number;
            user_id: number;
            duration: number;
        };
        await this.adapter.muteGroupMember(this.account.account_id, {
            group_id: this.adapter.resolveId(group_id),
            user_id: this.adapter.resolveId(user_id),
            duration,
        });
    }

    private async setGroupMemberAdmin(params: Record<string, unknown>): Promise<void> {
        const { group_id, user_id, enable } = params as {
            group_id: number;
            user_id: number;
            enable: boolean;
        };
        await this.adapter.setGroupAdmin(this.account.account_id, {
            group_id: this.adapter.resolveId(group_id),
            user_id: this.adapter.resolveId(user_id),
            enable,
        });
    }

    private async setGroupMemberCard(params: Record<string, unknown>): Promise<void> {
        const { group_id, user_id, card } = params as {
            group_id: number;
            user_id: number;
            card: string;
        };
        await this.adapter.setGroupCard(this.account.account_id, {
            group_id: this.adapter.resolveId(group_id),
            user_id: this.adapter.resolveId(user_id),
            card,
        });
    }

    private async setGroupName(params: Record<string, unknown>): Promise<void> {
        const { group_id, new_group_name } = params as {
            group_id: number;
            new_group_name: string;
        };
        await this.adapter.setGroupName(this.account.account_id, {
            group_id: this.adapter.resolveId(group_id),
            group_name: new_group_name,
        });
    }

    private async quitGroup(params: Record<string, unknown>): Promise<void> {
        const { group_id, is_dismiss } = params as { group_id: number; is_dismiss?: boolean };
        await this.adapter.leaveGroup(this.account.account_id, {
            group_id: this.adapter.resolveId(group_id),
            is_dismiss,
        });
    }

    private async handleFriendRequest(
        params: Record<string, unknown>,
        approve: boolean,
    ): Promise<void> {
        await this.adapter.handleFriendRequest(this.account.account_id, {
            flag: String(params.initiator_uid ?? ""),
            approve,
        });
    }

    private async handleGroupRequest(
        action: string,
        params: Record<string, unknown>,
        approve: boolean,
    ): Promise<void> {
        const invitation = action.includes("invitation");
        const flag = invitation
            ? `${params.group_id}:${params.invitation_seq}`
            : `${params.group_id}:${params.notification_type}:${params.notification_seq}`;
        await this.adapter.handleGroupRequest(this.account.account_id, {
            flag,
            type: invitation ? "invitation" : "request",
            sub_type: invitation ? "invite" : params.notification_type === "join_request" ? "add" : "invite",
            approve,
            reason: typeof params.reason === "string" ? params.reason : undefined,
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
        
        const hmac = createHmac('sha1', secret);
        const expected = 'sha1=' + hmac.update(body).digest('hex');
        return signature === expected;
    }

    // Service implementations
    private startHttp(): void {
        this.logger.info("Starting Milky HTTP server");
        
        // Register HTTP POST endpoint for API calls
        this.router.post(`${this.path}/api/:action`, async (ctx) => {
            // Milky 通信规范：不支持的 Content-Type 返回 415
            const contentType = ctx.headers['content-type'] || '';
            if (!contentType.toLowerCase().includes('application/json')) {
                ctx.status = 415;
                return;
            }
            // Verify access token（Authorization: Bearer 优先，再 Query）
            const authHeader = ctx.headers.authorization;
            const token = (typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '').trim() : undefined) || ctx.query.access_token;
            if (!this.verifyToken(token as string)) {
                ctx.status = 401;
                ctx.body = { status: "failed", retcode: 1403, message: "Unauthorized" };
                return;
            }

            const action = ctx.params.action;
            const params = ((ctx.request as unknown as Record<string, unknown>).body ?? {}) as Record<string, unknown>;

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
        
        const wss = this.router.ws(this.path+'/event');
        
        wss.on("connection", (ws, request) => {
            // Verify access token
            const url = new URL(request.url!, `ws://localhost`);
            const token = url.searchParams.get('access_token') || request.headers.authorization?.replace('Bearer ', '');
            
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
            ws.on("message", async (data) => {
                try {
                    const request = JSON.parse(data.toString());
                    const { action, params, echo } = request;

                    const result = await this.apply(action, params);
                    ws.send(JSON.stringify({ ...result, echo }));
                } catch (error) {
                    this.logger.error("WebSocket message error:", error);
                    ws.send(JSON.stringify({
                        status: "failed",
                        retcode: -1,
                        message: error.message,
                    }));
                }
            });

            ws.on("close", () => {
                this.logger.info(`Milky WebSocket client disconnected: ${this.path}`);
                this.off("dispatch", onDispatch);
            });

            ws.on("error", (error) => {
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
                    'Content-Type': 'application/json',
                    'User-Agent': 'Milky/1.0',
                    'X-Self-ID': this.account.account_id,
                };

                // Add access token if configured
                const token = config.access_token || this.config.access_token;
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                // Add signature if secret is configured
                const secret = config.secret || this.config.secret;
                if (secret) {
                    const hmac = createHmac('sha1', secret);
                    headers['X-Signature'] = 'sha1=' + hmac.update(data).digest('hex');
                }

                const response = await fetch(config.url, {
                    method: 'POST',
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
        
        let ws: WebSocket | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

        const connect = () => {
            try {
                // Add access token to URL if configured
                let wsUrl = config.url;
                const token = config.access_token || this.config.access_token;
                if (token) {
                    const separator = wsUrl.includes('?') ? '&' : '?';
                    wsUrl = `${wsUrl}${separator}access_token=${token}`;
                }

                ws = new WebSocket(wsUrl, {
                    headers: {
                        'User-Agent': 'Milky/1.0',
                        'X-Self-ID': this.account.account_id,
                        'X-Client-Role': 'Universal',
                    },
                });

                ws.on('open', () => {
                    this.logger.info(`Milky WebSocket reverse connected to ${config.url}`);
                    
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
                        ws.send(JSON.stringify({ ...result, echo }));
                    } catch (error) {
                        this.logger.error("WebSocket reverse message error:", error);
                    }
                });

                ws.on('close', () => {
                    // 移除派发监听，避免重连后监听器累积导致事件重复发送
                    this.off("dispatch", onDispatch);
                    const interval = (config.reconnect_interval || 5) * 1000;
                    this.logger.warn(`Milky WebSocket reverse disconnected from ${config.url}, reconnecting in ${config.reconnect_interval || 5}s...`);
                    reconnectTimer = setTimeout(connect, interval);
                });

                ws.on('error', (error: Error) => {
                    this.logger.error("Milky WebSocket reverse error:", error);
                });

                // Listen for dispatch events and send to server
                const onDispatch = (data: string) => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(data);
                    }
                };
                this.on("dispatch", onDispatch);

            } catch (error) {
                this.logger.error(`Milky WebSocket reverse connection failed:`, error);
                const interval = (config.reconnect_interval || 5) * 1000;
                reconnectTimer = setTimeout(connect, interval);
            }
        };

        connect();
    }

}
ProtocolRegistry.register("milky", "v1", MilkyV1);
export * from "./types.js";
export * from "./config.js";
