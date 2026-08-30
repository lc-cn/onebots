import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    readPackageVersion,
} from "onebots";
import { whatsAppCapabilities } from "./capabilities.js";
import { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import { projectWhatsAppWebhook } from "./events.js";
import { compileWhatsAppMessages } from "./messages.js";
import { executeWhatsAppPlatformAction, WHATSAPP_PLATFORM_ACTIONS } from "./platform-actions.js";
import type {
    WhatsAppConfig,
    WhatsAppGroupDetails,
    WhatsAppGroupParticipant,
    WhatsAppGroupSummary,
    WhatsAppPhoneNumberInfo,
    WhatsAppWebhookEvent,
} from "./types.js";
import { WhatsAppWebhookHost, type WhatsAppHttpContext } from "./webhook-host.js";
import { WhatsAppWebhookRouter } from "./webhook-routing.js";

/** Meta WhatsApp Cloud API 适配器。 */
export class WhatsAppAdapter extends Adapter<WhatsAppClient, "whatsapp"> {
    private readonly webhookRouter = new WhatsAppWebhookRouter();

    constructor(app: BaseApp) {
        super(app, "whatsapp", whatsAppCapabilities);
        this.icon = "https://static.whatsapp.net/rsrc.php/v3/yz/r/ujTY9i_Jhs7.png";
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        if (params.scene_type !== "private" && params.scene_type !== "group") {
            return this.unsupported(
                "send_message",
                "platform_unsupported",
                "WhatsApp Cloud API 仅支持 individual 与 Groups API 会话",
            );
        }
        const client = this.requireClient(uin);
        const messages = await compileWhatsAppMessages(
            this.coerceId(params.scene_id).string,
            params.message,
            client.media,
        );
        let firstMessageId: string | undefined;
        const recipientType = params.scene_type === "group" ? "group" : "individual";
        for (const message of messages) {
            const response = await client.sendMessage({
                ...message,
                recipient_type: recipientType,
            });
            firstMessageId ||= response.messages[0]?.id;
        }
        if (!firstMessageId) {
            throw new WhatsAppApiError("WhatsApp 未返回已发送消息 ID", {
                code: "WHATSAPP_EMPTY_SEND_RESPONSE",
            });
        }
        return { message_id: this.createId(firstMessageId) };
    }

    async markMessageAsRead(uin: string, params: Adapter.MarkMessageAsReadParams): Promise<void> {
        if (!params.message_id) {
            throw new WhatsAppApiError("WhatsApp mark_message_as_read 必须提供 message_id", {
                code: "WHATSAPP_INVALID_PARAMETER",
            });
        }
        await this.requireClient(uin).markMessageRead(params.message_id.string);
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        return this.toLoginInfo(await this.requireClient(uin).getPhoneNumberInfo());
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const contact = this.requireClient(uin).getObservedContact(params.user_id.string);
        if (!contact) {
            throw new WhatsAppApiError(
                `WhatsApp 联系人 ${params.user_id.string} 尚未出现在 Webhook 中`,
                {
                    code: "WHATSAPP_USER_NOT_OBSERVED",
                    status: 404,
                },
            );
        }
        return {
            user_id: params.user_id,
            user_name: contact.name,
            user_displayname: contact.name,
        };
    }

    async getGroupList(uin: string): Promise<Adapter.GroupInfo[]> {
        const groups = await this.requireClient(uin).groups.listAll();
        return groups.map(group => this.toGroupInfo(group));
    }

    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        return this.toGroupInfo(await this.requireClient(uin).groups.get(params.group_id.string));
    }

    async setGroupName(uin: string, params: Adapter.SetGroupNameParams): Promise<void> {
        await this.requireClient(uin).groups.update(params.group_id.string, {
            subject: params.group_name,
        });
    }

    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const group = await this.requireClient(uin).groups.get(params.group_id.string);
        return group.participants.map(participant => this.toGroupMember(group.id, participant));
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const group = await this.requireClient(uin).groups.get(params.group_id.string);
        return this.toGroupMember(group.id, requireGroupParticipant(group, params.user_id.string));
    }

    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        if (params.reject_add_request) {
            throw new WhatsAppApiError("WhatsApp 移除群成员不支持同时拒绝后续申请", {
                code: "WHATSAPP_UNSUPPORTED_SEMANTICS",
            });
        }
        await this.requireClient(uin).groups.removeParticipants(params.group_id.string, [
            params.user_id.string,
        ]);
    }

    async handleGroupRequest(uin: string, params: Adapter.HandleGroupRequestParams): Promise<void> {
        if (params.type !== "request" || params.block) {
            throw new WhatsAppApiError(
                params.block
                    ? "WhatsApp 拒绝入群申请不支持 block 语义"
                    : "WhatsApp Groups API 不支持处理管理员邀请事件",
                { code: "WHATSAPP_UNSUPPORTED_SEMANTICS" },
            );
        }
        const groupId = params.group_id?.string;
        const requestId = params.request_id?.string || params.flag;
        if (!groupId || !requestId) {
            throw new WhatsAppApiError("WhatsApp 入群申请必须提供 group_id 和 request_id/flag", {
                code: "WHATSAPP_INVALID_PARAMETER",
            });
        }
        const groups = this.requireClient(uin).groups;
        if (params.approve) await groups.approveJoinRequests(groupId, [requestId]);
        else await groups.rejectJoinRequests(groupId, [requestId]);
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!WHATSAPP_PLATFORM_ACTIONS.has(action)) {
            return super.executePlatformAction(uin, action, params);
        }
        return executeWhatsAppPlatformAction(this.requireClient(uin), action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return WHATSAPP_PLATFORM_ACTIONS.has(action);
    }

    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots WhatsApp Adapter",
            app_version: await readPackageVersion(import.meta.url),
            impl: "Meta WhatsApp Cloud API",
            version: this.requireClient(uin).apiVersion,
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const online = this.getAccount(uin)?.status === AccountStatus.Online;
        const client = this.requireClient(uin);
        return {
            online,
            good: online,
            bots: [{ self: this.createId(client.config.phone_number_id), online }],
        };
    }

    async canSendImage(): Promise<boolean> {
        return true;
    }

    async canSendRecord(): Promise<boolean> {
        return true;
    }

    createAccount(config: Account.Config<"whatsapp">): Account<"whatsapp", WhatsAppClient> {
        const whatsappConfig = normalizeConfig(config);
        const client = new WhatsAppClient(whatsappConfig);
        const account = new Account<"whatsapp", WhatsAppClient>(this, client, config);
        const webhook = new WhatsAppWebhookHost(
            whatsappConfig,
            client,
            error => this.logger.error("WhatsApp Webhook 处理失败", error),
            request =>
                this.webhookRouter.ingest(client, request, (phoneNumberId, changes) =>
                    this.logger.warn(
                        `WhatsApp Phone Number ID ${phoneNumberId} 未配置，忽略 ${changes} 个 change`,
                    ),
                ),
        );
        this.webhookRouter.register(client);
        client.on("webhook", async (event: WhatsAppWebhookEvent) => {
            for (const projected of projectWhatsAppWebhook(event, {
                botId: this.createId(config.phone_number_id),
                createId: value => this.createId(value),
            })) {
                await account.dispatchAwaited(projected);
            }
        });

        if (client.receiveMode === "webhook") {
            this.app.router.get(webhook.path, ctx => {
                const response = webhook.acceptVerification(ctx.query);
                ctx.status = response.status;
                ctx.type = response.contentType || "text/plain";
                ctx.body = response.body;
            });
            this.app.router.post(webhook.path, ctx =>
                webhook.acceptHttp(ctx as unknown as WhatsAppHttpContext),
            );
        }

        account.on("start", async () => {
            try {
                const info = await client.start();
                account.status = AccountStatus.Online;
                account.nickname =
                    info.verified_name || info.display_phone_number || config.account_id;
                this.logger.info(`WhatsApp Bot ${config.account_id} 已就绪`);
            } catch (error) {
                account.status = AccountStatus.OffLine;
                this.logger.error(`启动 WhatsApp Bot ${config.account_id} 失败`, error);
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

    private requireClient(uin: string): WhatsAppClient {
        const account = this.getAccount(uin);
        if (!account) {
            throw new WhatsAppApiError(`WhatsApp 账号 ${uin} 不存在`, {
                code: "ACCOUNT_NOT_FOUND",
            });
        }
        return account.client;
    }

    private toLoginInfo(info: WhatsAppPhoneNumberInfo): Adapter.UserInfo {
        const name = info.verified_name || info.display_phone_number || info.id;
        return {
            user_id: this.createId(info.id),
            user_name: name,
            user_displayname: info.display_phone_number || name,
        };
    }

    private toGroupInfo(group: WhatsAppGroupDetails | WhatsAppGroupSummary): Adapter.GroupInfo {
        const isDetails = "creation_timestamp" in group;
        const createdAt = isDetails ? group.creation_timestamp : group.created_at;
        return {
            group_id: this.createId(group.id),
            group_name: group.subject,
            description: isDetails ? group.description : undefined,
            member_count: isDetails ? group.total_participant_count : undefined,
            created_time: timestampSeconds(createdAt),
        };
    }

    private toGroupMember(
        groupId: string,
        participant: WhatsAppGroupParticipant,
    ): Adapter.GroupMemberInfo {
        const id = participantIdentity(participant);
        return {
            group_id: this.createId(groupId),
            user_id: this.createId(id),
            user_name: participant.username || participant.wa_id || id,
            role: "member",
        };
    }
}

function participantIdentity(participant: WhatsAppGroupParticipant): string {
    if (participant.user_id) return participant.user_id;
    if (participant.wa_id) return participant.wa_id;
    if (participant.username) return participant.username;
    throw new WhatsAppApiError("WhatsApp 群成员缺少身份标识", {
        code: "WHATSAPP_INVALID_RESPONSE",
    });
}

function requireGroupParticipant(
    group: WhatsAppGroupDetails,
    identity: string,
): WhatsAppGroupParticipant {
    const participant = group.participants.find(item =>
        [item.user_id, item.wa_id, item.username].includes(identity),
    );
    if (participant) return participant;
    throw new WhatsAppApiError(`WhatsApp 群 ${group.id} 中不存在成员 ${identity}`, {
        code: "WHATSAPP_GROUP_MEMBER_NOT_FOUND",
        status: 404,
    });
}

function timestampSeconds(value: string | number): number | undefined {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp)) {
        const milliseconds = typeof value === "string" ? Date.parse(value) : NaN;
        return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined;
    }
    return timestamp >= 1_000_000_000_000 ? Math.floor(timestamp / 1000) : timestamp;
}

function normalizeConfig(config: Account.Config<"whatsapp">): WhatsAppConfig {
    return {
        account_id: config.account_id,
        app_secret: config.app_secret,
        business_account_id: config.business_account_id,
        phone_number_id: config.phone_number_id,
        access_token: config.access_token,
        receive_mode: config.receive_mode,
        webhook_verify_token: config.webhook_verify_token,
        webhook_path: config.webhook_path,
        api_version: config.api_version,
        api_base_url: config.api_base_url,
        deduplicate_webhooks: config.deduplicate_webhooks,
        webhook_deduplication_limit: config.webhook_deduplication_limit,
    };
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            whatsapp: WhatsAppConfig;
        }
    }
}

AdapterRegistry.register("whatsapp", WhatsAppAdapter, {
    name: "whatsapp",
    displayName: "WhatsApp Cloud API",
    description: "Meta 官方 WhatsApp Cloud API 适配器",
    icon: "https://static.whatsapp.net/rsrc.php/v3/yz/r/ujTY9i_Jhs7.png",
    homepage: "https://developers.facebook.com/docs/whatsapp/cloud-api/",
    author: "凉菜",
    capabilities: whatsAppCapabilities,
});
