import { Protocol } from "../base";
import { OneBot } from "@/onebot";
import { Adapter } from "@/adapter";
import { Dict } from "@zhinjs/shared";
import { CommonEvent } from "@/common-types";
import { Satori } from "./types";
import { SatoriConfig } from "./config";
import { EventEmitter } from "events";
import { Logger } from "log4js";

/**
 * Satori Protocol V1 Implementation
 * Satori is a cross-platform chatbot protocol
 * Reference: https://github.com/satorijs/satori
 */
export class SatoriV1 extends EventEmitter implements Protocol.Base {
    public readonly name = "satori";
    public readonly version = "v1" as const;
    protected logger: Logger;
    private eventId = 0;

    constructor(
        public adapter: Adapter,
        public oneBot: OneBot,
        public config: SatoriConfig.Config,
    ) {
        super();
        this.logger = adapter.getLogger(oneBot.uin, "satori-v1");
    }

    filterFn(event: Dict): boolean {
        // Implement Satori-specific event filtering
        return true;
    }

    start(): void {
        this.logger.info(`Starting Satori protocol v1 for ${this.oneBot.platform}/${this.oneBot.uin}`);
        
        // Initialize Satori protocol services
        if (this.config.use_http) {
            this.startHttp();
        }
        if (this.config.use_ws) {
            this.startWs();
        }
        if (this.config.webhooks) {
            this.config.webhooks.forEach(cfg => {
                const config = typeof cfg === "string" ? { url: cfg } : cfg;
                this.startWebhook(config);
            });
        }
    }

    async stop(force?: boolean): Promise<void> {
        this.logger.info(`Stopping Satori protocol v1`);
        // Clean up Satori protocol resources
        this.removeAllListeners();
    }

    dispatch(event: Satori.Event): void {
        // Dispatch Satori-formatted event
        this.logger.debug(`Satori dispatch:`, event);
        this.emit("dispatch", JSON.stringify(event));
    }

    /**
     * Convert common event to Satori format and dispatch
     */
    dispatchCommonEvent(commonEvent: CommonEvent.Event): void {
        const satoriEvent = this.convertToSatoriFormat(commonEvent);
        if (satoriEvent) {
            this.dispatch(satoriEvent);
        }
    }

    format(event: string, payload: any): any {
        // Format event according to Satori specification
        return {
            type: event,
            ...payload,
        };
    }

    async apply(action: string, params?: any): Promise<Satori.Response> {
        // Execute Satori API action
        this.logger.debug(`Satori action: ${action}`, params);
        
        try {
            const result = await this.executeAction(action, params);
            return {
                data: result,
            };
        } catch (error) {
            this.logger.error(`Satori action ${action} failed:`, error);
            return {
                message: error.message,
            };
        }
    }

    /**
     * Execute Satori protocol action
     */
    private async executeAction(action: string, params: any): Promise<any> {
        // Map Satori method names to implementations
        switch (action) {
            // Message methods
            case "message.create":
            case "createMessage":
                return this.createMessage(params);
            case "message.get":
            case "getMessage":
                return this.getMessage(params);
            case "message.delete":
            case "deleteMessage":
                return this.deleteMessage(params);
            case "message.update":
            case "editMessage":
                return this.updateMessage(params);
            case "message.list":
            case "getMessageList":
                return this.getMessageList(params);

            // Channel methods
            case "channel.get":
            case "getChannel":
                return this.getChannel(params);
            case "channel.list":
            case "getChannelList":
                return this.getChannelList(params);
            case "channel.create":
            case "createChannel":
                return this.createChannel(params);
            case "channel.update":
            case "updateChannel":
                return this.updateChannel(params);
            case "channel.delete":
            case "deleteChannel":
                return this.deleteChannel(params);

            // Guild methods
            case "guild.get":
            case "getGuild":
                return this.getGuild(params);
            case "guild.list":
            case "getGuildList":
                return this.getGuildList(params);

            // Guild member methods
            case "guild.member.get":
            case "getGuildMember":
                return this.getGuildMember(params);
            case "guild.member.list":
            case "getGuildMemberList":
                return this.getGuildMemberList(params);
            case "guild.member.kick":
            case "kickGuildMember":
                return this.kickGuildMember(params);
            case "guild.member.mute":
            case "muteGuildMember":
                return this.muteGuildMember(params);

            // User methods
            case "user.get":
            case "getUser":
                return this.getUser(params);
            case "user.channel.create":
            case "createDirectChannel":
                return this.createDirectChannel(params);

            // Friend methods
            case "friend.list":
            case "getFriendList":
                return this.getFriendList(params);
            case "friend.delete":
            case "deleteFriend":
                return this.deleteFriend(params);

            // Login methods
            case "login.get":
            case "getLogin":
                return this.getLogin();

            default:
                throw new Error(`Unknown action: ${action}`);
        }
    }

    /**
     * Convert CommonEvent to Satori-specific format
     */
    private convertToSatoriFormat(event: CommonEvent.Event): Satori.Event | null {
        switch (event.type) {
            case "message":
                return this.formatSatoriMessage(event);
            case "notice":
                return this.formatSatoriNotice(event);
            case "request":
                return this.formatSatoriRequest(event);
            case "meta":
                return this.formatSatoriMeta(event);
            default:
                return null;
        }
    }

    private formatSatoriMessage(event: CommonEvent.Message): Satori.Event {
        return {
            id: this.eventId++,
            type: "message-created",
            platform: this.config.platform || event.platform,
            self_id: this.config.self_id || event.bot_id,
            timestamp: event.timestamp,
            channel: event.group
                ? {
                      id: String(event.group.id),
                      type: event.message_type === "group" ? 0 : 1,
                      name: event.group.name,
                  }
                : undefined,
            user: {
                id: String(event.sender.id),
                name: event.sender.name,
                avatar: event.sender.avatar,
            },
            message: {
                id: String(event.message_id),
                content: this.convertMessageContent(event.message),
                created_at: event.timestamp,
            },
        };
    }

    private formatSatoriNotice(event: CommonEvent.Notice): Satori.Event {
        const eventTypeMap: Record<string, Satori.EventType> = {
            "group_increase": "guild-member-added",
            "group_decrease": "guild-member-removed",
            "friend_add": "friend-request",
        };

        return {
            id: this.eventId++,
            type: eventTypeMap[event.notice_type] || "internal",
            platform: this.config.platform || event.platform,
            self_id: this.config.self_id || event.bot_id,
            timestamp: event.timestamp,
            user: event.user
                ? {
                      id: String(event.user.id),
                      name: event.user.name,
                  }
                : undefined,
            guild: event.group
                ? {
                      id: String(event.group.id),
                      name: event.group.name,
                  }
                : undefined,
        };
    }

    private formatSatoriRequest(event: CommonEvent.Request): Satori.Event {
        return {
            id: this.eventId++,
            type: event.request_type === "friend" ? "friend-request" : "guild-member-request",
            platform: this.config.platform || event.platform,
            self_id: this.config.self_id || event.bot_id,
            timestamp: event.timestamp,
            user: {
                id: String(event.user.id),
                name: event.user.name,
            },
        };
    }

    private formatSatoriMeta(event: CommonEvent.Meta): Satori.Event {
        return {
            id: this.eventId++,
            type: "internal",
            platform: this.config.platform || event.platform,
            self_id: this.config.self_id || event.bot_id,
            timestamp: event.timestamp,
        };
    }

    /**
     * Convert CommonEvent message segments to Satori message content
     */
    private convertMessageContent(segments: CommonEvent.Segment[]): string {
        return segments
            .map(seg => {
                if (seg.type === "text") {
                    return seg.data.text || "";
                }
                // Convert other segment types to Satori elements
                const attrs = Object.entries(seg.data)
                    .map(([k, v]) => `${k}="${v}"`)
                    .join(" ");
                return `<${seg.type} ${attrs} />`;
            })
            .join("");
    }

    // Action implementations
    private async createMessage(params: any): Promise<Satori.Message[]> {
        const result = await this.adapter.sendPrivateMessage(this.oneBot.uin, {
            message_type: params.message_type || "private",
            user_id: params.user_id,
            group_id: params.channel_id,
            message: this.parseMessageContent(params.content),
        });
        
        return [{
            id: String(result.message_id),
            content: params.content || "",
        }];
    }

    private async getMessage(params: any): Promise<Satori.Message> {
        const msg = await this.adapter.getMessage(this.oneBot.uin, {
            message_id: params.message_id,
        });
        
        return {
            id: String(msg.message_id),
            content: this.convertMessageContent(msg.message),
            created_at: msg.time * 1000,
        };
    }

    private async deleteMessage(params: any): Promise<void> {
        await this.adapter.deleteMessage(this.oneBot.uin, {
            message_id: params.message_id,
        });
    }

    private async updateMessage(params: any): Promise<void> {
        // Message update not commonly supported
        throw new Error("Message update not supported by this adapter");
    }

    private async getMessageList(params: any): Promise<Satori.BidiList<Satori.Message>> {
        // Message list retrieval - platform specific
        return { data: [] };
    }

    private async getChannel(params: any): Promise<Satori.Channel> {
        const info = await this.adapter.getGroupInfo(this.oneBot.uin, {
            group_id: params.channel_id,
        });
        
        return {
            id: String(info.group_id),
            type: 0,
            name: info.group_name,
        };
    }

    private async getChannelList(params: any): Promise<Satori.List<Satori.Channel>> {
        const groups = await this.adapter.getGroupList(this.oneBot.uin);
        
        return {
            data: groups.map(g => ({
                id: String(g.group_id),
                type: 0,
                name: g.group_name,
            })),
        };
    }

    private async createChannel(params: any): Promise<Satori.Channel> {
        // Channel creation not commonly supported
        throw new Error("Channel creation not supported by this adapter");
    }

    private async updateChannel(params: any): Promise<void> {
        // Channel update not commonly supported
        throw new Error("Channel update not supported by this adapter");
    }

    private async deleteChannel(params: any): Promise<void> {
        // Channel deletion not commonly supported
        throw new Error("Channel deletion not supported by this adapter");
    }

    private async getGuild(params: any): Promise<Satori.Guild> {
        const info = await this.adapter.getGroupInfo(this.oneBot.uin, {
            group_id: params.guild_id,
        });
        
        return {
            id: String(info.group_id),
            name: info.group_name,
        };
    }

    private async getGuildList(params: any): Promise<Satori.List<Satori.Guild>> {
        const groups = await this.adapter.getGroupList(this.oneBot.uin);
        
        return {
            data: groups.map(g => ({
                id: String(g.group_id),
                name: g.group_name,
            })),
        };
    }

    private async getGuildMember(params: any): Promise<Satori.GuildMember> {
        const info = await this.adapter.getGroupMemberInfo(this.oneBot.uin, {
            group_id: params.guild_id,
            user_id: params.user_id,
        });
        
        return {
            user: {
                id: String(info.user_id),
                name: info.nickname,
            },
            nick: info.card,
        };
    }

    private async getGuildMemberList(params: any): Promise<Satori.List<Satori.GuildMember>> {
        const members = await this.adapter.getGroupMemberList(this.oneBot.uin, {
            group_id: params.guild_id,
        });
        
        return {
            data: members.map(m => ({
                user: {
                    id: String(m.user_id),
                    name: m.nickname,
                },
                nick: m.card,
            })),
        };
    }

    private async kickGuildMember(params: any): Promise<void> {
        // Guild member kick not commonly supported
        throw new Error("Guild member kick not supported by this adapter");
    }

    private async muteGuildMember(params: any): Promise<void> {
        // Guild member mute not commonly supported
        throw new Error("Guild member mute not supported by this adapter");
    }

    private async getUser(params: any): Promise<Satori.User> {
        const info = await this.adapter.getUserInfo(this.oneBot.uin, {
            user_id: params.user_id,
        });
        
        return {
            id: String(info.user_id),
            name: info.nickname,
        };
    }

    private async createDirectChannel(params: any): Promise<Satori.Channel> {
        // Direct channel creation - return a virtual channel for DM
        return {
            id: `dm_${params.user_id}`,
            type: 1, // Direct channel
        };
    }

    private async getFriendList(params: any): Promise<Satori.List<Satori.User>> {
        const friends = await this.adapter.getFriendList(this.oneBot.uin);
        
        return {
            data: friends.map(f => ({
                id: String(f.user_id),
                name: f.nickname,
            })),
        };
    }

    private async deleteFriend(params: any): Promise<void> {
        // Friend deletion not commonly supported
        throw new Error("Friend deletion not supported by this adapter");
    }

    private async getLogin(): Promise<Satori.Login> {
        const info = await this.adapter.getLoginInfo(this.oneBot.uin);
        
        return {
            user: {
                id: String(info.user_id),
                name: info.nickname,
            },
            self_id: String(info.user_id),
            platform: this.config.platform || this.oneBot.platform,
            status: 1,
        };
    }

    /**
     * Parse Satori message content (string or elements) to segments
     */
    private parseMessageContent(content: string | Satori.Element[]): any[] {
        if (typeof content === "string") {
            // Simple text message
            return [{ type: "text", data: { text: content } }];
        }
        
        // Parse element array
        return content.map(el => {
            if (typeof el === "string") {
                return { type: "text", data: { text: el } };
            }
            return {
                type: el.type,
                data: el.attrs || {},
            };
        });
    }

    // Service implementations
    private startHttp(): void {
        this.logger.info("Starting Satori HTTP server");
        const httpConfig = typeof this.config.use_http === "object" 
            ? this.config.use_http 
            : {};
        
        const host = httpConfig.host || "0.0.0.0";
        const port = httpConfig.port || 5140;
        
        this.logger.info(`Satori HTTP server would start at http://${host}:${port}`);
        // HTTP server implementation requires Koa/Express integration
        // This is handled by the main application server routing
    }

    private startWs(): void {
        this.logger.info("Starting Satori WebSocket server");
        const wsConfig = typeof this.config.use_ws === "object" 
            ? this.config.use_ws 
            : {};
        
        const host = wsConfig.host || "0.0.0.0";
        const port = wsConfig.port || 5140;
        
        this.logger.info(`Satori WebSocket server would start at ws://${host}:${port}`);
        // WebSocket server implementation requires WS integration
        // This is handled by the main application server routing
    }

    private startWebhook(config: SatoriConfig.WebhookConfig): void {
        this.logger.info(`Starting Satori webhook: ${config.url}`);
        
        // Webhook implementation
        this.on("dispatch", (eventData: string) => {
            // POST event to the configured URL
            this.logger.debug(`Would POST event to ${config.url}`);
        });
    }
}
