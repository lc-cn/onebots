import { Protocol } from "../base";
import { OneBot } from "@/onebot";
import { Adapter } from "@/adapter";
import { Dict } from "@zhinjs/shared";
import { CommonEvent } from "@/common-types";

/**
 * Milky Protocol Implementation
 * Milky is a QQ bot protocol similar to OneBot but with different message formats
 * Reference: https://milky.ntqqrev.org/
 */
export class MilkyProtocol extends Protocol<"v1", MilkyProtocol.Config> {
    public readonly name = "milky";
    public readonly version = "v1" as const;

    constructor(adapter: Adapter, oneBot: OneBot, config: MilkyProtocol.Config) {
        super(adapter, oneBot, config);
    }

    filterFn(event: Dict): boolean {
        // Implement Milky-specific event filtering
        // For now, accept all events
        return true;
    }

    start(): void {
        this.logger.info(`Starting Milky protocol v1 for ${this.oneBot.platform}/${this.oneBot.uin}`);
        // Initialize Milky protocol services
        // TODO: Implement HTTP/WebSocket servers for Milky
    }

    async stop(force?: boolean): Promise<void> {
        this.logger.info(`Stopping Milky protocol v1`);
        // Clean up Milky protocol resources
    }

    dispatch(event: any): void {
        // Dispatch Milky-formatted event
        this.logger.debug(`Milky dispatch:`, event);
        // TODO: Implement Milky event dispatch logic
    }

    /**
     * Convert common event to Milky format and dispatch
     */
    dispatchCommonEvent(commonEvent: CommonEvent.Event): void {
        // Convert CommonEvent to Milky format
        const milkyEvent = this.convertToMilkyFormat(commonEvent);
        this.dispatch(milkyEvent);
    }

    format(event: string, payload: any): any {
        // Format event according to Milky specification
        return {
            type: event,
            ...payload,
        };
    }

    async apply(action: string, params?: any): Promise<any> {
        // Execute Milky API action
        this.logger.debug(`Milky action: ${action}`, params);
        // TODO: Map Milky actions to adapter calls
        return {};
    }

    /**
     * Convert CommonEvent to Milky-specific format
     */
    private convertToMilkyFormat(event: CommonEvent.Event): any {
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
                return event;
        }
    }

    private formatMilkyMessage(event: CommonEvent.Message): any {
        return {
            type: "message",
            message_type: event.message_type,
            sender: {
                user_id: event.sender.id,
                nickname: event.sender.name,
                avatar: event.sender.avatar,
            },
            message: event.message.map(seg => ({
                type: seg.type,
                data: seg.data,
            })),
            message_id: event.message_id,
            timestamp: event.timestamp,
        };
    }

    private formatMilkyNotice(event: CommonEvent.Notice): any {
        return {
            type: "notice",
            notice_type: event.notice_type,
            user_id: event.user?.id,
            timestamp: event.timestamp,
        };
    }

    private formatMilkyRequest(event: CommonEvent.Request): any {
        return {
            type: "request",
            request_type: event.request_type,
            user_id: event.user.id,
            comment: event.comment,
            flag: event.flag,
            timestamp: event.timestamp,
        };
    }

    private formatMilkyMeta(event: CommonEvent.Meta): any {
        return {
            type: "meta",
            meta_type: event.meta_type,
            timestamp: event.timestamp,
        };
    }
}

export namespace MilkyProtocol {
    export interface Config {
        filters?: any;
        // Milky-specific configuration
        [key: string]: any;
    }
}
