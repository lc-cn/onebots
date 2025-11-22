import { Account } from "@/account";
import { Adapter } from "@/adapter";
import { App } from "@/server/app";
import { Bot } from "node-dd-bot";

export default class DingtalkAdapter extends Adapter<Bot, "dingtalk"> {
    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const { scene_id, scene_type, message } = params;

        // 构建消息内容
        const messageText =
            typeof message === "string"
                ? message
                : Array.isArray(message)
                  ? message
                        .map(seg => {
                            if (typeof seg === "string") return seg;
                            if (seg.type === "text") return seg.data.text;
                            if (seg.type === "at")
                                return `@${seg.data.qq || seg.data.name || "user"}`;
                            if (seg.type === "image")
                                return `[图片:${seg.data.url || seg.data.file}]`;
                            return "";
                        })
                        .join("")
                  : "";
        let result: string;
        switch (scene_type) {
            case "private":
                result = await bot.sendPrivateMsg(scene_id as string, messageText);
                break;
            case "group":
                result = await bot.sendGroupMsg(scene_id as string, messageText);
                break;
            default:
                throw new Error(`Unsupported scene_type: ${scene_type}`);
        }
        return {
            message_id: result || String(Date.now()),
        };
    }
    getChannelInfo(
        uin: string,
        params: Adapter.GetChannelInfoParams,
    ): Promise<Adapter.ChannelInfo> {
        throw new Error("Method not implemented.");
    }
    getChannelList(uin: string): Promise<Adapter.ChannelInfo[]> {
        throw new Error("Method not implemented.");
    }
    getChannelMemberInfo(
        uin: string,
        params: Adapter.GetChannelMemberInfoParams,
    ): Promise<Adapter.ChannelMemberInfo> {
        throw new Error("Method not implemented.");
    }
    getChannelMemberList(
        uin: string,
        params: Adapter.GetChannelMemberListParams,
    ): Promise<Adapter.ChannelMemberInfo[]> {
        throw new Error("Method not implemented.");
    }
    setChannelMemberCard(uin: string, params: Adapter.SetChannelMemberCardParams): Promise<void> {
        throw new Error("Method not implemented.");
    }
    setChannelMemberRole(uin: string, params: Adapter.SetChannelMemberRoleParams): Promise<void> {
        throw new Error("Method not implemented.");
    }
    setChannelMute(uin: string, params: Adapter.SetChannelMuteParams): Promise<void> {
        throw new Error("Method not implemented.");
    }
    inviteChannelMember(uin: string, params: Adapter.InviteChannelMemberParams): Promise<void> {
        throw new Error("Method not implemented.");
    }
    kickChannelMember(uin: string, params: Adapter.KickChannelMemberParams): Promise<void> {
        throw new Error("Method not implemented.");
    }
    setChannelMemberMute(uin: string, params: Adapter.SetChannelMemberMuteParams): Promise<void> {
        throw new Error("Method not implemented.");
    }
    constructor(app: App) {
        super(app, "dingtalk");
        this.icon = `https://img.alicdn.com/imgextra/i4/O1CN01RtfAks1Xa6qJFAekm_!!6000000002939-2-tps-128-128.png`;
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
    getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        throw new Error("Method not implemented.");
    }
    getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        throw new Error("Method not implemented.");
    }
    getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        throw new Error("Method not implemented.");
    }
    createAccount(config: Account.Config<"dingtalk">): Account<"dingtalk", Bot> {
        const bot = new Bot(config);
        const account = new Account<"dingtalk", Bot>(this, bot, config);
        account.on("start", () => {
            bot.start();
        });
        return account;
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
    export interface Config extends Bot.Options {}
}
