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
import type { WhatsAppConfig, WhatsAppPhoneNumberInfo, WhatsAppWebhookEvent } from "./types.js";
import { WhatsAppWebhookHost, type WhatsAppHttpContext } from "./webhook-host.js";

/** Meta WhatsApp Cloud API 适配器。 */
export class WhatsAppAdapter extends Adapter<WhatsAppClient, "whatsapp"> {
    constructor(app: BaseApp) {
        super(app, "whatsapp", whatsAppCapabilities);
        this.icon = "https://static.whatsapp.net/rsrc.php/v3/yz/r/ujTY9i_Jhs7.png";
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        if (params.scene_type !== "private") {
            return this.unsupported(
                "send_message",
                "platform_unsupported",
                "WhatsApp Cloud API 当前仅支持 individual 会话",
            );
        }
        const client = this.requireClient(uin);
        const messages = await compileWhatsAppMessages(
            this.coerceId(params.scene_id).string,
            params.message,
            client,
        );
        let firstMessageId: string | undefined;
        for (const message of messages) {
            const response = await client.sendMessage(message);
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

    async getUserInfo(_uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        return {
            user_id: params.user_id,
            user_name: params.user_id.string,
            user_displayname: params.user_id.string,
        };
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
        return { online, good: online };
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
            event => {
                client.ingest(event);
            },
            error => this.logger.error("WhatsApp Webhook 处理失败", error),
        );
        client.on("webhook", (event: WhatsAppWebhookEvent) => {
            for (const projected of projectWhatsAppWebhook(event, {
                botId: this.createId(config.account_id),
                createId: value => this.createId(value),
            })) {
                account.dispatch(projected);
            }
        });

        this.app.router.get(webhook.path, ctx => {
            const response = webhook.acceptVerification(ctx.query);
            ctx.status = response.status;
            ctx.type = response.contentType || "text/plain";
            ctx.body = response.body;
        });
        this.app.router.post(webhook.path, ctx =>
            webhook.acceptHttp(ctx as unknown as WhatsAppHttpContext),
        );

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
            }
        });
        account.on("stop", () => {
            client.stop();
            account.status = AccountStatus.OffLine;
        });
        client.on("error", error => this.logger.error("WhatsApp 客户端错误", error));
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
}

function normalizeConfig(config: Account.Config<"whatsapp">): WhatsAppConfig {
    return {
        account_id: config.account_id,
        app_secret: config.app_secret,
        business_account_id: config.business_account_id,
        phone_number_id: config.phone_number_id,
        access_token: config.access_token,
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
