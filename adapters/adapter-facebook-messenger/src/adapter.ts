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
    messengerAttachmentType,
    messengerUploadSource,
    normalizeFacebookMessengerConfig,
} from "./adapter-support.js";
import {
    describeFacebookMessengerCapabilities,
    facebookMessengerCapabilities,
} from "./capabilities.js";
import { FacebookMessengerClient } from "./client.js";
import { parseApiMessage, parsePageProfile } from "./entities.js";
import { FacebookMessengerError } from "./errors.js";
import { projectFacebookMessengerEvent } from "./events.js";
import { FacebookMessengerHttpHost } from "./http-host.js";
import { compileMessengerMessage, projectApiMessage } from "./messages.js";
import {
    executeFacebookMessengerPlatformAction,
    FACEBOOK_MESSENGER_PLATFORM_ACTIONS,
} from "./platform-actions.js";
import type {
    FacebookMessengerDelivery,
    MessengerApiMessage,
    MessengerUserProfile,
} from "./types.js";
import { assertMetaId } from "./validation.js";

export class FacebookMessengerAdapter extends Adapter<
    FacebookMessengerClient,
    "facebook-messenger"
> {
    private readonly httpHost: FacebookMessengerHttpHost;

    constructor(app: BaseApp) {
        super(app, "facebook-messenger", facebookMessengerCapabilities);
        this.icon = "https://static.xx.fbcdn.net/rsrc.php/yd/r/hlvibnBVrEb.svg";
        this.httpHost = new FacebookMessengerHttpHost(
            app,
            accountId => this.getAccount(accountId)?.client,
        );
    }

    describeCapabilities(uin?: string): AdapterCapabilityManifest {
        const config = uin ? this.getAccount(uin)?.client.config : undefined;
        return config
            ? describeFacebookMessengerCapabilities(config)
            : facebookMessengerCapabilities;
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        this.assertDirect(params.scene_type);
        const client = this.requireClient(uin);
        const message = await compileMessengerMessage(params.message, {
            upload: (type, source, reusable) => client.uploadAttachment(type, source, reusable),
        });
        const result = await client.send(params.scene_id.string, message);
        if (!result.message_id) {
            throw new FacebookMessengerError("Messenger Send API 未返回 message_id", {
                code: "FACEBOOK_MESSENGER_MISSING_MESSAGE_ID",
            });
        }
        return { message_id: this.createId(result.message_id) };
    }

    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const message = parseApiMessage(
            await this.requireClient(uin).call(
                "GET",
                `/${assertMetaId(params.message_id.string, "message_id")}`,
                {
                    query: { fields: "id,created_time,from,to,message,attachments,reply_to" },
                },
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
            throw new FacebookMessengerError(
                "Messenger 使用不透明 cursor；canonical offset/start_message_id 无等价语义",
                { code: "FACEBOOK_MESSENGER_UNSUPPORTED_PAGINATION" },
            );
        }
        const client = this.requireClient(uin);
        const conversation = await client.findConversation(params.scene_id.string);
        if (!conversation) return [];
        const full = await client.getConversation(conversation.id, params.limit || 25);
        return (full.messages?.data || []).map(message => this.messageInfo(client, message));
    }

    async markMessageAsRead(uin: string, params: Adapter.MarkMessageAsReadParams): Promise<void> {
        this.assertDirect(params.scene_type);
        await this.requireClient(uin).senderAction(params.scene_id.string, "mark_seen");
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const client = this.requireClient(uin);
        const page =
            client.pageProfile ||
            parsePageProfile(
                await client.call("GET", `/${client.config.page_id}`, {
                    query: { fields: "id,name,picture" },
                }),
            );
        return {
            user_id: this.createId(page.id),
            user_name: page.name,
            avatar: page.picture,
        };
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        return this.userInfo(await this.requireClient(uin).getUserProfile(params.user_id.string));
    }

    async uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        this.assertDirect(params.scene_type);
        const source = messengerUploadSource(params);
        const attachmentId = await this.requireClient(uin).uploadAttachment(
            messengerAttachmentType(params.name),
            source,
            true,
        );
        return {
            file_id: this.createId(attachmentId),
            file_name: params.name,
            url: `facebook-messenger://attachment/${attachmentId}`,
            expire_time: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
        };
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        return FACEBOOK_MESSENGER_PLATFORM_ACTIONS.has(action)
            ? executeFacebookMessengerPlatformAction(this.requireClient(uin), action, params)
            : super.executePlatformAction(uin, action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return FACEBOOK_MESSENGER_PLATFORM_ACTIONS.has(action);
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots Facebook Messenger Adapter",
            app_version: await readPackageVersion(import.meta.url),
            impl: "Messenger Platform API",
            version: "Graph v25.0",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        const online = account?.status === AccountStatus.Online;
        return {
            online,
            good: online,
            bots: account ? [{ self: this.createId(account.client.config.page_id), online }] : [],
        };
    }

    async canSendImage(): Promise<boolean> {
        return true;
    }

    async canSendRecord(): Promise<boolean> {
        return true;
    }

    createAccount(
        config: Account.Config<"facebook-messenger">,
    ): Account<"facebook-messenger", FacebookMessengerClient> {
        const client = new FacebookMessengerClient(normalizeFacebookMessengerConfig(config), {
            reportError: error => this.logger.error("Facebook Messenger 接收管线异常", error),
        });
        const account = new Account<"facebook-messenger", FacebookMessengerClient>(
            this,
            client,
            config,
        );
        client.on("event", (delivery: FacebookMessengerDelivery) =>
            account.dispatchManyAwaited(
                projectFacebookMessengerEvent(delivery, {
                    botId: this.createId(client.config.page_id),
                    createId: value => this.createId(value),
                }),
            ),
        );
        this.httpHost.mount(account.account_id, client);
        account.on("start", async (signal: AbortSignal) => {
            try {
                await client.start(signal);
                account.status = AccountStatus.Online;
                account.nickname = client.pageProfile?.name || client.config.page_id;
                this.logger.info(
                    `Facebook Messenger ${account.account_id} 已就绪（${client.receiveMode}）`,
                );
            } catch (error) {
                account.status = AccountStatus.OffLine;
                this.logger.error(`启动 Facebook Messenger ${account.account_id} 失败`, error);
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

    private requireClient(uin: string): FacebookMessengerClient {
        const client = this.getAccount(uin)?.client;
        if (!client) {
            throw new FacebookMessengerError(`Facebook Messenger 账号 ${uin} 不存在`, {
                code: "ACCOUNT_NOT_FOUND",
                status: 404,
            });
        }
        return client;
    }

    private assertDirect(scene: CommonTypes.Scene): void {
        if (scene !== "direct") {
            throw FacebookMessengerError.invalid(
                "Facebook Messenger 只支持 Page 与 PSID 的一对一 direct 会话",
            );
        }
    }

    private userInfo(profile: MessengerUserProfile): Adapter.UserInfo {
        const name =
            profile.name || [profile.first_name, profile.last_name].filter(Boolean).join(" ");
        return {
            user_id: this.createId(profile.id),
            user_name: name || profile.id,
            user_displayname: name || undefined,
            avatar: profile.profile_pic,
        };
    }

    private messageInfo(
        client: FacebookMessengerClient,
        message: MessengerApiMessage,
    ): Adapter.MessageInfo {
        const from = message.from;
        if (!from) {
            throw FacebookMessengerError.invalid("Messenger message response 缺少 from");
        }
        const peer =
            from.id === client.config.page_id
                ? message.to?.data.find(person => person.id !== client.config.page_id)
                : from;
        if (!peer) {
            throw FacebookMessengerError.invalid("Messenger message response 缺少对端 PSID");
        }
        const timestamp = Date.parse(message.created_time);
        if (!Number.isFinite(timestamp)) {
            throw FacebookMessengerError.invalid("Messenger message.created_time 无效");
        }
        return {
            message_id: this.createId(message.id),
            time: Math.floor(timestamp / 1000),
            sender: {
                scene_type: "direct",
                sender_id: this.createId(from.id),
                scene_id: this.createId(peer.id),
                sender_name: from.name || from.id,
                scene_name: peer.name || peer.id,
            },
            message: projectApiMessage(message),
        };
    }
}
