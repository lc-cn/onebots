import { MediaFileType, type InteractionEvent } from "@tencent-connect/qqbot-nodejs";
import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    readPackageVersion,
    type CommonEvent,
    type CommonTypes,
} from "onebots";
import { qqCapabilities } from "./capabilities.js";
import { QQClient } from "./client.js";
import { QQApiError } from "./errors.js";
import { projectQQMessage, projectQQRawEvent } from "./events.js";
import { sendQQMessage } from "./messages.js";
import { QQOpenApi, type QQGuildMessage } from "./open-api.js";
import {
    executeQQPlatformAction,
    QQ_PLATFORM_ACTIONS,
    type QQPlatformAction,
} from "./platform-actions.js";
import { resolveIntentMask, type QQConfig } from "./types.js";
import { QQWebhookHost } from "./webhook-host.js";

const appVersion = readPackageVersion(import.meta.url);
const sdkVersion = readPackageVersion(import.meta.resolve("@tencent-connect/qqbot-nodejs"));

export class QQAdapter extends Adapter<QQClient, "qq"> {
    constructor(app: BaseApp) {
        super(app, "qq", qqCapabilities);
        this.icon = "https://q.qq.com/favicon.ico";
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const messageId = await sendQQMessage(this.client(uin), params, value =>
            String(this.resolveId(value).source),
        );
        return { message_id: this.createId(messageId) };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        if (!params.scene_type || !params.scene_id) {
            throw new QQApiError("撤回 QQ 消息必须提供 scene_type 与 scene_id", {
                code: "QQ_SCENE_REQUIRED",
            });
        }
        await this.openApi(uin).recallMessage(
            params.scene_type,
            params.scene_id.string,
            params.message_id.string,
        );
    }

    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        if (
            (params.scene_type !== "channel" && params.scene_type !== "direct") ||
            !params.scene_id
        ) {
            throw new QQApiError("QQ 仅支持查询频道与频道私信消息", {
                code: "QQ_SCENE_UNSUPPORTED",
            });
        }
        const message = await this.openApi(uin).getMessage(
            params.scene_type,
            params.scene_id.string,
            params.message_id.string,
        );
        return this.toMessageInfo(params.scene_type, params.scene_id, message);
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const user = await this.openApi(uin).getSelf();
        return {
            user_id: this.createId(user.id),
            user_name: user.username ?? "QQ机器人",
            avatar: user.avatar,
        };
    }

    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const group = await this.openApi(uin).getGroup(params.group_id.string);
        return {
            group_id: this.createId(group.group_openid),
            group_name: group.group_name ?? "",
            member_count: group.group_member_num,
        };
    }

    async getGuildList(uin: string): Promise<Adapter.GuildInfo[]> {
        return (await this.openApi(uin).listGuilds()).map(guild => ({
            guild_id: this.createId(guild.id),
            guild_name: guild.name,
            guild_display_name: guild.name,
        }));
    }

    async getGuildInfo(
        uin: string,
        params: Adapter.GetGuildInfoParams,
    ): Promise<Adapter.GuildInfo> {
        const guild = await this.openApi(uin).getGuild(params.guild_id.string);
        return {
            guild_id: this.createId(guild.id),
            guild_name: guild.name,
            guild_display_name: guild.name,
        };
    }

    async getGuildMemberInfo(
        uin: string,
        params: Adapter.GetGuildMemberInfoParams,
    ): Promise<Adapter.GuildMemberInfo> {
        const member = await this.openApi(uin).getMember(
            params.guild_id.string,
            params.user_id.string,
        );
        return {
            guild_id: params.guild_id,
            user_id: this.createId(member.user.id),
            user_name: member.user.username ?? "",
            nickname: member.nick,
            role: member.roles?.[0],
        };
    }

    async getGuildMemberList(
        uin: string,
        params: Adapter.GetGuildMemberListParams,
    ): Promise<Adapter.GuildMemberInfo[]> {
        const members = await this.openApi(uin).listMembers(params.guild_id.string);
        return members.map(member => ({
            guild_id: params.guild_id,
            user_id: this.createId(member.user.id),
            user_name: member.user.username ?? "",
            nickname: member.nick,
            role: member.roles?.[0],
        }));
    }

    async getChannelList(
        uin: string,
        params?: Adapter.GetChannelListParams,
    ): Promise<Adapter.ChannelInfo[]> {
        if (!params?.guild_id)
            throw new QQApiError("获取 QQ 子频道列表必须提供 guild_id", {
                code: "QQ_GUILD_REQUIRED",
            });
        return (await this.openApi(uin).listChannels(params.guild_id.string)).map(channel =>
            this.channelInfo(channel),
        );
    }

    async getChannelInfo(
        uin: string,
        params: Adapter.GetChannelInfoParams,
    ): Promise<Adapter.ChannelInfo> {
        return this.channelInfo(await this.openApi(uin).getChannel(params.channel_id.string));
    }

    async createChannel(
        uin: string,
        params: Adapter.CreateChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        const channel = await this.openApi(uin).createChannel(params.guild_id.string, {
            name: params.channel_name,
            type: params.channel_type ?? 0,
            parent_id: params.parent_id?.string,
        });
        return this.channelInfo(channel);
    }

    async updateChannel(uin: string, params: Adapter.UpdateChannelParams): Promise<void> {
        await this.openApi(uin).updateChannel(params.channel_id.string, {
            name: params.channel_name,
            parent_id: params.parent_id?.string,
        });
    }

    async deleteChannel(uin: string, params: Adapter.DeleteChannelParams): Promise<void> {
        await this.openApi(uin).deleteChannel(params.channel_id.string);
    }

    async createUserChannel(
        uin: string,
        params: Adapter.CreateUserChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        if (!params.guild_id)
            throw new QQApiError("创建 QQ 频道私信必须提供 guild_id", {
                code: "QQ_GUILD_REQUIRED",
            });
        const session = await this.openApi(uin).createDirectSession(
            params.guild_id.string,
            params.user_id.string,
        );
        return {
            channel_id: this.createId(session.guild_id),
            channel_name: "频道私信",
            channel_type: 0,
        };
    }

    async uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        if (params.scene_type !== "private" && params.scene_type !== "group") {
            throw new QQApiError("QQ 富媒体上传仅适用于 C2C 与群聊", {
                code: "QQ_UPLOAD_SCENE_UNSUPPORTED",
            });
        }
        const sources = [params.url, params.path, params.data].filter(value => value !== undefined);
        if (sources.length !== 1)
            throw new QQApiError("上传 QQ 文件必须且只能提供 url/path/data 之一", {
                code: "QQ_MEDIA_SOURCE_REQUIRED",
            });
        const result = await this.client(uin).uploadMedia({
            target: {
                scope: params.scene_type === "private" ? "c2c" : "group",
                targetId: params.scene_id.string,
            },
            fileType: MediaFileType.FILE,
            fileName: params.name,
            srvSendMsg: false,
            ...(params.url
                ? { url: params.url }
                : params.path
                  ? { localPath: params.path }
                  : { fileData: stripBase64Prefix(params.data!) }),
        });
        return { file_id: this.createId(result.file_uuid), file_name: params.name };
    }

    async canSendImage(): Promise<boolean> {
        return true;
    }
    async canSendRecord(): Promise<boolean> {
        return true;
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        return {
            app_name: "@onebots/adapter-qq",
            app_version: await appVersion,
            impl: "onebots",
            version: await sdkVersion,
            onebot_version: "12",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const online = this.getAccount(uin)?.status === AccountStatus.Online;
        return { online, good: online };
    }

    isPlatformActionImplemented(action: string): boolean {
        return QQ_PLATFORM_ACTIONS.includes(action as QQPlatformAction);
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!this.isPlatformActionImplemented(action)) return this.unsupported(action);
        return executeQQPlatformAction(this.client(uin), action as QQPlatformAction, params);
    }

    createAccount(config: Account.Config<"qq">): Account<"qq", QQClient> {
        const qqConfig = config as Account.Config<"qq"> & QQConfig;
        const webhookPath = qqConfig.webhook_path ?? `/qq/${config.account_id}/webhook`;
        let account: Account<"qq", QQClient>;
        const host = new QQWebhookHost(webhookPath, config.account_id, (type, data) => {
            account.dispatch(this.projectRaw(account, type, data));
        });
        const client = new QQClient(
            {
                appId: qqConfig.appid,
                appSecret: qqConfig.secret,
                accountId: config.account_id,
                markdownSupport: qqConfig.markdown_support,
                baseUrl: qqConfig.api_base_url,
                tokenBaseUrl: qqConfig.token_base_url,
                intents: resolveIntentMask(qqConfig.intents),
                transport: qqConfig.receive_mode === "webhook" ? "webhook" : "websocket",
                webhook:
                    qqConfig.receive_mode === "webhook"
                        ? { path: webhookPath, port: 0, server: host }
                        : undefined,
                logger: {
                    info: (message, meta) => this.logger.info(message, meta),
                    warn: (message, meta) => this.logger.warn(message, meta),
                    error: (message, meta) => this.logger.error(message, meta),
                    debug: (message, meta) => this.logger.debug(message, meta),
                },
            },
            this.logger,
        );
        account = new Account(this, client, config);
        if (qqConfig.receive_mode === "webhook") {
            this.app.router.post(webhookPath, ctx => host.acceptHttp(ctx));
        }
        this.bindEvents(account, client);
        account.on("start", () => {
            void client
                .run()
                .catch(error => this.logger.error("QQ Client 已停止", QQApiError.wrap(error)));
        });
        account.on("stop", () => {
            client.close();
            account.status = AccountStatus.OffLine;
        });
        return account;
    }

    private bindEvents(account: Account<"qq", QQClient>, client: QQClient): void {
        client.on("ready", data => {
            account.status = AccountStatus.Online;
            void this.refreshProfile(account);
            account.dispatch(this.projectRaw(account, "READY", data));
        });
        client.on("resumed", data => {
            account.status = AccountStatus.Online;
            account.dispatch(this.projectRaw(account, "RESUMED", data));
        });
        client.on("error", error => {
            account.status = AccountStatus.OffLine;
            this.logger.error(`QQ ${account.account_id} 连接错误`, error);
        });
        client.on("message", (_context, event) =>
            account.dispatch(projectQQMessage(event, this.projectionContext(account))),
        );
        client.on("interaction", (_context, event: InteractionEvent) =>
            account.dispatch(this.projectRaw(account, "INTERACTION_CREATE", event)),
        );
        client.on("rawEvent", event =>
            account.dispatch(this.projectRaw(account, event.eventType, event.data)),
        );
    }

    private projectRaw(
        account: Account<"qq", QQClient>,
        type: string,
        data: unknown,
    ): CommonEvent.Notice | CommonEvent.Request | CommonEvent.Meta {
        return projectQQRawEvent(type, data, this.projectionContext(account));
    }

    private projectionContext(account: Account<"qq", QQClient>) {
        return {
            botId: this.createId(account.account_id),
            createId: (value: string | number) => this.createId(value),
        };
    }

    private async refreshProfile(account: Account<"qq", QQClient>): Promise<void> {
        try {
            const user = await new QQOpenApi(account.client).getSelf();
            account.nickname = user.username ?? "QQ机器人";
            account.avatar = user.avatar ?? this.icon;
        } catch (error) {
            this.logger.error(
                `QQ ${account.account_id} 获取机器人资料失败`,
                QQApiError.wrap(error),
            );
        }
    }

    private client(uin: string): QQClient {
        const client = this.getAccount(uin)?.client;
        if (!client)
            throw new QQApiError(`QQ 账号 ${uin} 不存在`, { code: "QQ_ACCOUNT_NOT_FOUND" });
        return client;
    }

    private openApi(uin: string): QQOpenApi {
        return new QQOpenApi(this.client(uin));
    }

    private channelInfo(channel: {
        id: string;
        name: string;
        type?: number;
        parent_id?: string;
    }): Adapter.ChannelInfo {
        return {
            channel_id: this.createId(channel.id),
            channel_name: channel.name,
            channel_type: channel.type,
            parent_id: channel.parent_id ? this.createId(channel.parent_id) : undefined,
        };
    }

    private toMessageInfo(
        scene: "channel" | "direct",
        sceneId: CommonTypes.Id,
        message: QQGuildMessage,
    ): Adapter.MessageInfo {
        return {
            message_id: this.createId(message.id),
            time: message.timestamp ? Date.parse(message.timestamp) : Date.now(),
            sender: {
                scene_type: scene,
                sender_id: this.createId(message.author?.id ?? "unknown"),
                scene_id: sceneId,
                sender_name: message.author?.username ?? "",
                scene_name: "",
            },
            message: [
                ...(message.content ? [{ type: "text", data: { text: message.content } }] : []),
                ...(message.attachments ?? []).map(item => ({
                    type: item.content_type?.startsWith("image/") ? "image" : "file",
                    data: { url: item.url, name: item.filename },
                })),
            ],
        };
    }
}

function stripBase64Prefix(data: string): string {
    return data.startsWith("base64://") ? data.slice("base64://".length) : data;
}

AdapterRegistry.register("qq", QQAdapter, {
    name: "qq",
    displayName: "QQ 官方机器人",
    description: "腾讯 QQ 开放平台官方机器人适配器，支持 Gateway、Webhook 与 OpenAPI",
    homepage: "https://q.qq.com/",
    capabilities: qqCapabilities,
});
