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
        // TODO: Call adapter method
        return { message_id: "placeholder" };
    }

    private async sendGroupMessage(params: any): Promise<Milky.SendMessageResult> {
        // TODO: Call adapter method
        return { message_id: "placeholder" };
    }

    private async sendMessage(params: any): Promise<Milky.SendMessageResult> {
        if (params.message_type === "private") {
            return this.sendPrivateMessage(params);
        } else {
            return this.sendGroupMessage(params);
        }
    }

    private async deleteMessage(params: any): Promise<void> {
        // TODO: Call adapter method
    }

    private async getMessage(params: any): Promise<Milky.MessageInfo> {
        // TODO: Call adapter method
        throw new Error("Not implemented");
    }

    private async getForwardMessage(params: any): Promise<any> {
        // TODO: Call adapter method
        throw new Error("Not implemented");
    }

    private async getLoginInfo(): Promise<Milky.LoginInfo> {
        return {
            user_id: this.oneBot.uin,
            nickname: "Bot",
        };
    }

    private async getStrangerInfo(params: any): Promise<Milky.User> {
        // TODO: Call adapter method
        throw new Error("Not implemented");
    }

    private async getFriendList(): Promise<Milky.FriendInfo[]> {
        // TODO: Call adapter method
        return [];
    }

    private async getGroupInfo(params: any): Promise<Milky.GroupInfo> {
        // TODO: Call adapter method
        throw new Error("Not implemented");
    }

    private async getGroupList(): Promise<Milky.GroupInfo[]> {
        // TODO: Call adapter method
        return [];
    }

    private async getGroupMemberInfo(params: any): Promise<Milky.GroupMemberInfo> {
        // TODO: Call adapter method
        throw new Error("Not implemented");
    }

    private async getGroupMemberList(params: any): Promise<Milky.GroupMemberInfo[]> {
        // TODO: Call adapter method
        return [];
    }

    // Service implementations
    private startHttp(): void {
        this.logger.info("Starting Milky HTTP server");
        // TODO: Implement HTTP server
    }

    private startWs(): void {
        this.logger.info("Starting Milky WebSocket server");
        // TODO: Implement WebSocket server
    }

    private startHttpReverse(config: MilkyConfig.HttpReverseConfig): void {
        this.logger.info(`Starting Milky HTTP reverse: ${config.url}`);
        // TODO: Implement HTTP reverse (webhook)
    }

    private startWsReverse(config: MilkyConfig.WsReverseConfig): void {
        this.logger.info(`Starting Milky WebSocket reverse: ${config.url}`);
        // TODO: Implement WebSocket reverse client
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
