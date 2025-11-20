import { Account } from "@/account";
import { Adapter } from "@/adapter";
import { App } from "@/server/app";
import { Dict } from "@zhinjs/shared";
import { Bot} from "node-dd-bot";
import * as path from "path";

export default class DingtalkAdapter extends Adapter<Bot,"dingtalk"> {
    constructor(app: App, config: DingtalkAdapter.Config) {
        super(app, "dingtalk", config);
        this.icon = `https://img.alicdn.com/imgextra/i4/O1CN01RtfAks1Xa6qJFAekm_!!6000000002939-2-tps-128-128.png`;
    }
    async sendPrivateMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
        const result=await this.accounts.get(uin).client.sendPrivateMsg(String(params.user_id), params.message);
        return {message_id:result};
    }
    async sendGroupMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
        const result=await this.accounts.get(uin).client.sendGroupMsg(String(params.group_id), params.message);
        return {message_id:result};
    }
    deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        throw new Error("Method not implemented.");
    }
    getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        throw new Error("Method not implemented.");
    }
    getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        throw new Error("Method not implemented.");
    }
    getFriendList(uin: string): Promise<Adapter.FriendInfo[]> {
        throw new Error("Method not implemented.");
    }
    getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        throw new Error("Method not implemented.");
    }
    getGroupList(uin: string): Promise<Adapter.GroupInfo[]> {
        throw new Error("Method not implemented.");
    }
    getGroupMemberInfo(uin: string, params: Adapter.GetGroupMemberInfoParams): Promise<Adapter.GroupMemberInfo> {
        throw new Error("Method not implemented.");
    }
    getGroupMemberList(uin: string, params: Adapter.GetGroupMemberListParams): Promise<Adapter.GroupMemberInfo[]> {
        throw new Error("Method not implemented.");
    }
    getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        throw new Error("Method not implemented.");
    }
    createAccount(uin: string, protocol: Dict, versions: Account.Config[]): Account<this> {
        throw new Error("Method not implemented.");
    }
}
declare module "@/adapter" {
    export namespace Adapter {
        export interface Configs {
            dingtalk: DingtalkAdapter.Config;
        }
    }
}
export namespace DingtalkAdapter {
    export interface Config extends Adapter.Config<"dingtalk"> {
        protocol: Omit<Bot.Options, "clientId"> & {
            username?: string;
            avatar?: string;
        };
    }
}
