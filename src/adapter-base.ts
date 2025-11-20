import { EventEmitter } from "events";
import { App } from "@/server/app";
import { OneBot } from "@/onebot";
import { Logger } from "log4js";
import { Dict } from "@zhinjs/shared";

/**
 * Base Adapter Interface
 * Defines all methods that platform adapters must implement
 * Platform adapters provide the actual implementation for their specific platform
 */
export namespace AdapterAPI {
    /**
     * Send message parameters
     */
    export interface SendMessageParams {
        message_type?: "private" | "group";
        user_id?: string | number;
        group_id?: string | number;
        message: any[];
    }

    /**
     * Delete message parameters
     */
    export interface DeleteMessageParams {
        message_id: string | number;
    }

    /**
     * Get message parameters
     */
    export interface GetMessageParams {
        message_id: string | number;
    }

    /**
     * Get user info parameters
     */
    export interface GetUserInfoParams {
        user_id: string | number;
    }

    /**
     * Get group info parameters
     */
    export interface GetGroupInfoParams {
        group_id: string | number;
    }

    /**
     * Get group member info parameters
     */
    export interface GetGroupMemberInfoParams {
        group_id: string | number;
        user_id: string | number;
    }

    /**
     * Get group member list parameters
     */
    export interface GetGroupMemberListParams {
        group_id: string | number;
    }

    /**
     * Message info
     */
    export interface MessageInfo {
        message_id: string | number;
        time: number;
        message_type: "private" | "group";
        sender: any;
        message: any[];
    }

    /**
     * User info
     */
    export interface UserInfo {
        user_id: string | number;
        nickname: string;
        [key: string]: any;
    }

    /**
     * Friend info
     */
    export interface FriendInfo {
        user_id: string | number;
        nickname: string;
        remark?: string;
    }

    /**
     * Group info
     */
    export interface GroupInfo {
        group_id: string | number;
        group_name: string;
        member_count?: number;
        max_member_count?: number;
    }

    /**
     * Group member info
     */
    export interface GroupMemberInfo {
        group_id: string | number;
        user_id: string | number;
        nickname: string;
        card?: string;
        role?: "owner" | "admin" | "member";
        [key: string]: any;
    }

    /**
     * Send message result
     */
    export interface SendMessageResult {
        message_id: string | number;
    }
}

/**
 * Base Adapter class with abstract methods
 * Platform adapters must implement these methods for their specific platform
 */
export abstract class BaseAdapter<T extends string = string> extends EventEmitter {
    oneBots: Map<string, OneBot> = new Map<string, OneBot>();
    #logger: Logger;
    icon: string;

    protected constructor(
        public app: App,
        public platform: T,
        public config: any,
    ) {
        super();
    }

    // ============================================
    // Abstract methods - Must be implemented by platform adapters
    // ============================================

    /**
     * Send a private message
     */
    abstract sendPrivateMessage(
        uin: string,
        params: AdapterAPI.SendMessageParams
    ): Promise<AdapterAPI.SendMessageResult>;

    /**
     * Send a group message
     */
    abstract sendGroupMessage(
        uin: string,
        params: AdapterAPI.SendMessageParams
    ): Promise<AdapterAPI.SendMessageResult>;

    /**
     * Delete a message
     */
    abstract deleteMessage(
        uin: string,
        params: AdapterAPI.DeleteMessageParams
    ): Promise<void>;

    /**
     * Get message by ID
     */
    abstract getMessage(
        uin: string,
        params: AdapterAPI.GetMessageParams
    ): Promise<AdapterAPI.MessageInfo>;

    /**
     * Get user/stranger info
     */
    abstract getUserInfo(
        uin: string,
        params: AdapterAPI.GetUserInfoParams
    ): Promise<AdapterAPI.UserInfo>;

    /**
     * Get friend list
     */
    abstract getFriendList(uin: string): Promise<AdapterAPI.FriendInfo[]>;

    /**
     * Get group info
     */
    abstract getGroupInfo(
        uin: string,
        params: AdapterAPI.GetGroupInfoParams
    ): Promise<AdapterAPI.GroupInfo>;

    /**
     * Get group list
     */
    abstract getGroupList(uin: string): Promise<AdapterAPI.GroupInfo[]>;

    /**
     * Get group member info
     */
    abstract getGroupMemberInfo(
        uin: string,
        params: AdapterAPI.GetGroupMemberInfoParams
    ): Promise<AdapterAPI.GroupMemberInfo>;

    /**
     * Get group member list
     */
    abstract getGroupMemberList(
        uin: string,
        params: AdapterAPI.GetGroupMemberListParams
    ): Promise<AdapterAPI.GroupMemberInfo[]>;

    /**
     * Get login info (bot's own info)
     */
    abstract getLoginInfo(uin: string): Promise<AdapterAPI.UserInfo>;

    // ============================================
    // Concrete methods
    // ============================================

    getOneBot<C = any>(uin: string) {
        return this.oneBots.get(uin) as OneBot<C> | undefined;
    }

    get logger() {
        return (this.#logger ||= this.app.getLogger(this.platform));
    }

    get info() {
        return {
            platform: this.platform,
            config: this.config,
            icon: this.icon,
            bots: [...this.oneBots.values()].map(bot => {
                return bot.info;
            }),
        };
    }

    async setOnline(uin: string) {}
    async setOffline(uin: string) {}

    getLogger(uin: string, version?: string) {
        if (!version) return this.app.getLogger(`${this.platform}-${uin}`);
        return this.app.getLogger(`${this.platform}-${version}(${uin})`);
    }

    createOneBot<T = any>(uin: string, protocol: Dict, versions: OneBot.Config[]): OneBot<T> {
        const oneBot = new OneBot<T>(this, uin, versions);
        this.oneBots.set(uin, oneBot);
        return oneBot;
    }

    async start(uin?: string): Promise<any> {
        const startOneBots = [...this.oneBots.values()].filter(oneBot => {
            return uin ? oneBot.uin === uin : true;
        });
        for (const oneBot of startOneBots) {
            await oneBot.start();
        }
    }

    async stop(uin?: string): Promise<any> {
        const stopOneBots = [...this.oneBots.values()].filter(oneBot => {
            return uin ? oneBot.uin === uin : true;
        });
        for (const oneBot of stopOneBots) {
            await oneBot.stop();
        }
    }
}
