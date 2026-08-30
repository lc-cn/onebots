import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    mapConcurrent,
    readPackageVersion,
} from "onebots";
import { weComCapabilities } from "./capabilities.js";
import { WeComClient } from "./client.js";
import { WeComApiError } from "./errors.js";
import { projectWeComEvent } from "./events.js";
import { prepareWeComMediaSegments, uploadWeComMedia } from "./media.js";
import { compileWeComMessages } from "./messages.js";
import { executeWeComPlatformAction, WECOM_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { WeComAppChat, WeComConfig, WeComEvent, WeComUser } from "./types.js";
import { WeComWebhookHost, type WeComHttpContext } from "./webhook-host.js";

/** 企业微信自建应用适配器。 */
export class WeComAdapter extends Adapter<WeComClient, "wecom"> {
    constructor(app: BaseApp) {
        super(app, "wecom", weComCapabilities);
        this.icon = "https://work.weixin.qq.com/favicon.ico";
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const client = this.requireClient(uin);
        const target = this.coerceId(params.scene_id).string;
        const segments = await prepareWeComMediaSegments(client, params.message);
        const messages = compileWeComMessages(segments, value =>
            String(this.resolveId(value).source),
        );
        let firstId: string | undefined;
        for (const message of messages) {
            const id =
                params.scene_type === "group"
                    ? await client.sendAppChatMessage(target, message)
                    : params.scene_type === "private" || params.scene_type === "direct"
                      ? await client.sendApplicationMessage({ ...message, touser: target })
                      : await this.unsupported(
                            "send_message",
                            "platform_unsupported",
                            `企业微信不支持 ${params.scene_type} 会话`,
                        );
            firstId ||= id;
        }
        if (!firstId)
            throw new WeComApiError("企业微信未返回消息 ID", { code: "WECOM_EMPTY_SEND_RESPONSE" });
        return { message_id: this.createId(firstId) };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        await this.requireClient(uin).recallMessage(params.message_id.string);
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const client = this.requireClient(uin);
        const agent = client.getCachedAgent() || (await client.getAgent());
        return {
            user_id: this.createId(String(agent.agentid)),
            user_name: agent.name || `企业微信应用 ${agent.agentid}`,
            user_displayname: agent.description || agent.name,
            avatar: agent.square_logo_url,
        };
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        return this.toUserInfo(await this.requireClient(uin).getUserInfo(params.user_id.string));
    }

    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        return this.toGroupInfo(await this.requireClient(uin).getAppChat(params.group_id.string));
    }

    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const client = this.requireClient(uin);
        const chat = await client.getAppChat(params.group_id.string);
        return mapConcurrent(chat.userlist, 10, async userid => {
            const user = await client.getUserInfo(userid);
            return {
                group_id: params.group_id,
                user_id: this.createId(user.userid),
                user_name: user.name || user.userid,
                card: user.alias,
                role: chat.owner === userid ? ("owner" as const) : ("member" as const),
            };
        });
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const client = this.requireClient(uin);
        const chat = await client.getAppChat(params.group_id.string);
        const userId = params.user_id.string;
        if (!chat.userlist.includes(userId)) {
            throw new WeComApiError(`成员 ${userId} 不在应用群聊 ${chat.chatid} 中`, {
                code: "WECOM_APPCHAT_MEMBER_NOT_FOUND",
            });
        }
        const user = await client.getUserInfo(userId);
        return {
            group_id: params.group_id,
            user_id: this.createId(user.userid),
            user_name: user.name || user.userid,
            card: user.alias,
            role: chat.owner === user.userid ? "owner" : "member",
        };
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!WECOM_PLATFORM_ACTIONS.has(action))
            return super.executePlatformAction(uin, action, params);
        return executeWeComPlatformAction(this.requireClient(uin), action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return WECOM_PLATFORM_ACTIONS.has(action);
    }
    async canSendImage(): Promise<boolean> {
        return true;
    }
    async canSendRecord(): Promise<boolean> {
        return true;
    }

    async uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        const sources = [params.url, params.path, params.data].filter(
            (value): value is string => typeof value === "string" && value.length > 0,
        );
        if (sources.length !== 1) {
            throw new WeComApiError("upload_file 必须且只能提供 url/path/data 之一", {
                code: "WECOM_INVALID_MEDIA",
            });
        }
        const source = params.url || params.path || asBase64Source(params.data!);
        const mediaId = await uploadWeComMedia(this.requireClient(uin), "file", {
            source,
            filename: params.name,
        });
        return { file_id: this.createId(mediaId), file_name: params.name };
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots WeCom Adapter",
            app_version: await readPackageVersion(import.meta.url),
            impl: "WeCom Custom Application API",
            version: "v1",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const online = this.getAccount(uin)?.status === AccountStatus.Online;
        return { online, good: online };
    }

    createAccount(config: Account.Config<"wecom">): Account<"wecom", WeComClient> {
        const wecomConfig = normalizeConfig(config);
        const client = new WeComClient(wecomConfig);
        const account = new Account<"wecom", WeComClient>(this, client, config);
        const webhook = new WeComWebhookHost(wecomConfig, client, error =>
            this.logger.error("企业微信 Webhook 处理失败", error),
        );

        client.on("raw_event", async (event: WeComEvent) => {
            await account.dispatchAwaited(
                projectWeComEvent(event, {
                    botId: config.agent_id,
                    createId: value => this.createId(value),
                }),
            );
        });
        if (client.receiveMode === "webhook") {
            this.app.router.all(webhook.path, ctx =>
                webhook.acceptHttp(ctx as unknown as WeComHttpContext),
            );
        }

        account.on("start", async () => {
            try {
                const agent = await client.start();
                account.status = AccountStatus.Online;
                account.nickname = agent.name || config.account_id;
                account.avatar = agent.square_logo_url || this.icon;
                this.logger.info(`企业微信应用 ${config.account_id} 已就绪`);
            } catch (error) {
                account.status = AccountStatus.OffLine;
                this.logger.error(`启动企业微信应用 ${config.account_id} 失败`, error);
                throw error;
            }
        });
        account.on("stop", async () => {
            await client.stop();
            account.status = AccountStatus.OffLine;
        });
        return account;
    }

    private requireClient(uin: string): WeComClient {
        const account = this.getAccount(uin);
        if (!account)
            throw new WeComApiError(`企业微信账号 ${uin} 不存在`, { code: "ACCOUNT_NOT_FOUND" });
        return account.client;
    }

    private toUserInfo(user: WeComUser): Adapter.UserInfo {
        return {
            user_id: this.createId(user.userid),
            user_name: user.name || user.userid,
            user_displayname: user.alias || user.name,
            avatar: user.avatar,
        };
    }

    private toGroupInfo(chat: WeComAppChat): Adapter.GroupInfo {
        return {
            group_id: this.createId(chat.chatid),
            group_name: chat.name || chat.chatid,
            member_count: chat.userlist.length,
        };
    }
}

function asBase64Source(value: string): string {
    return /^(?:base64:\/\/|data:)/u.test(value) ? value : `base64://${value}`;
}

function normalizeConfig(config: Account.Config<"wecom">): WeComConfig {
    return {
        account_id: config.account_id,
        corp_id: config.corp_id,
        corp_secret: config.corp_secret,
        directory_secret: config.directory_secret,
        agent_id: config.agent_id,
        receive_mode: config.receive_mode,
        token: config.token,
        encoding_aes_key: config.encoding_aes_key,
        webhook_path: config.webhook_path,
        deduplicate_webhooks: config.deduplicate_webhooks,
        webhook_deduplication_limit: config.webhook_deduplication_limit,
        api_base_url: config.api_base_url,
    };
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            wecom: WeComConfig;
        }
    }
}

AdapterRegistry.register("wecom", WeComAdapter, {
    name: "wecom",
    displayName: "企业微信自建应用",
    description: "企业微信自建应用官方 API：可靠加密回调、消息、通讯录与协作办公",
    icon: "https://work.weixin.qq.com/favicon.ico",
    homepage: "https://developer.work.weixin.qq.com/document/path/90487",
    author: "凉菜",
    capabilities: weComCapabilities,
});
