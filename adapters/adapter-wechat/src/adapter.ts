import { readFile } from "node:fs/promises";
import { Account, AccountStatus, Adapter, AdapterRegistry, BaseApp } from "onebots";
import { wechatCapabilities } from "./capabilities.js";
import { WechatClient } from "./client.js";
import { WechatApiError } from "./errors.js";
import { projectWechatEvent } from "./events.js";
import { compileWechatMessages } from "./messages.js";
import { executeWechatPlatformAction, WECHAT_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { WechatConfig, WechatIncomingMessage, WechatUser } from "./types.js";
import { WechatWebhookHost, type WechatHttpContext } from "./webhook-host.js";

/** 微信公众号官方 API 适配器。 */
export class WechatAdapter extends Adapter<WechatClient, "wechat"> {
    constructor(app: BaseApp) {
        super(app, "wechat", wechatCapabilities);
        this.icon = "https://res.wx.qq.com/a/wx_fed/assets/res/OTE0YTAw.png";
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        if (params.scene_type !== "private") {
            return this.unsupported(
                "send_message",
                "platform_unsupported",
                "微信公众号只存在用户私聊，不支持群组或频道会话",
            );
        }
        const client = this.requireClient(uin);
        const compiled = compileWechatMessages(params.message);
        if (compiled.replyEventId && client.hasPendingPassiveReply(compiled.replyEventId)) {
            if (compiled.messages.length !== 1) {
                throw new WechatApiError("微信公众号被动回复只能包含一条原生消息", {
                    code: "WECHAT_INVALID_PASSIVE_REPLY",
                });
            }
            if (!isPassiveReplyType(compiled.messages[0]!.msgtype)) {
                throw new WechatApiError(
                    `微信公众号不支持 ${compiled.messages[0]!.msgtype} 被动回复`,
                    { code: "WECHAT_UNSUPPORTED_PASSIVE_MESSAGE" },
                );
            }
            if (client.submitPassiveReply(compiled.replyEventId, compiled.messages[0]!)) {
                return { message_id: this.createId(`passive:${compiled.replyEventId}`) };
            }
        }
        const openid = this.coerceId(params.scene_id).string;
        let firstId: string | undefined;
        for (const message of compiled.messages)
            firstId ||= await client.sendCustomMessage(openid, message);
        if (!firstId)
            throw new WechatApiError("微信公众号未返回消息 ID", {
                code: "WECHAT_EMPTY_SEND_RESPONSE",
            });
        return { message_id: this.createId(firstId) };
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) return this.accountNotFound(uin);
        return {
            user_id: this.createId(account.config.account_id),
            user_name: account.nickname || "微信公众号",
            avatar: account.avatar,
        };
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        return this.toUserInfo(await this.requireClient(uin).getUserInfo(params.user_id.string));
    }

    async getFriendList(uin: string): Promise<Adapter.FriendInfo[]> {
        const client = this.requireClient(uin);
        const result: Adapter.FriendInfo[] = [];
        let cursor: string | undefined;
        do {
            const page = await client.getUserList(cursor);
            for (const user of await client.batchGetUserInfo(page.data?.openid || [])) {
                if (user.subscribe === 1) result.push(this.toFriendInfo(user));
            }
            cursor = page.next_openid || undefined;
        } while (cursor);
        return result;
    }

    async getFriendInfo(
        uin: string,
        params: Adapter.GetFriendInfoParams,
    ): Promise<Adapter.FriendInfo> {
        return this.toFriendInfo(await this.requireClient(uin).getUserInfo(params.user_id.string));
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!WECHAT_PLATFORM_ACTIONS.has(action))
            return super.executePlatformAction(uin, action, params);
        return executeWechatPlatformAction(this.requireClient(uin), action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return WECHAT_PLATFORM_ACTIONS.has(action);
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots WeChat Official Account Adapter",
            app_version: await readPackageVersion(new URL("../package.json", import.meta.url)),
            impl: "WeChat Official Account API",
            version: "v1",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const online = this.getAccount(uin)?.status === AccountStatus.Online;
        return { online, good: online };
    }

    async canSendImage(): Promise<boolean> {
        return true;
    }
    async canSendRecord(): Promise<boolean> {
        return true;
    }

    createAccount(config: Account.Config<"wechat">): Account<"wechat", WechatClient> {
        const wechatConfig = normalizeConfig(config);
        const client = new WechatClient(wechatConfig);
        const account = new Account<"wechat", WechatClient>(this, client, config);
        const webhook = new WechatWebhookHost(wechatConfig, client, error =>
            this.logger.error("微信公众号 Webhook 处理失败", error),
        );

        client.on("raw_event", (message: WechatIncomingMessage) => {
            account.dispatch(
                projectWechatEvent(message, {
                    botId: this.createId(config.account_id),
                    createId: value => this.createId(value),
                }),
            );
        });
        client.on("error", error => this.logger.error("微信公众号客户端错误", error));
        this.app.router.all(webhook.path, ctx =>
            webhook.acceptHttp(ctx as unknown as WechatHttpContext),
        );

        account.on("start", async () => {
            try {
                await client.start();
                account.status = AccountStatus.Online;
                account.nickname = config.account_id;
                account.avatar = this.icon;
                this.logger.info(`微信公众号 ${config.account_id} 已就绪`);
            } catch (error) {
                account.status = AccountStatus.OffLine;
                this.logger.error(`启动微信公众号 ${config.account_id} 失败`, error);
            }
        });
        account.on("stop", () => {
            client.stop();
            account.status = AccountStatus.OffLine;
        });
        return account;
    }

    private requireClient(uin: string): WechatClient {
        const account = this.getAccount(uin);
        if (!account) return this.accountNotFound(uin);
        return account.client;
    }

    private accountNotFound(uin: string): never {
        throw new WechatApiError(`微信公众号账号 ${uin} 不存在`, { code: "ACCOUNT_NOT_FOUND" });
    }

    private toUserInfo(user: WechatUser): Adapter.UserInfo {
        return {
            user_id: this.createId(user.openid),
            user_name: user.nickname || user.openid,
            user_displayname: user.remark || user.nickname,
            avatar: user.headimgurl,
        };
    }

    private toFriendInfo(user: WechatUser): Adapter.FriendInfo {
        return {
            user_id: this.createId(user.openid),
            user_name: user.nickname || user.openid,
            remark: user.remark,
        };
    }
}

function isPassiveReplyType(type: string): boolean {
    return ["text", "image", "voice", "video", "news"].includes(type);
}

function normalizeConfig(config: Account.Config<"wechat">): WechatConfig {
    return {
        account_id: config.account_id,
        app_id: config.app_id,
        app_secret: config.app_secret,
        token: config.token,
        encoding_aes_key: config.encoding_aes_key,
        webhook_path: config.webhook_path,
        passive_reply_timeout_ms: config.passive_reply_timeout_ms,
        deduplicate_webhooks: config.deduplicate_webhooks,
        webhook_deduplication_limit: config.webhook_deduplication_limit,
        api_base_url: config.api_base_url,
    };
}

async function readPackageVersion(url: URL): Promise<string> {
    const value = JSON.parse(await readFile(url, "utf8")) as { version?: unknown };
    if (typeof value.version !== "string") throw new Error(`package.json 缺少 version: ${url}`);
    return value.version;
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            wechat: WechatConfig;
        }
    }
}

AdapterRegistry.register("wechat", WechatAdapter, {
    name: "wechat",
    displayName: "微信公众号",
    description: "微信公众平台官方 API 适配器，支持安全 Webhook、客服消息和原生管理 API",
    icon: "https://res.wx.qq.com/a/wx_fed/assets/res/OTE0YTAw.png",
    homepage: "https://developers.weixin.qq.com/doc/offiaccount/Getting_Started/Overview.html",
    author: "凉菜",
    capabilities: wechatCapabilities,
});
