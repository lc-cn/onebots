import { Protocol } from "../base.js";
import { Account } from "@/account.js";
import { Adapter } from "@/adapter.js";
import { CommonEvent } from "@/common-types.js";
import { Satori } from "./types.js";
import { SatoriConfig } from "./config.js";

/**
 * Satori Protocol V1 Implementation
 * Satori is a cross-platform chatbot protocol
 * Reference: https://github.com/satorijs/satori
 */
export class SatoriV1 extends Protocol<"v1", SatoriConfig.Config> {
    public readonly name = "satori";
    public readonly version = "v1" as const;
    private eventId = 0;

    constructor(
        public adapter: Adapter,
        public account: Account,
        config: SatoriConfig.Config,
    ) {
        super(adapter, account, {
            ...config,
            protocol: "satori",
            version: "v1",
        });
    }

    start(): void {
        
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
            self_id: this.adapter.resolveId(this.account.account_id).string,
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
            self_id: this.adapter.resolveId(this.account.account_id).string,
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
            self_id: this.adapter.resolveId(this.account.account_id).string,
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
            self_id: this.adapter.resolveId(this.account.account_id).string,
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
        const result = await this.adapter.sendMessage(this.account.account_id, {
            scene_id: this.adapter.resolveId(params.message_type === "private" ?params.user_id : params.channel_id),
            scene_type: params.message_type,
            message: this.parseMessageContent(params.content),
        });
        
        return [{
            id: result.message_id.string,
            content: params.content || "",
        }];
    }

    private async getMessage(params: any): Promise<Satori.Message> {
        const msg = await this.adapter.getMessage(this.account.account_id, {
            message_id: this.adapter.resolveId(params.message_id),
        });
        
        return {
            id: msg.message_id.string,
            content: this.convertMessageContent(msg.message),
            created_at: msg.time * 1000,
        };
    }

    private async deleteMessage(params: any): Promise<void> {
        await this.adapter.deleteMessage(this.account.account_id, {
            message_id: this.adapter.resolveId(params.message_id),
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
        const info = await this.adapter.getGroupInfo(this.account.account_id, {
            group_id: this.adapter.resolveId(params.channel_id),
        });
        
        return {
            id: params.channel_id,
            type: 0,
            name: info.group_name,
        };
    }

    private async getChannelList(params: any): Promise<Satori.List<Satori.Channel>> {
        const groups = await this.adapter.getGroupList(this.account.account_id);
        
        return {
            data: groups.map(g => ({
                id: g.group_id.string,
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
        const info = await this.adapter.getGroupInfo(this.account.account_id, {
            group_id: this.adapter.resolveId(params.guild_id),
        });
        
        return {
            id: params.guild_id,
            name: info.group_name,
        };
    }

    private async getGuildList(params: any): Promise<Satori.List<Satori.Guild>> {
        const groups = await this.adapter.getGroupList(this.account.account_id);
        
        return {
            data: groups.map(g => ({
                id: g.group_id.string,
                name: g.group_name,
            })),
        };
    }

    private async getGuildMember(params: any): Promise<Satori.GuildMember> {
        const info = await this.adapter.getGroupMemberInfo(this.account.account_id, {
            group_id: this.adapter.resolveId(params.guild_id),
            user_id: this.adapter.resolveId(params.user_id),
        });
        
        return {
            user: {
                id: info.user_id.string,
                name: info.user_name,
            },
            nick: info.card,
        };
    }

    private async getGuildMemberList(params: any): Promise<Satori.List<Satori.GuildMember>> {
        const members = await this.adapter.getGroupMemberList(this.account.account_id, {
            group_id: this.adapter.resolveId(params.guild_id),
        });
        
        return {
            data: members.map(m => ({
                user: {
                    id: m.user_id.string,
                    name: m.user_name,
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
        const info = await this.adapter.getUserInfo(this.account.account_id, {
            user_id: this.adapter.resolveId(params.user_id),
        });
        
        return {
            id: info.user_id.string,
            name: info.user_name,
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
        const friends = await this.adapter.getFriendList(this.account.account_id);
        
        return {
            data: friends.map(f => ({
                id: f.user_id.string,
                name: f.user_name,
            })),
        };
    }

    private async deleteFriend(params: any): Promise<void> {
        // Friend deletion not commonly supported
        throw new Error("Friend deletion not supported by this adapter");
    }

    private async getLogin(): Promise<Satori.Login> {
        const info = await this.adapter.getLoginInfo(this.account.account_id);
        
        return {
            user: {
                id: info.user_id.string,
                name: info.user_name,
            },
            self_id: info.user_id.string,
            platform: this.account.platform as string,
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

    /**
     * Verify access token
     */
    private verifyToken(token?: string): boolean {
        const requiredToken = this.config.token;
        if (!requiredToken) return true;
        return token === requiredToken;
    }

    // Service implementations
    private startHttp(): void {
        this.logger.info("Starting Satori HTTP server");
        
        // Register HTTP POST endpoint for API calls
        this.router.post(`${this.path}/:method`, async (ctx) => {
            // Verify access token
            const authHeader = ctx.headers['authorization'];
            const token = (typeof authHeader === 'string' ? authHeader.replace('Bearer ', '') : undefined) || 
                         (typeof ctx.headers['x-platform'] === 'string' ? ctx.headers['x-platform'].split('/')[1] : undefined);
            
            if (!this.verifyToken(token)) {
                ctx.status = 401;
                ctx.body = { message: "Unauthorized" };
                return;
            }

            const method = ctx.params.method;
            const params = ctx.request.body;

            try {
                const result = await this.apply(method, params);
                ctx.body = result;
            } catch (error) {
                this.logger.error(`HTTP API ${method} failed:`, error);
                ctx.status = 500;
                ctx.body = {
                    message: error.message,
                };
            }
        });

        // GET /v1/login for login info
        this.router.get(`${this.path}/login`, async (ctx) => {
            // Verify access token
            const authHeader = ctx.headers['authorization'];
            const token = typeof authHeader === 'string' ? authHeader.replace('Bearer ', '') : undefined;
            if (!this.verifyToken(token)) {
                ctx.status = 401;
                ctx.body = { message: "Unauthorized" };
                return;
            }

            try {
                const login = await this.getLogin();
                ctx.body = login;
            } catch (error) {
                this.logger.error("Get login failed:", error);
                ctx.status = 500;
                ctx.body = { message: error.message };
            }
        });

        this.logger.info(`Satori HTTP server listening on ${this.path}`);
    }

    private startWs(): void {
        this.logger.info("Starting Satori WebSocket server");
        
        const wss = this.router.ws(`${this.path}//events`);
        
        wss.on("connection", (ws, request) => {
            // Verify access token
            const authHeader = request.headers['authorization'];
            const token = typeof authHeader === 'string' ? authHeader.replace('Bearer ', '') : undefined;
            
            if (!this.verifyToken(token)) {
                ws.close(1008, "Unauthorized");
                return;
            }

            this.logger.info(`Satori WebSocket client connected: ${this.path}/events`);

            // Send ready event
            const readyPayload = {
                op: 0, // READY
                body: {
                    logins: [{
                        user: {
                            id: this.account.account_id,
                            name: this.account.account_id,
                        },
                        self_id: this.account.account_id,
                        platform: this.config.platform || this.account.platform,
                        status: 1, // ONLINE
                    }],
                },
            };
            ws.send(JSON.stringify(readyPayload));

            // Listen for dispatch events and send to client
            const onDispatch = (data: string) => {
                if (ws.readyState === ws.OPEN) {
                    const event = JSON.parse(data);
                    const eventPayload = {
                        op: 0, // EVENT
                        body: event,
                    };
                    ws.send(JSON.stringify(eventPayload));
                }
            };
            this.on("dispatch", onDispatch);

            // Handle incoming messages (e.g., PING)
            ws.on("message", async (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    
                    if (message.op === 1) { // PING
                        // Respond with PONG
                        ws.send(JSON.stringify({ op: 2 })); // PONG
                    }
                } catch (error) {
                    this.logger.error("WebSocket message error:", error);
                }
            });

            ws.on("close", () => {
                this.logger.info(`Satori WebSocket client disconnected: ${this.path}/events`);
                this.off("dispatch", onDispatch);
            });

            ws.on("error", (error) => {
                this.logger.error("WebSocket error:", error);
            });
        });

        this.logger.info(`Satori WebSocket server listening on ${this.path}/events`);
    }

    private startWebhook(config: SatoriConfig.WebhookConfig): void {
        this.logger.info(`Starting Satori webhook: ${config.url}`);
        
        // Listen for dispatch events and POST to external server
        const onDispatch = async (data: string) => {
            try {
                const headers: any = {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Satori/1.0',
                    'X-Platform': this.config.platform || this.account.platform,
                    'X-Self-ID': this.account.account_id,
                };

                // Add access token if configured
                const token = config.token || this.config.token;
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                const response = await fetch(config.url, {
                    method: 'POST',
                    headers,
                    body: data,
                    signal: AbortSignal.timeout(15000),
                });

                if (!response.ok) {
                    this.logger.warn(`Webhook POST failed: ${response.status} ${response.statusText}`);
                }
            } catch (error) {
                this.logger.error(`Webhook POST error:`, error);
            }
        };

        this.on("dispatch", onDispatch);
        this.logger.info(`Satori webhook configured to POST events to ${config.url}`);
    }
}
