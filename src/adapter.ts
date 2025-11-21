import { EventEmitter } from "events";
import { App } from "@/server/app";
import { Account } from "@/account";
import { Logger } from "log4js";
import { Dict } from "@zhinjs/shared";
import { CommonEvent } from "./common-types";

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
    export type MessageScene="private" | "group" | "channel" | "direct";

    
    export interface SendMessageParams {
        scene_type: MessageScene;
        scene_id: string | number;
        message: CommonEvent.Segment[];
    }
    
    export interface DeleteMessageParams {
        message_id: string | number;
    }
    export interface GetMessageParams {
        message_id: string | number;
    }

    export interface GetUserInfoParams {
        user_id: string | number;
    }

    export interface GetGroupInfoParams {
        group_id: string | number;
    }

    export interface GetGroupMemberInfoParams {
        group_id: string | number;
        user_id: string | number;
    }

  
    export interface GetGroupMemberListParams {
        group_id: string | number;
    }
    export interface GetChannelInfoParams {
        channel_id: string | number;
    }
    
    export interface GetChannelListParams {
        channel_id: string | number;
    }
    export interface MessageSender{
        scene_type: MessageScene;
        sender_id: string | number;
        scene_id: string | number;
        sender_name: string;
        scene_name: string;
    }
    /**
     * Message info
     */
    export interface MessageInfo {
        message_id: string | number;
        time: number;
        sender: MessageSender;
        message: CommonEvent.Segment[];
    }

    /**
     * User info
     */
    export interface UserInfo {
        user_id: string | number;
        user_name: string;
    }

    /**
     * Friend info
     */
    export interface FriendInfo {
        user_id: string | number;
        user_name: string;
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
        user_name: string;
        card?: string;
        role?: "owner" | "admin" | "member";
    }
    export interface ChannelInfo {
        channel_id: string | number;
        channel_name: string;
        member_count?: number;
    }
    export interface GetChannelMemberInfoParams {
        channel_id: string | number;
        user_id: string | number;
    }
    export interface ChannelMemberInfo {
        channel_id: string | number;
        user_id: string | number;
        user_name: string;
        role?: "owner" | "admin" | "member";
    }
    export interface GetChannelMemberListParams {
        channel_id: string | number;
    }
    export interface ChannelMemberList {
        channel_id: string | number;
        user_id: string | number;
        user_name: string;
    }
    
    export interface SendMessageResult {
        message_id: string | number;
    }
    export interface ChangeChannelMemberRoleInfoParams {
        channel_id: string | number;
        user_id: string | number;
        role: "owner" | "admin" | "member";
    }
    export interface ChangeChannelMemberCardParams {
        channel_id: string | number;
        user_id: string | number;
        card: string;
    }
    export interface KickChannelMemberParams {
        channel_id: string | number;
        user_id: string | number;
    }
    export interface SetChannelMemberMuteParams {
        channel_id: string | number;
        user_id: string | number;
        mute: boolean;
    }
    export interface SetChannelMuteParams {
        channel_id: string | number;
        mute: boolean;
    }
    export interface InviteChannelMemberParams {
        channel_id: string | number;
        user_id: string | number;
    }
    export interface SetChannelMemberCardParams {
        channel_id: string | number;
        user_id: string | number;
        card: string;
    }
    export interface SetChannelMemberRoleParams {
        channel_id: string | number;
        user_id: string | number;
        role: "owner" | "admin" | "member";
    }
    export interface SetChannelMemberMuteParams {
        channel_id: string | number;
        user_id: string | number;
        mute: boolean;
    }
    export interface SetChannelMuteParams {
        channel_id: string | number;
        mute: boolean;
    }
    export interface InviteChannelMemberParams {
        channel_id: string | number;
        user_id: string | number;
    }
    export interface KickChannelMemberParams {
        channel_id: string | number;
        user_id: string | number;
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
