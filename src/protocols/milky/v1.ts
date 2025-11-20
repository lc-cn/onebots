import { Protocol } from "../base";
import { OneBot } from "@/onebot";
import { Adapter } from "@/adapter";
import { Dict } from "@zhinjs/shared";
import { CommonEvent } from "@/common-types";
import { Milky } from "./types";
import { MilkyConfig } from "./config";
import { EventEmitter } from "events";
import { Logger } from "log4js";

/**
 * Milky Protocol V1 Implementation
 * Milky is a QQ bot protocol similar to OneBot but with different message formats
 * Reference: https://milky.ntqqrev.org/
 */
export class MilkyV1 extends EventEmitter implements Protocol.Base {
    public readonly name = "milky";
    public readonly version = "v1" as const;
    protected logger: Logger;

    constructor(
        public adapter: Adapter,
        public oneBot: OneBot,
        public config: MilkyConfig.Config,
    ) {
        super();
        this.logger = adapter.getLogger(oneBot.uin, "milky-v1");
    }

    filterFn(event: Dict): boolean {
        // Implement Milky-specific event filtering
        // For now, accept all events
        return true;
    }

    start(): void {
        this.logger.info(`Starting Milky protocol v1 for ${this.oneBot.platform}/${this.oneBot.uin}`);
        
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
        this.logger.debug(`Milky dispatch:`, event);
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
        const result = await this.adapter.sendPrivateMessage(this.oneBot.uin, {
            message_type: "private",
            user_id: params.user_id,
            message: params.message,
        });
        return { message_id: result.message_id };
    }

    private async sendGroupMessage(params: any): Promise<Milky.SendMessageResult> {
        const result = await this.adapter.sendGroupMessage(this.oneBot.uin, {
            message_type: "group",
            group_id: params.group_id,
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
        await this.adapter.deleteMessage(this.oneBot.uin, {
            message_id: params.message_id,
        });
    }

    private async getMessage(params: any): Promise<Milky.MessageInfo> {
        const msg = await this.adapter.getMessage(this.oneBot.uin, {
            message_id: params.message_id,
        });
        return {
            time: msg.time,
            message_type: msg.message_type,
            message_id: msg.message_id,
            real_id: 0,
            sender: msg.sender,
            message: msg.message,
        };
    }

    private async getForwardMessage(params: any): Promise<any> {
        // Forward message handling - platform specific
        throw new Error("Forward message not supported by this adapter");
    }

    private async getLoginInfo(): Promise<Milky.LoginInfo> {
        const info = await this.adapter.getLoginInfo(this.oneBot.uin);
        return {
            user_id: info.user_id,
            nickname: info.nickname,
        };
    }

    private async getStrangerInfo(params: any): Promise<Milky.User> {
        const info = await this.adapter.getUserInfo(this.oneBot.uin, {
            user_id: params.user_id,
        });
        return {
            user_id: info.user_id,
            nickname: info.nickname,
        };
    }

    private async getFriendList(): Promise<Milky.FriendInfo[]> {
        return await this.adapter.getFriendList(this.oneBot.uin);
    }

    private async getGroupInfo(params: any): Promise<Milky.GroupInfo> {
        const info = await this.adapter.getGroupInfo(this.oneBot.uin, {
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
        return await this.adapter.getGroupList(this.oneBot.uin);
    }

    private async getGroupMemberInfo(params: any): Promise<Milky.GroupMemberInfo> {
        const info = await this.adapter.getGroupMemberInfo(this.oneBot.uin, {
            group_id: params.group_id,
            user_id: params.user_id,
        });
        return {
            group_id: info.group_id,
            user_id: info.user_id,
            nickname: info.nickname,
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
        const list = await this.adapter.getGroupMemberList(this.oneBot.uin, {
            group_id: params.group_id,
        });
        return list.map(info => ({
            group_id: info.group_id,
            user_id: info.user_id,
            nickname: info.nickname,
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

    // Service implementations
    private startHttp(): void {
        this.logger.info("Starting Milky HTTP server");
        const httpConfig = typeof this.config.use_http === "object" 
            ? this.config.use_http 
            : {};
        
        const host = httpConfig.host || "0.0.0.0";
        const port = httpConfig.port || 5700;
        
        this.logger.info(`Milky HTTP server would start at http://${host}:${port}`);
        // HTTP server implementation requires Koa/Express integration
        // This is handled by the main application server routing
    }

    private startWs(): void {
        this.logger.info("Starting Milky WebSocket server");
        const wsConfig = typeof this.config.use_ws === "object" 
            ? this.config.use_ws 
            : {};
        
        const host = wsConfig.host || "0.0.0.0";
        const port = wsConfig.port || 6700;
        
        this.logger.info(`Milky WebSocket server would start at ws://${host}:${port}`);
        // WebSocket server implementation requires WS integration
        // This is handled by the main application server routing
    }

    private startHttpReverse(config: MilkyConfig.HttpReverseConfig): void {
        this.logger.info(`Starting Milky HTTP reverse: ${config.url}`);
        
        // HTTP reverse (webhook) implementation
        this.on("dispatch", (eventData: string) => {
            // POST event to the configured URL
            // Implementation would use fetch/axios to send events
            this.logger.debug(`Would POST event to ${config.url}`);
        });
    }

    private startWsReverse(config: MilkyConfig.WsReverseConfig): void {
        this.logger.info(`Starting Milky WebSocket reverse: ${config.url}`);
        
        // WebSocket reverse (client) implementation
        this.on("dispatch", (eventData: string) => {
            // Send event via WebSocket client
            this.logger.debug(`Would send event via WS to ${config.url}`);
        });
    }

    private startHeartbeat(): void {
        const interval = (this.config.heartbeat || 5) * 1000;
        setInterval(() => {
            const heartbeatEvent: Milky.MetaEvent = {
                time: Math.floor(Date.now() / 1000),
                self_id: this.oneBot.uin,
                post_type: "meta_event",
                meta_event_type: "heartbeat",
                interval: this.config.heartbeat || 5,
            };
            this.dispatch(heartbeatEvent);
        }, interval);
    }
}
