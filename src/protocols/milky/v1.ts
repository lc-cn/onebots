import { Protocol } from "../base";
import { Account } from "@/account";
import { Adapter } from "@/adapter";
import { Dict } from "@zhinjs/shared";
import { CommonEvent } from "@/common-types";
import { Milky } from "./types";
import { MilkyConfig } from "./config";
import { Logger } from "log4js";
import { createHmac } from "crypto";
import { WebSocket } from "ws";

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
        super(adapter, account, {
            ...config,
            protocol: "milky",
            version: "v1",
        });
    }

    filterFn(event: Dict): boolean {
        // Implement Milky-specific event filtering
        // For now, accept all events
        return true;
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

        // Start heartbeat
        if (this.config.heartbeat) {
            this.startHeartbeat();
        }
    }

    async stop(force?: boolean): Promise<void> {
        this.logger.info(`Stopping Milky protocol v1`);
        // Clean up Milky protocol resources
        this.removeAllListeners();
    }

    dispatch(event: Milky.Event): void {
        // Dispatch Milky-formatted event
        this.emit("dispatch", JSON.stringify(event));
    }

    /**
     * Convert common event to Milky format and dispatch
     */
    dispatchCommonEvent(commonEvent: CommonEvent.Event): void {
        // Convert CommonEvent to Milky format
        const milkyEvent = this.convertToMilkyFormat(commonEvent);
        if (milkyEvent) {
            this.dispatch(milkyEvent);
        }
    }

    format(event: string, payload: any): any {
        // Format event according to Milky specification
        return {
            ...payload,
            post_type: event,
        };
    }

    async apply(action: string, params?: any): Promise<Milky.Response> {
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
    private async executeAction(action: string, params: any): Promise<any> {
        switch (action) {
            case "send_private_msg":
                return this.sendPrivateMessage(params);
            case "send_group_msg":
                return this.sendGroupMessage(params);
            case "send_msg":
                return this.sendMessage(params);
            case "delete_msg":
                return this.deleteMessage(params);
            case "get_msg":
                return this.getMessage(params);
            case "get_forward_msg":
                return this.getForwardMessage(params);
            case "get_login_info":
                return this.getLoginInfo();
            case "get_stranger_info":
                return this.getStrangerInfo(params);
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
        return {
            time: Math.floor(event.timestamp / 1000),
            self_id: event.bot_id,
            post_type: "message",
            message_type: event.message_type as "private" | "group",
            message_id: event.message_id,
            user_id: event.sender.id,
            message: event.message.map(seg => ({
                type: seg.type as any,
                data: seg.data,
            })),
            raw_message: event.raw_message || this.extractPlainText(event.message),
            font: 0,
            sender: {
                user_id: event.sender.id,
                nickname: event.sender.name,
            },
            ...(event.group ? { group_id: event.group.id } : {}),
        };
    }

    private formatMilkyNotice(event: CommonEvent.Notice): Milky.NoticeEvent {
        return {
            time: Math.floor(event.timestamp / 1000),
            self_id: event.bot_id,
            post_type: "notice",
            notice_type: event.notice_type as any,
            user_id: event.user?.id,
            group_id: event.group?.id,
            operator_id: event.operator?.id,
        };
    }

    private formatMilkyRequest(event: CommonEvent.Request): Milky.RequestEvent {
        return {
            time: Math.floor(event.timestamp / 1000),
            self_id: event.bot_id,
            post_type: "request",
            request_type: event.request_type as any,
            user_id: event.user.id,
            comment: event.comment || "",
            flag: event.flag,
            group_id: event.group?.id,
        };
    }

    private formatMilkyMeta(event: CommonEvent.Meta): Milky.MetaEvent {
        return {
            time: Math.floor(event.timestamp / 1000),
            self_id: event.bot_id,
            post_type: "meta_event",
            meta_event_type: event.meta_type as any,
        };
    }

    private extractPlainText(segments: CommonEvent.Segment[]): string {
        return segments
            .filter(seg => seg.type === "text")
            .map(seg => seg.data.text || "")
            .join("");
    }

    // Action implementations
    private async sendPrivateMessage(params: any): Promise<Milky.SendMessageResult> {
        const result = await this.adapter.sendMessage(this.account.account_id, {
            scene_type: "private",
            scene_id: params.user_id,
            message: params.message,
        });
        return { message_id: result.message_id };
    }

    private async sendGroupMessage(params: any): Promise<Milky.SendMessageResult> {
        const result = await this.adapter.sendMessage(this.account.account_id, {
            scene_type: "group",
            scene_id: params.group_id,
            message: params.message,
        });
        return { message_id: result.message_id };
    }

    private async sendMessage(params: any): Promise<Milky.SendMessageResult> {
        if (params.message_type === "private") {
            return this.sendPrivateMessage(params);
        } else {
            return this.sendGroupMessage(params);
        }
    }

    private async deleteMessage(params: any): Promise<void> {
        await this.adapter.deleteMessage(this.account.account_id, {
            message_id: params.message_id,
        });
    }

    private async getMessage(params: any): Promise<Milky.MessageInfo> {
        const msg = await this.adapter.getMessage(this.account.account_id, {
            message_id: params.message_id,
        });
        return {
            time: msg.time || Math.floor(Date.now() / 1000),
            message_type: msg.sender.scene_type as "private" | "group",
            message_id: msg.message_id,
            real_id: 0,
            sender: {
                user_id: msg.sender.sender_id,
                nickname: msg.sender.sender_name,
            },
            message: msg.message as any,
        };
    }

    private async getForwardMessage(params: any): Promise<any> {
        // Forward message handling - platform specific
        throw new Error("Forward message not supported by this adapter");
    }

    private async getLoginInfo(): Promise<Milky.LoginInfo> {
        const info = await this.adapter.getLoginInfo(this.account.account_id);
        return {
            user_id: info.user_id,
            nickname: info.user_name,
        };
    }

    private async getStrangerInfo(params: any): Promise<Milky.User> {
        const info = await this.adapter.getUserInfo(this.account.account_id, {
            user_id: params.user_id,
        });
        return {
            user_id: info.user_id,
            nickname: info.user_name,
        };
    }

    private async getFriendList(): Promise<Milky.FriendInfo[]> {
        const result = await this.adapter.getFriendList(this.account.account_id);
        return result.map(info => ({
            user_id: info.user_id,
            nickname: info.user_name,
            remark: info.remark || "",
        }));
    }

    private async getGroupInfo(params: any): Promise<Milky.GroupInfo> {
        const info = await this.adapter.getGroupInfo(this.account.account_id, {
            group_id: params.group_id,
        });
        return {
            group_id: info.group_id,
            group_name: info.group_name,
            member_count: info.member_count || 0,
            max_member_count: info.max_member_count || 0,
        };
    }

    private async getGroupList(): Promise<Milky.GroupInfo[]> {
        const result = await this.adapter.getGroupList(this.account.account_id);
        return result.map(info => ({
            group_id: info.group_id,
            group_name: info.group_name,
            member_count: info.member_count || 0,
            max_member_count: info.max_member_count || 0,
        }));
    }

    private async getGroupMemberInfo(params: any): Promise<Milky.GroupMemberInfo> {
        const info = await this.adapter.getGroupMemberInfo(this.account.account_id, {
            group_id: params.group_id,
            user_id: params.user_id,
        });
        return {
            group_id: info.group_id,
            user_id: info.user_id,
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
        };
    }

    private async getGroupMemberList(params: any): Promise<Milky.GroupMemberInfo[]> {
        const list = await this.adapter.getGroupMemberList(this.account.account_id, {
            group_id: params.group_id,
        });
        return list.map(info => ({
            group_id: info.group_id,
            user_id: info.user_id,
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
        }));
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
        this.router.post(`${this.path}/:action`, async ctx => {
            // Verify access token
            const token =
                ctx.query.access_token || ctx.headers.authorization?.replace("Bearer ", "");
            if (!this.verifyToken(token as string)) {
                ctx.status = 401;
                ctx.body = { status: "failed", retcode: 1403, message: "Unauthorized" };
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
                };
            }
        });

        this.logger.info(`Milky HTTP server listening on ${this.path}/:action`);
    }

    private startWs(): void {
        this.logger.info("Starting Milky WebSocket server");

        const wss = this.router.ws(this.path);

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

            // Send meta event: lifecycle.connect
            const connectEvent = {
                time: Math.floor(Date.now() / 1000),
                self_id: this.account.account_id,
                post_type: "meta_event",
                meta_event_type: "lifecycle",
                sub_type: "connect",
            };
            ws.send(JSON.stringify(connectEvent));

            // Listen for dispatch events and send to client
            const onDispatch = (data: string) => {
                if (ws.readyState === ws.OPEN) {
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
                const headers: any = {
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

        let ws: WebSocket | null = null;
        let reconnectTimer: any = null;

        const connect = () => {
            try {
                // Add access token to URL if configured
                let wsUrl = config.url;
                const token = config.access_token || this.config.access_token;
                if (token) {
                    const separator = wsUrl.includes("?") ? "&" : "?";
                    wsUrl = `${wsUrl}${separator}access_token=${token}`;
                }

                ws = new WebSocket(wsUrl, {
                    headers: {
                        "User-Agent": "Milky/1.0",
                        "X-Self-ID": this.account.account_id,
                        "X-Client-Role": "Universal",
                    },
                });

                ws.on("open", () => {
                    this.logger.info(`Milky WebSocket reverse connected to ${config.url}`);

                    // Send meta event: lifecycle.connect
                    const connectEvent = {
                        time: Math.floor(Date.now() / 1000),
                        self_id: this.account.account_id,
                        post_type: "meta_event",
                        meta_event_type: "lifecycle",
                        sub_type: "connect",
                    };
                    ws.send(JSON.stringify(connectEvent));

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
                        ws.send(JSON.stringify({ ...result, echo }));
                    } catch (error) {
                        this.logger.error("WebSocket reverse message error:", error);
                    }
                });

                ws.on("close", () => {
                    const interval = (config.reconnect_interval || 5) * 1000;
                    this.logger.warn(
                        `Milky WebSocket reverse disconnected from ${config.url}, reconnecting in ${config.reconnect_interval || 5}s...`,
                    );
                    reconnectTimer = setTimeout(connect, interval);
                });

                ws.on("error", (error: Error) => {
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

    private startHeartbeat(): void {
        const interval = (this.config.heartbeat || 5) * 1000;
        setInterval(() => {
            const heartbeatEvent: Milky.MetaEvent = {
                time: Math.floor(Date.now() / 1000),
                self_id: this.account.account_id,
                post_type: "meta_event",
                meta_event_type: "heartbeat",
                interval: this.config.heartbeat || 5,
            };
            this.dispatch(heartbeatEvent);
        }, interval);
    }
}
