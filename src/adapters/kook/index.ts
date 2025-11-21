import { Adapter } from "@/adapter";
import { App } from "@/server/app";
import { Account, AccountStatus } from "@/account";
import { CommonEvent } from "@/common-types";
import { EventEmitter } from "events";
import { Logger } from "log4js";
import { KookUtils } from "./utils";

/**
 * Kook (开黑啦) Platform Adapter
 * Implements communication with Kook platform using WebSocket
 */
export default class KookAdapter extends Adapter<KookAdapter.Config, "kook"> {
    private clients: Map<string, KookAdapter.Client> = new Map();
    private utils: KookUtils;

    constructor(app: App, config: KookAdapter.Config) {
        super(app, "kook", config);
        this.icon = `https://img.kookapp.cn/assets/2022-05/tJdLO6D9VC0ku0ku.png`;
        this.utils = new KookUtils();
    }

    /**
     * Create and initialize a Kook bot account
     */
    createAccount(uin: string, config: KookAdapter.BotConfig): Account {
        const account = new Account(this, uin, []);
        account.status = AccountStatus.Pending;
        
        // Create Kook client
        const client: KookAdapter.Client = {
            token: config.token,
            ws: null,
            heartbeatInterval: null,
            sn: 0,
            sessionId: "",
        };
        
        this.clients.set(uin, client);
        this.accounts.set(uin, account);
        
        return account;
    }

    /**
     * Start a Kook bot account
     */
    async start(uin: string): Promise<void> {
        const account = this.accounts.get(uin);
        const client = this.clients.get(uin);
        
        if (!account || !client) {
            throw new Error(`Account ${uin} not found`);
        }

        try {
            // Get gateway URL
            const gatewayUrl = await this.getGateway(client.token);
            
            // Connect to WebSocket
            await this.connectWebSocket(uin, gatewayUrl);
            
            // Get bot info
            const botInfo = await this.getBotInfo(client.token);
            account.nickname = botInfo.username;
            account.avatar = botInfo.avatar;
            account.status = AccountStatus.Online;
            
            this.getLogger(uin).info(`Kook bot ${botInfo.username}#${botInfo.identify_num} started`);
        } catch (error) {
            account.status = AccountStatus.OffLine;
            this.getLogger(uin).error(`Failed to start Kook bot:`, error);
            throw error;
        }
    }

    /**
     * Stop a Kook bot account
     */
    async stop(uin: string): Promise<void> {
        const account = this.accounts.get(uin);
        const client = this.clients.get(uin);
        
        if (!account || !client) {
            return;
        }

        // Clear heartbeat
        if (client.heartbeatInterval) {
            clearInterval(client.heartbeatInterval);
            client.heartbeatInterval = null;
        }

        // Close WebSocket
        if (client.ws) {
            client.ws.close();
            client.ws = null;
        }

        account.status = AccountStatus.OffLine;
        this.getLogger(uin).info(`Kook bot stopped`);
    }

    /**
     * Connect to Kook WebSocket gateway
     */
    private async connectWebSocket(uin: string, gatewayUrl: string): Promise<void> {
        const client = this.clients.get(uin);
        if (!client) return;

        const WebSocket = require("ws");
        const ws = new WebSocket(gatewayUrl);

        ws.on("open", () => {
            this.getLogger(uin).info("Kook WebSocket connected");
        });

        ws.on("message", (data: Buffer) => {
            this.handleWebSocketMessage(uin, data);
        });

        ws.on("close", (code: number, reason: string) => {
            this.getLogger(uin).warn(`Kook WebSocket closed: ${code} ${reason}`);
            
            // Clear heartbeat
            if (client.heartbeatInterval) {
                clearInterval(client.heartbeatInterval);
                client.heartbeatInterval = null;
            }

            // Attempt to reconnect after 5 seconds
            setTimeout(() => {
                const account = this.accounts.get(uin);
                if (account && account.status !== AccountStatus.OffLine) {
                    this.getLogger(uin).info("Attempting to reconnect...");
                    this.start(uin).catch(err => {
                        this.getLogger(uin).error("Reconnect failed:", err);
                    });
                }
            }, 5000);
        });

        ws.on("error", (error: Error) => {
            this.getLogger(uin).error("Kook WebSocket error:", error);
        });

        client.ws = ws;
    }

    /**
     * Handle WebSocket messages from Kook
     */
    private handleWebSocketMessage(uin: string, data: Buffer): void {
        const client = this.clients.get(uin);
        if (!client) return;

        try {
            const payload = JSON.parse(data.toString());

            // Signal: 0 = Event, 1 = Hello, 2 = Ping, 3 = Pong, 5 = Reconnect, 6 = Resume ACK
            switch (payload.s) {
                case 0: // Event
                    this.handleEvent(uin, payload.d);
                    // Update sn
                    if (payload.sn) {
                        client.sn = payload.sn;
                    }
                    break;

                case 1: // Hello
                    this.getLogger(uin).debug("Received Hello, session_id:", payload.d.session_id);
                    client.sessionId = payload.d.session_id;
                    
                    // Start heartbeat
                    this.startHeartbeat(uin);
                    break;

                case 3: // Pong
                    this.getLogger(uin).debug("Received Pong");
                    break;

                case 5: // Reconnect
                    this.getLogger(uin).warn("Server requested reconnect");
                    if (client.ws) {
                        client.ws.close();
                    }
                    break;

                case 6: // Resume ACK
                    this.getLogger(uin).info("Resume successful");
                    break;

                default:
                    this.getLogger(uin).warn("Unknown signal:", payload.s);
            }
        } catch (error) {
            this.getLogger(uin).error("Failed to parse WebSocket message:", error);
        }
    }

    /**
     * Start heartbeat to keep connection alive
     */
    private startHeartbeat(uin: string): void {
        const client = this.clients.get(uin);
        if (!client || !client.ws) return;

        // Clear existing heartbeat
        if (client.heartbeatInterval) {
            clearInterval(client.heartbeatInterval);
        }

        // Send ping every 30 seconds (Kook requires heartbeat every 30s)
        client.heartbeatInterval = setInterval(() => {
            if (client.ws && client.ws.readyState === 1) { // 1 = OPEN
                const ping = {
                    s: 2, // Ping signal
                    sn: client.sn,
                };
                client.ws.send(JSON.stringify(ping));
                this.getLogger(uin).debug("Sent Ping");
            }
        }, 30000);
    }

    /**
     * Handle events from Kook
     */
    private handleEvent(uin: string, eventData: any): void {
        const account = this.accounts.get(uin);
        if (!account) return;

        try {
            const event = this.utils.transformEvent(uin, eventData);
            if (event) {
                // Dispatch to protocols
                account.protocols.forEach(protocol => {
                    protocol.dispatch(event);
                });
            }
        } catch (error) {
            this.getLogger(uin).error("Failed to handle event:", error);
        }
    }

    /**
     * Get Kook gateway URL
     */
    private async getGateway(token: string): Promise<string> {
        const response = await fetch("https://www.kookapp.cn/api/v3/gateway/index?compress=0", {
            headers: {
                Authorization: `Bot ${token}`,
            },
        });

        const data = await response.json();
        if (data.code !== 0) {
            throw new Error(`Failed to get gateway: ${data.message}`);
        }

        return data.data.url;
    }

    /**
     * Get bot info
     */
    private async getBotInfo(token: string): Promise<any> {
        const response = await fetch("https://www.kookapp.cn/api/v3/user/me", {
            headers: {
                Authorization: `Bot ${token}`,
            },
        });

        const data = await response.json();
        if (data.code !== 0) {
            throw new Error(`Failed to get bot info: ${data.message}`);
        }

        return data.data;
    }

    /**
     * Make API request to Kook
     */
    private async request(uin: string, method: string, endpoint: string, body?: any): Promise<any> {
        const client = this.clients.get(uin);
        if (!client) {
            throw new Error(`Client ${uin} not found`);
        }

        const url = `https://www.kookapp.cn/api/v3${endpoint}`;
        const options: any = {
            method,
            headers: {
                Authorization: `Bot ${client.token}`,
                "Content-Type": "application/json",
            },
        };

        if (body) {
            if (method === "GET") {
                const params = new URLSearchParams(body);
                return this.request(uin, method, `${endpoint}?${params}`, undefined);
            }
            options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);
        const data = await response.json();

        if (data.code !== 0) {
            throw new Error(`API request failed: ${data.message}`);
        }

        return data.data;
    }

    // ============================================
    // Implement Adapter abstract methods
    // ============================================

    async sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
        const { scene_type, scene_id, message } = params;
        
        // Convert message segments to Kook format
        const content = this.utils.segmentsToKMarkdown(message);
        
        let type = 1; // 1 = text, 2 = image, 3 = video, 4 = file, 9 = KMarkdown, 10 = card
        
        // Check if message contains special types
        if (message.some(seg => seg.type === "image")) {
            type = 2;
        } else if (message.some(seg => seg.type === "video")) {
            type = 3;
        } else if (message.some(seg => seg.type === "file")) {
            type = 4;
        }

        const result = await this.request(uin, "POST", "/message/create", {
            type,
            target_id: scene_id,
            content,
        });

        return {
            message_id: result.msg_id,
        };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        await this.request(uin, "POST", "/message/delete", {
            msg_id: params.message_id,
        });
    }

    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        // Kook doesn't provide a direct API to get message by ID
        // This is a limitation of Kook API
        throw new Error("getMessage not supported by Kook platform");
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const result = await this.request(uin, "GET", "/user/view", {
            user_id: params.user_id,
        });

        return {
            user_id: result.id,
            user_name: result.username,
        };
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const client = this.clients.get(uin);
        if (!client) {
            throw new Error(`Client ${uin} not found`);
        }

        const result = await this.getBotInfo(client.token);
        return {
            user_id: result.id,
            user_name: result.username,
        };
    }

    async getFriendList(uin: string): Promise<Adapter.FriendInfo[]> {
        // Kook doesn't have a "friend" concept, but we can return user list
        const result = await this.request(uin, "GET", "/user/me", {});
        return []; // Kook doesn't provide friend list API
    }

    async getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        const result = await this.request(uin, "GET", "/guild/view", {
            guild_id: params.group_id,
        });

        return {
            group_id: result.id,
            group_name: result.name,
            member_count: result.user_count,
            max_member_count: result.max_member_count || 0,
        };
    }

    async getGroupList(uin: string): Promise<Adapter.GroupInfo[]> {
        const result = await this.request(uin, "GET", "/guild/list", {});

        return result.items.map((guild: any) => ({
            group_id: guild.id,
            group_name: guild.name,
            member_count: guild.user_count,
            max_member_count: guild.max_member_count || 0,
        }));
    }

    async getGroupMemberInfo(uin: string, params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> {
        const result = await this.request(uin, "GET", "/guild/user-view", {
            guild_id: params.group_id,
            user_id: params.user_id,
        });

        return {
            group_id: params.group_id,
            user_id: result.id,
            user_name: result.username,
            card: result.nickname || "",
            role: this.utils.parseRole(result.roles),
        };
    }

    async getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        const result = await this.request(uin, "GET", "/guild/user-list", {
            guild_id: params.group_id,
        });

        return result.items.map((member: any) => ({
            group_id: params.group_id,
            user_id: member.id,
            user_name: member.username,
            card: member.nickname || "",
            role: this.utils.parseRole(member.roles),
        }));
    }

    async getChannelInfo(uin: string, params: Adapter.GetChannelInfoParams): Promise<Adapter.ChannelInfo> {
        const result = await this.request(uin, "GET", "/channel/view", {
            target_id: params.channel_id,
        });

        return {
            channel_id: result.id,
            channel_name: result.name,
        };
    }

    async getChannelList(uin: string): Promise<Adapter.ChannelInfo[]> {
        // Get all guilds first
        const guilds = await this.getGroupList(uin);
        const allChannels: Adapter.ChannelInfo[] = [];

        // For each guild, get its channels
        for (const guild of guilds) {
            try {
                const result = await this.request(uin, "GET", "/channel/list", {
                    guild_id: guild.group_id,
                });

                const channels = (result.items || []).map((channel: any) => ({
                    channel_id: channel.id,
                    channel_name: channel.name,
                }));

                allChannels.push(...channels);
            } catch (error) {
                this.getLogger(uin).error(`Failed to get channels for guild ${guild.group_id}:`, error);
            }
        }

        return allChannels;
    }

    async setChannelMemberCard(uin: string, params: Adapter.SetChannelMemberCardParams): Promise<void> {
        // Kook uses guild-level nickname
        await this.request(uin, "POST", "/guild/nickname", {
            guild_id: params.channel_id,
            user_id: params.user_id,
            nickname: params.card,
        });
    }

    async setChannelMemberRole(uin: string, params: Adapter.SetChannelMemberRoleParams): Promise<void> {
        // Kook uses role system, this is a simplified implementation
        if (params.role === "admin") {
            await this.request(uin, "POST", "/guild-role/grant", {
                guild_id: params.channel_id,
                user_id: params.user_id,
                role_id: 1, // Admin role
            });
        }
    }

    async setChannelMute(uin: string, params: Adapter.SetChannelMuteParams): Promise<void> {
        // Kook doesn't have channel mute, this would need to be implemented differently
        throw new Error("setChannelMute not supported by Kook platform");
    }

    async inviteChannelMember(uin: string, params: Adapter.InviteChannelMemberParams): Promise<void> {
        // Kook doesn't have direct invite API
        throw new Error("inviteChannelMember not supported by Kook platform");
    }

    async kickChannelMember(uin: string, params: Adapter.KickChannelMemberParams): Promise<void> {
        await this.request(uin, "POST", "/guild/kickout", {
            guild_id: params.channel_id,
            target_id: params.user_id,
        });
    }

    async setChannelMemberMute(uin: string, params: Adapter.SetChannelMemberMuteParams): Promise<void> {
        const type = params.mute ? 1 : 2; // 1 = mute, 2 = unmute
        await this.request(uin, "POST", "/guild-mute/create", {
            guild_id: params.channel_id,
            user_id: params.user_id,
            type,
        });
    }

    async getChannelMemberInfo(uin: string, params: Adapter.GetChannelMemberInfoParams): Promise<Adapter.ChannelMemberInfo> {
        // Kook uses guild-level member info, not channel-specific
        const member = await this.getGroupMemberInfo(uin, {
            group_id: params.channel_id,
            user_id: params.user_id,
        });

        return {
            channel_id: params.channel_id,
            user_id: member.user_id,
            user_name: member.user_name,
            role: member.role,
        };
    }

    async getChannelMemberList(uin: string, params: Adapter.GetChannelMemberListParams): Promise<Adapter.ChannelMemberInfo[]> {
        // Kook uses guild-level member list
        const members = await this.getGroupMemberList(uin, {
            group_id: params.channel_id,
        });

        return members.map(member => ({
            channel_id: params.channel_id,
            user_id: member.user_id,
            user_name: member.user_name,
            role: member.role,
        }));
    }

    getLogger(uin: string): Logger {
        return this.app.logger;
    }
}

export namespace KookAdapter {
    export interface Config {
        bots: BotConfig[];
    }

    export interface BotConfig {
        token: string;
        uin?: string; // Optional bot ID
    }

    export interface Client {
        token: string;
        ws: any | null;
        heartbeatInterval: NodeJS.Timeout | null;
        sn: number;
        sessionId: string;
    }
}

// Declare adapter config in Adapter namespace
declare module "@/adapter" {
    namespace Adapter {
        interface Configs {
            kook: KookAdapter.Config;
        }
    }
}

