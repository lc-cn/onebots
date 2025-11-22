import { Account, AccountStatus } from "@/account";
import { Adapter } from "@/adapter";
import { App } from "@/server/app";
import { WeChatMPBot, WeChatMPBotConfig } from "./bot";
import { CommonEvent } from "@/common-types";

export default class WechatMpAdapter extends Adapter<WeChatMPBot, "wechat-mp"> {
    constructor(app: App) {
        super(app, "wechat-mp");
        this.icon = `https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico`;
        this.setupWebhookRoutes();
    }

    /**
     * Setup webhook routes for receiving messages from WeChat
     */
    private setupWebhookRoutes(): void {
        // WeChat verification endpoint (GET)
        this.app.router.get(`/${this.platform}/:account_id/webhook`, async ctx => {
            const { account_id } = ctx.params;
            const { signature, timestamp, nonce, echostr } = ctx.query;

            const account = this.getAccount(account_id);
            if (!account) {
                ctx.status = 404;
                ctx.body = "Account not found";
                return;
            }

            const bot = account.client;
            if (bot.verifySignature(signature as string, timestamp as string, nonce as string)) {
                ctx.body = echostr;
            } else {
                ctx.status = 403;
                ctx.body = "Invalid signature";
            }
        });

        // WeChat message endpoint (POST)
        this.app.router.post(`/${this.platform}/:account_id/webhook`, async ctx => {
            const { account_id } = ctx.params;
            const { signature, timestamp, nonce } = ctx.query;

            const account = this.getAccount(account_id);
            if (!account) {
                ctx.status = 404;
                ctx.body = "Account not found";
                return;
            }

            const bot = account.client;

            // Verify signature
            if (!bot.verifySignature(signature as string, timestamp as string, nonce as string)) {
                ctx.status = 403;
                ctx.body = "Invalid signature";
                return;
            }

            try {
                // Get raw XML body
                let xmlBody = "";
                if (typeof ctx.request.body === "string") {
                    xmlBody = ctx.request.body;
                } else if (ctx.req) {
                    // Read raw body if bodyparser didn't parse it
                    const chunks: Buffer[] = [];
                    for await (const chunk of ctx.req) {
                        chunks.push(chunk);
                    }
                    xmlBody = Buffer.concat(chunks).toString("utf-8");
                }

                // Parse XML message
                const wechatMsg = await bot.parseXMLMessage(xmlBody);

                // Emit message event
                bot.emit("message", wechatMsg);

                // For passive reply mode, we could build a reply here
                // For now, just return success
                ctx.body = "success";
            } catch (error) {
                this.logger.error(`Failed to process WeChat message:`, error);
                ctx.status = 500;
                ctx.body = "Internal server error";
            }
        });
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const { scene_id, scene_type, message } = params;

        if (scene_type !== "private") {
            throw new Error("WeChat Official Account only supports private messages");
        }

        // Build message content
        let msgType = "text";
        let content: any = "";

        if (Array.isArray(message) && message.length > 0) {
            const segment = message[0];
            if (segment.type === "text") {
                msgType = "text";
                content = message
                    .filter(seg => seg.type === "text")
                    .map(seg => seg.data.text || "")
                    .join("");
            } else if (segment.type === "image") {
                msgType = "image";
                content = { mediaId: segment.data.media_id || segment.data.file };
            } else if (segment.type === "voice") {
                msgType = "voice";
                content = { mediaId: segment.data.media_id || segment.data.file };
            } else if (segment.type === "video") {
                msgType = "video";
                content = {
                    mediaId: segment.data.media_id || segment.data.file,
                    thumbMediaId: segment.data.thumb_media_id,
                    title: segment.data.title,
                    description: segment.data.description,
                };
            }
        }

        const messageId = await bot.sendCustomerServiceMessage(
            scene_id as string,
            msgType,
            content,
        );

        return {
            message_id: messageId,
        };
    }

    deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        throw new Error("WeChat Official Account does not support message deletion");
    }

    getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        throw new Error("WeChat Official Account does not support getting messages");
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const userInfo = await bot.getUserInfo(params.user_id as string);

        return {
            user_id: userInfo.openid,
            user_name: userInfo.nickname || "",
        };
    }

    async getFriendList(uin: string): Promise<Adapter.FriendInfo[]> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(`Account ${uin} not found`);

        const bot = account.client;
        const friends: Adapter.FriendInfo[] = [];
        let nextOpenId: string | undefined = undefined;

        // WeChat MP API returns user list in pages
        do {
            const result = await bot.getUserList(nextOpenId);
            if (result.data && result.data.openid) {
                for (const openid of result.data.openid) {
                    try {
                        const userInfo = await bot.getUserInfo(openid);
                        friends.push({
                            user_id: openid,
                            user_name: userInfo.nickname || "",
                            remark: userInfo.remark,
                        });
                    } catch (error) {
                        this.logger.error(`Failed to get user info for ${openid}:`, error);
                    }
                }
            }
            nextOpenId = result.next_openid;
        } while (nextOpenId);

        return friends;
    }

    getGroupInfo(uin: string, params: Adapter.GetGroupInfoParams): Promise<Adapter.GroupInfo> {
        throw new Error("WeChat Official Account does not support groups");
    }

    getGroupList(uin: string): Promise<Adapter.GroupInfo[]> {
        return Promise.resolve([]);
    }

    getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        throw new Error("WeChat Official Account does not support groups");
    }

    getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        return Promise.resolve([]);
    }

    getChannelInfo(
        uin: string,
        params: Adapter.GetChannelInfoParams,
    ): Promise<Adapter.ChannelInfo> {
        throw new Error("WeChat Official Account does not support channels");
    }

    getChannelList(uin: string): Promise<Adapter.ChannelInfo[]> {
        return Promise.resolve([]);
    }

    getChannelMemberInfo(
        uin: string,
        params: Adapter.GetChannelMemberInfoParams,
    ): Promise<Adapter.ChannelMemberInfo> {
        throw new Error("WeChat Official Account does not support channels");
    }

    getChannelMemberList(
        uin: string,
        params: Adapter.GetChannelMemberListParams,
    ): Promise<Adapter.ChannelMemberInfo[]> {
        return Promise.resolve([]);
    }

    setChannelMemberCard(uin: string, params: Adapter.SetChannelMemberCardParams): Promise<void> {
        throw new Error("WeChat Official Account does not support channels");
    }

    setChannelMemberRole(uin: string, params: Adapter.SetChannelMemberRoleParams): Promise<void> {
        throw new Error("WeChat Official Account does not support channels");
    }

    setChannelMute(uin: string, params: Adapter.SetChannelMuteParams): Promise<void> {
        throw new Error("WeChat Official Account does not support channels");
    }

    inviteChannelMember(uin: string, params: Adapter.InviteChannelMemberParams): Promise<void> {
        throw new Error("WeChat Official Account does not support channels");
    }

    kickChannelMember(uin: string, params: Adapter.KickChannelMemberParams): Promise<void> {
        throw new Error("WeChat Official Account does not support channels");
    }

    setChannelMemberMute(uin: string, params: Adapter.SetChannelMemberMuteParams): Promise<void> {
        throw new Error("WeChat Official Account does not support channels");
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        return {
            user_id: uin,
            user_name: "WeChat Official Account",
        };
    }

    createAccount(config: Account.Config<"wechat-mp">): Account<"wechat-mp", WeChatMPBot> {
        const botConfig: WeChatMPBotConfig = {
            appId: config.appId,
            appSecret: config.appSecret,
            token: config.token,
            encodingAESKey: config.encodingAESKey,
            encrypt: config.encrypt,
            logger: this.logger,
        };

        const bot = new WeChatMPBot(botConfig);
        const account = new Account<"wechat-mp", WeChatMPBot>(this, bot, config);

        account.on("start", async () => {
            try {
                await bot.start();
                account.status = AccountStatus.Online;
                account.nickname = "WeChat Official Account";
                account.avatar = "https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico";
                this.logger.info(`WeChat MP account ${config.account_id} started successfully`);
            } catch (error) {
                this.logger.error(`Failed to start WeChat MP account ${config.account_id}:`, error);
                account.status = AccountStatus.OffLine;
            }
        });

        account.on("stop", async () => {
            try {
                await bot.stop();
                account.status = AccountStatus.OffLine;
                this.logger.info(`WeChat MP account ${config.account_id} stopped`);
            } catch (error) {
                this.logger.error(`Failed to stop WeChat MP account ${config.account_id}:`, error);
            }
        });

        // Setup message handler
        bot.on("message", (wechatMsg: any) => {
            const commonEvent = this.convertToCommonEvent(config.account_id, wechatMsg);
            account.dispatch(commonEvent);
        });

        return account;
    }

    /**
     * Convert WeChat message to common event
     */
    private convertToCommonEvent(accountId: string, wechatMsg: any): CommonEvent.Event {
        const timestamp = wechatMsg.CreateTime * 1000;

        if (wechatMsg.MsgType === "event") {
            // Handle events
            return {
                id: wechatMsg.MsgId || String(Date.now()),
                type: "notice",
                timestamp,
                platform: "wechat-mp",
                bot_id: accountId,
                notice_type: "custom",
                event_type: wechatMsg.Event,
                event_key: wechatMsg.EventKey,
            } as CommonEvent.Notice;
        } else {
            // Handle messages
            const segments: CommonEvent.Segment[] = [];

            switch (wechatMsg.MsgType) {
                case "text":
                    segments.push({
                        type: "text",
                        data: { text: wechatMsg.Content },
                    });
                    break;
                case "image":
                    segments.push({
                        type: "image",
                        data: {
                            url: wechatMsg.PicUrl,
                            media_id: wechatMsg.MediaId,
                        },
                    });
                    break;
                case "voice":
                    segments.push({
                        type: "voice",
                        data: {
                            media_id: wechatMsg.MediaId,
                            format: wechatMsg.Format,
                            recognition: wechatMsg.Recognition,
                        },
                    });
                    break;
                case "video":
                case "shortvideo":
                    segments.push({
                        type: "video",
                        data: {
                            media_id: wechatMsg.MediaId,
                            thumb_media_id: wechatMsg.ThumbMediaId,
                        },
                    });
                    break;
                case "location":
                    segments.push({
                        type: "location",
                        data: {
                            latitude: wechatMsg.Location_X,
                            longitude: wechatMsg.Location_Y,
                            scale: wechatMsg.Scale,
                            label: wechatMsg.Label,
                        },
                    });
                    break;
                case "link":
                    segments.push({
                        type: "link",
                        data: {
                            title: wechatMsg.Title,
                            description: wechatMsg.Description,
                            url: wechatMsg.Url,
                        },
                    });
                    break;
            }

            return {
                id: wechatMsg.MsgId || String(Date.now()),
                type: "message",
                message_type: "private",
                timestamp,
                platform: "wechat-mp",
                bot_id: accountId,
                sender: {
                    id: wechatMsg.FromUserName,
                    name: wechatMsg.FromUserName,
                },
                message: segments,
                raw_message: wechatMsg.Content || "",
                message_id: wechatMsg.MsgId || String(Date.now()),
            } as CommonEvent.Message;
        }
    }
}

declare module "@/adapter" {
    export namespace Adapter {
        export interface Configs {
            "wechat-mp": WechatMpAdapter.Config;
        }
    }
}

export namespace WechatMpAdapter {
    export interface Config extends WeChatMPBotConfig {
        appId: string;
        appSecret: string;
        token: string;
        encodingAESKey?: string;
        encrypt?: boolean;
    }
}
