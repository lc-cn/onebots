import { EventEmitter } from "events";
import { App } from "@/server/app.js";
import { Account } from "@/account.js";
import { Logger } from "log4js";
import { CommonEvent } from "./common-types.js";
import { SqliteDB } from "./db.js";

/**
 * Base Adapter class with abstract methods
 * Platform adapters must implement these methods for their specific platform
 */
export abstract class Adapter<C = any, T extends keyof Adapter.Configs = keyof Adapter.Configs> extends EventEmitter {
    accounts: Map<string, Account<T, C>> = new Map<string, Account<T, C>>();
    #logger: Logger;
    icon: string;
    get db(): SqliteDB {
        return this.app.db;
    }
    get tableName() {
        return `id_map_${this.platform}`;
    }
    protected constructor(
        public app: App,
        public platform: T
    ) {
        super();
        this.db.create(this.tableName, {
            string: SqliteDB.Column("TEXT"),
            number: SqliteDB.Column("INTEGER", { unique: true }),
            source: SqliteDB.Column("TEXT")
        });
    }
    createId(id: string | number): Adapter.Id {
        if (typeof id === "number") return { string: id.toString(), number: id, source: id };
        const [existData] = this.db.select('*').from(this.tableName).where({
            string: id
        }).run()
        if (existData) return existData as Adapter.Id;
        const randomNum = Math.floor(Math.random() * 100000000000);
        const [checkExist] = this.db.select('*').from(this.tableName).where({
            number: randomNum
        }).run();

        if (checkExist) return this.createId(id);
        const newId: Adapter.Id = {
            string: id,
            number: randomNum,
            source: id
        }
        this.db.insert(this.tableName).values(newId).run();
        return newId;
    }
    resolveId(id: string | number): Adapter.Id {
        const [dbRecord] = this.db.select('*').from(this.tableName).where({
            [typeof id === "number" ? "number" : "string"]: id
        }).run();
        if (dbRecord) return dbRecord as Adapter.Id;
        return this.createId(id);
    }
    // ============================================
    // Abstract methods - Must be implemented by platform adapters
    // ============================================

    /**
     * Send a private message
     */
    abstract sendMessage(
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
     * Get channel info
     */
    abstract getChannelInfo(
        uin: string,
        params: Adapter.GetChannelInfoParams
    ): Promise<Adapter.ChannelInfo>;

    /**
     * Get channel list
     */
    abstract getChannelList(uin: string): Promise<Adapter.ChannelInfo[]>;
    /**
     * Get channel member info
     */
    abstract getChannelMemberInfo(
        uin: string,
        params: Adapter.GetChannelMemberInfoParams
    ): Promise<Adapter.ChannelMemberInfo>;
    /**
     * Get guild member list    
     */
    abstract getChannelMemberList(
        uin: string,
        params: Adapter.GetChannelMemberListParams
    ): Promise<Adapter.ChannelMemberInfo[]>;/**
    * Set channel member card
    */
    abstract setChannelMemberCard(
        uin: string,
        params: Adapter.SetChannelMemberCardParams
    ): Promise<void>;
    /**
     * Set channel member role
     */
    abstract setChannelMemberRole(
        uin: string,
        params: Adapter.SetChannelMemberRoleParams
    ): Promise<void>;
    /**
     * Set channel mute
     */
    abstract setChannelMute(
        uin: string,
        params: Adapter.SetChannelMuteParams
    ): Promise<void>;
    /**
     * Invite channel member
     */
    abstract inviteChannelMember(
        uin: string,
        params: Adapter.InviteChannelMemberParams
    ): Promise<void>;
    /**
     * Kick channel member
     */
    abstract kickChannelMember(
        uin: string,
        params: Adapter.KickChannelMemberParams
    ): Promise<void>;
    /**
     * Set channel member mute
     */
    abstract setChannelMemberMute(
        uin: string,
        params: Adapter.SetChannelMemberMuteParams
    ): Promise<void>;
    /**
     * Get login info (bot's own info)
     */
    abstract getLoginInfo(uin: string): Promise<Adapter.UserInfo>;

    // ============================================
    // Concrete methods
    // ============================================

    getAccount(uin: string) {
        return this.accounts.get(uin)
    }

    get logger() {
        return (this.#logger ||= this.app.getLogger(this.platform as string));
    }

    get info() {
        return {
            platform: this.platform,
            icon: this.icon,
            accounts: [...this.accounts.values()].map(account => {
                return account.info;
            }),
        };
    }

    async setOnline(uin: string) { }
    async setOffline(uin: string) { }
    abstract createAccount(config: Account.Config<T>): Account<T, C>;

    async start(account_id?: string): Promise<any> {
        this.logger.info(`Starting adapter for platform ${this.platform}`);
        const startAccounts = [...this.accounts.values()].filter(account => {
            return account_id ? account.account_id === account_id : true;
        });
        for (const account of startAccounts) {
            await account.start();
        }
    }

    async stop(account_id?: string): Promise<any> {
        const stopAccounts = [...this.accounts.values()].filter(account => {
            return account_id ? account.account_id === account_id : true;
        });
        for (const account of stopAccounts) {
            await account.stop();
        }
    }
}
export type AdapterClient<T extends Adapter = Adapter> = T extends Adapter<infer C, infer _> ? C : never;

/**
 * Base Adapter Interface
 * Defines all methods that platform adapters must implement
 * Platform adapters provide the actual implementation for their specific platform
 */
export namespace Adapter {
    export interface Configs extends Record<string, any> { }
    export type MessageScene = "private" | "group" | "channel" | "direct";

    export type Id = {
        string: string
        source: string | number
        number: number
    }
    export interface SendMessageParams {
        scene_type: MessageScene;
        scene_id: Id;
        message: CommonEvent.Segment[];
    }

    export interface DeleteMessageParams {
        message_id: Id;
    }
    export interface GetMessageParams {
        message_id: Id;
    }

    export interface GetUserInfoParams {
        user_id: Id;
    }

    export interface GetGroupInfoParams {
        group_id: Id;
    }

    export interface GetGroupMemberInfoParams {
        group_id: Id;
        user_id: Id;
    }


    export interface GetGroupMemberListParams {
        group_id: Id;
    }
    export interface GetChannelInfoParams {
        channel_id: Id;
    }

    export interface GetChannelListParams {
        channel_id: Id;
    }
    export interface MessageSender {
        scene_type: MessageScene;
        sender_id: Id;
        scene_id: Id;
        sender_name: string;
        scene_name: string;
    }
    /**
     * Message info
     */
    export interface MessageInfo {
        message_id: Id;
        time: number;
        sender: MessageSender;
        message: CommonEvent.Segment[];
    }

    /**
     * User info
     */
    export interface UserInfo {
        user_id: Id;
        user_name: string;
    }

    /**
     * Friend info
     */
    export interface FriendInfo {
        user_id: Id;
        user_name: string;
        remark?: string;
    }

    /**
     * Group info
     */
    export interface GroupInfo {
        group_id: Id;
        group_name: string;
        member_count?: number;
        max_member_count?: number;
    }

    /**
     * Group member info
     */
    export interface GroupMemberInfo {
        group_id: Id;
        user_id: Id;
        user_name: string;
        card?: string;
        role?: "owner" | "admin" | "member";
    }
    export interface ChannelInfo {
        channel_id: Id;
        channel_name: string;
        member_count?: number;
    }
    export interface GetChannelMemberInfoParams {
        channel_id: Id;
        user_id: Id;
    }
    export interface ChannelMemberInfo {
        channel_id: Id;
        user_id: Id;
        user_name: string;
        role?: "owner" | "admin" | "member";
    }
    export interface GetChannelMemberListParams {
        channel_id: Id;
    }
    export interface ChannelMemberList {
        channel_id: Id;
        user_id: Id;
        user_name: string;
    }

    export interface SendMessageResult {
        message_id: Id;
    }
    export interface ChangeChannelMemberRoleInfoParams {
        channel_id: Id;
        user_id: Id;
        role: "owner" | "admin" | "member";
    }
    export interface ChangeChannelMemberCardParams {
        channel_id: Id;
        user_id: Id;
        card: string;
    }
    export interface KickChannelMemberParams {
        channel_id: Id;
        user_id: Id;
    }
    export interface SetChannelMemberMuteParams {
        channel_id: Id;
        user_id: Id;
        mute: boolean;
    }
    export interface SetChannelMuteParams {
        channel_id: Id;
        mute: boolean;
    }
    export interface InviteChannelMemberParams {
        channel_id: Id;
        user_id: Id;
    }
    export interface SetChannelMemberCardParams {
        channel_id: Id;
        user_id: Id;
        card: string;
    }
    export interface SetChannelMemberRoleParams {
        channel_id: Id;
        user_id: Id;
        role: "owner" | "admin" | "member";
    }
    export interface SetChannelMemberMuteParams {
        channel_id: Id;
        user_id: Id;
        mute: boolean;
    }
    export interface SetChannelMuteParams {
        channel_id: Id;
        mute: boolean;
    }
    export interface InviteChannelMemberParams {
        channel_id: Id;
        user_id: Id;
    }
    export interface KickChannelMemberParams {
        channel_id: Id;
        user_id: Id;
    }
}

