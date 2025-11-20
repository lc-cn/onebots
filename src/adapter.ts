import { EventEmitter } from "events";
import { App } from "@/server/app";
import { Account } from "@/account";
import { Logger } from "log4js";
import { Dict } from "@zhinjs/shared";

/**
 * Base Adapter Interface
 * Defines all methods that platform adapters must implement
 * Platform adapters provide the actual implementation for their specific platform
 */
export namespace Adapter {
    export interface Config<T extends keyof Configs=keyof Configs> {
        platform: T;
        [key: string]: any;
    }
    export interface Configs extends Record<string, any> {}
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
export abstract class Adapter<C=any,T extends string = string> extends EventEmitter {
    accounts: Map<string, Account<C>> = new Map<string, Account<C>>();
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
        params: Adapter.SendMessageParams
    ): Promise<Adapter.SendMessageResult>;

    /**
     * Send a group message
     */
    abstract sendGroupMessage(
        uin: string,
        params: Adapter.SendMessageParams
    ): Promise<Adapter.SendMessageResult>;

    /**
     * Delete a message
     */
    abstract deleteMessage(
        uin: string,
        params: Adapter.DeleteMessageParams
    ): Promise<void>;

    /**
     * Get message by ID
     */
    abstract getMessage(
        uin: string,
        params: Adapter.GetMessageParams
    ): Promise<Adapter.MessageInfo>;

    /**
     * Get user/stranger info
     */
    abstract getUserInfo(
        uin: string,
        params: Adapter.GetUserInfoParams
    ): Promise<Adapter.UserInfo>;

    /**
     * Get friend list
     */
    abstract getFriendList(uin: string): Promise<Adapter.FriendInfo[]>;

    /**
     * Get group info
     */
    abstract getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams
    ): Promise<Adapter.GroupInfo>;

    /**
     * Get group list
     */
    abstract getGroupList(uin: string): Promise<Adapter.GroupInfo[]>;

    /**
     * Get group member info
     */
    abstract getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams
    ): Promise<Adapter.GroupMemberInfo>;

    /**
     * Get group member list
     */
    abstract getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams
    ): Promise<Adapter.GroupMemberInfo[]>;

    /**
     * Get login info (bot's own info)
     */
    abstract getLoginInfo(uin: string): Promise<Adapter.UserInfo>;

    // ============================================
    // Concrete methods
    // ============================================

    getAccount(uin: string) {
        return this.accounts.get(uin) as Account<C> | undefined;
    }

    get logger() {
        return (this.#logger ||= this.app.getLogger(this.platform));
    }

    get info() {
        return {
            platform: this.platform,
            config: this.config,
            icon: this.icon,
            bots: [...this.accounts.values()].map(account => {
                return account.info;
            }),
        };
    }

    async setOnline(uin: string) {}
    async setOffline(uin: string) {}

    getLogger(uin: string, version?: string) {
        if (!version) return this.app.getLogger(`${this.platform}-${uin}`);
        return this.app.getLogger(`${this.platform}-${version}(${uin})`);
    }

    abstract createAccount(uin: string, protocol: Dict, versions: Account.Config[]): Account<this>;

    async start(uin?: string): Promise<any> {
        const startAccounts = [...this.accounts.values()].filter(account => {
            return uin ? account.uin === uin : true;
        });
        for (const account of startAccounts) {
            await account.start();
        }
    }

    async stop(uin?: string): Promise<any> {
        const stopAccounts = [...this.accounts.values()].filter(account => {
            return uin ? account.uin === uin : true;
        });
        for (const account of stopAccounts) {
            await account.stop();
        }
    }
}
export type AdapterClient<T extends Adapter = Adapter> = T extends Adapter<infer C, infer _> ? C : never;
