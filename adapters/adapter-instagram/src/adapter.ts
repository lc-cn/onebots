import {
    Account,
    AccountStatus,
    Adapter,
    BaseApp,
    readPackageVersion,
    type AdapterCapabilityManifest,
    type CommonTypes,
} from "onebots";
import {
    instagramAttachmentType,
    instagramUploadSource,
    normalizeInstagramConfig,
} from "./adapter-support.js";
import { describeInstagramCapabilities, instagramCapabilities } from "./capabilities.js";
import { InstagramClient } from "./client.js";
import { parseApiMessage, parseBusinessProfile } from "./entities.js";
import { InstagramError } from "./errors.js";
import { projectInstagramEvent } from "./events.js";
import { InstagramHttpHost } from "./http-host.js";
import { compileInstagramMessage, projectApiMessage } from "./messages.js";
import { executeInstagramPlatformAction, INSTAGRAM_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { InstagramApiMessage, InstagramDelivery, InstagramUserProfile } from "./types.js";
import { assertMetaId } from "./validation.js";

export class InstagramAdapter extends Adapter<InstagramClient, "instagram"> {
    private readonly httpHost: InstagramHttpHost;

    constructor(app: BaseApp) {
        super(app, "instagram", instagramCapabilities);
        this.icon = "https://static.cdninstagram.com/rsrc.php/v4/yR/r/lam-fZmwmvn.png";
        this.httpHost = new InstagramHttpHost(app, accountId => this.getAccount(accountId)?.client);
    }

    describeCapabilities(uin?: string): AdapterCapabilityManifest {
        const config = uin ? this.getAccount(uin)?.client.config : undefined;
        return config ? describeInstagramCapabilities(config) : instagramCapabilities;
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        this.assertDirect(params.scene_type);
        const client = this.requireClient(uin);
        const message = await compileInstagramMessage(params.message, {
            upload: (type, source, reusable) => client.uploadAttachment(type, source, reusable),
        });
        const result = await client.send(params.scene_id.string, message);
        return { message_id: this.createId(result.message_id) };
    }

    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const message = parseApiMessage(
            await this.requireClient(uin).call(
                "GET",
                `/${assertMetaId(params.message_id.string, "message_id")}`,
                { query: { fields: "id,created_time,from,to,message" } },
            ),
        );
        return this.messageInfo(this.requireClient(uin), message);
    }

    async getMessageHistory(
        uin: string,
        params: Adapter.GetMessageHistoryParams,
    ): Promise<Adapter.MessageInfo[]> {
        this.assertDirect(params.scene_type);
        if (params.offset !== undefined || params.start_message_id) {
            throw new InstagramError(
                "Instagram 使用不透明 cursor；canonical offset/start_message_id 无等价语义",
                { code: "INSTAGRAM_UNSUPPORTED_PAGINATION" },
            );
        }
        const client = this.requireClient(uin);
        const conversation = await client.findConversation(params.scene_id.string);
        if (!conversation) return [];
        const full = await client.getConversation(conversation.id, params.limit || 20);
        return (full.messages?.data || []).map(message => this.messageInfo(client, message));
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const client = this.requireClient(uin);
        const profile =
            client.businessProfile ||
            parseBusinessProfile(
                await client.call("GET", `/${client.config.instagram_user_id}`, {
                    query: { fields: "id,username" },
                }),
            );
        return {
            user_id: this.createId(profile.id),
            user_name: profile.username || profile.name || profile.id,
            user_displayname: profile.name,
            avatar: profile.profile_picture_url,
        };
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        return this.userInfo(await this.requireClient(uin).getUserProfile(params.user_id.string));
    }

    async uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        this.assertDirect(params.scene_type);
        const attachmentId = await this.requireClient(uin).uploadAttachment(
            instagramAttachmentType(params.name),
            instagramUploadSource(params),
            true,
        );
        return {
            file_id: this.createId(attachmentId),
            file_name: params.name,
            url: `instagram://attachment/${attachmentId}`,
            expire_time: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
        };
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        return INSTAGRAM_PLATFORM_ACTIONS.has(action)
            ? executeInstagramPlatformAction(this.requireClient(uin), action, params)
            : super.executePlatformAction(uin, action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return INSTAGRAM_PLATFORM_ACTIONS.has(action);
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots Instagram Adapter",
            app_version: await readPackageVersion(import.meta.url),
            impl: "Instagram API with Instagram Login",
            version: "Graph v25.0",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        const online = account?.status === AccountStatus.Online;
        return {
            online,
            good: online,
            bots: account
                ? [{ self: this.createId(account.client.config.instagram_user_id), online }]
                : [],
        };
    }

    async canSendImage(): Promise<boolean> {
        return true;
    }

    async canSendRecord(): Promise<boolean> {
        return true;
    }

    createAccount(config: Account.Config<"instagram">): Account<"instagram", InstagramClient> {
        const client = new InstagramClient(normalizeInstagramConfig(config), {
            reportError: error => this.logger.error("Instagram 接收管线异常", error),
        });
        const account = new Account<"instagram", InstagramClient>(this, client, config);
        client.on("event", (delivery: InstagramDelivery) =>
            account.dispatchManyAwaited(
                projectInstagramEvent(delivery, {
                    botId: this.createId(client.config.instagram_user_id),
                    createId: value => this.createId(value),
                }),
            ),
        );
        this.httpHost.mount(account.account_id, client);
        account.on("start", async () => {
            try {
                await client.start();
                account.status = AccountStatus.Online;
                account.nickname =
                    client.businessProfile?.username ||
                    client.businessProfile?.name ||
                    client.config.instagram_user_id;
                this.logger.info(`Instagram ${account.account_id} 已就绪（${client.receiveMode}）`);
            } catch (error) {
                account.status = AccountStatus.OffLine;
                this.logger.error(`启动 Instagram ${account.account_id} 失败`, error);
                throw error;
            }
        });
        account.on("stop", async () => {
            try {
                await client.stop();
            } finally {
                account.status = AccountStatus.OffLine;
            }
        });
        return account;
    }

    private requireClient(uin: string): InstagramClient {
        const client = this.getAccount(uin)?.client;
        if (!client) {
            throw new InstagramError(`Instagram 账号 ${uin} 不存在`, {
                code: "ACCOUNT_NOT_FOUND",
                status: 404,
            });
        }
        return client;
    }

    private assertDirect(scene: CommonTypes.Scene): void {
        if (scene !== "direct") {
            throw InstagramError.invalid(
                "Instagram Messaging 只支持 Professional Account 与 IGSID 的一对一 direct 会话",
            );
        }
    }

    private userInfo(profile: InstagramUserProfile): Adapter.UserInfo {
        return {
            user_id: this.createId(profile.id),
            user_name: profile.username || profile.name || profile.id,
            user_displayname: profile.name,
            avatar: profile.profile_pic,
        };
    }

    private messageInfo(
        client: InstagramClient,
        message: InstagramApiMessage,
    ): Adapter.MessageInfo {
        const from = message.from;
        if (!from) throw InstagramError.invalid("Instagram message response 缺少 from");
        const selfId = client.config.instagram_user_id;
        const peer =
            from.id === selfId ? message.to?.data.find(person => person.id !== selfId) : from;
        if (!peer) throw InstagramError.invalid("Instagram message response 缺少对端 IGSID");
        const timestamp = Date.parse(message.created_time);
        if (!Number.isFinite(timestamp)) {
            throw InstagramError.invalid("Instagram message.created_time 无效");
        }
        return {
            message_id: this.createId(message.id),
            time: Math.floor(timestamp / 1000),
            sender: {
                scene_type: "direct",
                sender_id: this.createId(from.id),
                scene_id: this.createId(peer.id),
                sender_name: from.username || from.id,
                scene_name: peer.username || peer.id,
            },
            message: projectApiMessage(message),
        };
    }
}
