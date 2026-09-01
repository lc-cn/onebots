import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    readPackageVersion,
    type CommonTypes,
} from "onebots";
import { emailCapabilities } from "./capabilities.js";
import { EmailClient } from "./client.js";
import { parseRecipients, toMessageInfo } from "./entities.js";
import { EmailError } from "./errors.js";
import { projectEmailEvent } from "./events.js";
import { compileEmailMessage, createEmailSendOptions } from "./messages.js";
import { EMAIL_PLATFORM_ACTIONS, executeEmailPlatformAction } from "./platform-actions.js";
import type { EmailConfig, EmailMessage } from "./types.js";

/** 基于 SMTP 发送与 IMAP IDLE 接收的邮件适配器。 */
export class EmailAdapter extends Adapter<EmailClient, "email"> {
    constructor(app: BaseApp) {
        super(app, "email", emailCapabilities);
        this.icon = "https://www.google.com/s2/favicons?domain=mail.google.com&sz=64";
    }

    /** 发送文本、HTML、内联图片、附件与线程回复。 */
    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const client = this.requireClient(uin);
        const recipients = parseRecipients(this.platformSource(params.scene_id));
        const compiled = compileEmailMessage(this.resolveReplyIds(params.message));
        const result = await client.sendEmail(
            createEmailSendOptions(
                recipients,
                client.config.default_subject || `来自 ${client.config.display_name || uin} 的消息`,
                compiled,
            ),
        );
        return { message_id: this.createId(result.message_id) };
    }

    /** 删除 IMAP 邮箱中的原始邮件；邮件协议不提供 SMTP 撤回。 */
    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const email = await this.findMessage(uin, params.message_id);
        await this.requireClient(uin).deleteEmails([email.uid], email.mailbox);
    }

    /** 按 RFC Message-ID 或可逆 IMAP 原生 ID 获取已接收邮件。 */
    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        return this.messageInfo(uin, await this.findMessage(uin, params.message_id));
    }

    /** 获取与一个或多个邮箱地址之间的最近邮件。 */
    async getMessageHistory(
        uin: string,
        params: Adapter.GetMessageHistoryParams,
    ): Promise<Adapter.MessageInfo[]> {
        const client = this.requireClient(uin);
        const recipients = parseRecipients(this.platformSource(params.scene_id));
        const query = { or: recipients.flatMap(address => [{ from: address }, { to: address }]) };
        const limit = Math.min(Math.max(params.limit || 50, 1), 500);
        const offset = Math.max(params.offset || 0, 0);
        const emails = await client.searchEmails(query, { limit: limit + offset });
        return emails.slice(offset, offset + limit).map(email => this.messageInfo(uin, email));
    }

    /** 将指定邮件标为已读。 */
    async markMessageAsRead(uin: string, params: Adapter.MarkMessageAsReadParams): Promise<void> {
        if (!params.message_id) {
            throw new EmailError("邮件 mark_message_as_read 需要 message_id", {
                code: "EMAIL_MESSAGE_ID_REQUIRED",
            });
        }
        const email = await this.findMessage(uin, params.message_id);
        await this.requireClient(uin).updateFlags([email.uid], ["\\Seen"], "add", email.mailbox);
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const config = this.requireClient(uin).config;
        return {
            user_id: this.createId(config.address),
            user_name: config.address,
            user_displayname: config.display_name || config.address,
        };
    }

    /** 邮件没有目录用户资料，按合法邮箱地址投影基础身份。 */
    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        this.requireClient(uin);
        const address = this.platformSource(params.user_id);
        parseRecipients(address);
        return {
            user_id: this.createId(address),
            user_name: address,
            user_displayname: address,
        };
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!EMAIL_PLATFORM_ACTIONS.has(action)) {
            return super.executePlatformAction(uin, action, params);
        }
        return executeEmailPlatformAction(this.requireClient(uin), action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return EMAIL_PLATFORM_ACTIONS.has(action);
    }

    async canSendImage(): Promise<boolean> {
        return true;
    }

    async canSendRecord(): Promise<boolean> {
        return false;
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        const [appVersion, nodemailerVersion, imapflowVersion] = await Promise.all([
            readPackageVersion(import.meta.url),
            readPackageVersion(import.meta.resolve("nodemailer")),
            readPackageVersion(import.meta.resolve("imapflow")),
        ]);
        return {
            app_name: "onebots Email Adapter",
            app_version: appVersion,
            impl: "nodemailer + imapflow",
            version: `nodemailer ${nodemailerVersion} / imapflow ${imapflowVersion}`,
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        const status = account?.client.status;
        return {
            online: account?.status === AccountStatus.Online && status?.started === true,
            good:
                status?.started === true &&
                (status.receive_mode === "manual" || status.receive_connected),
            bots: account
                ? [
                      {
                          self: this.createId(account.client.config.address),
                          online:
                              account.status === AccountStatus.Online && status?.started === true,
                      },
                  ]
                : [],
        };
    }

    /** 创建 SMTP 始终可用、IMAP 可选且能无限恢复的账号。 */
    createAccount(config: Account.Config<"email">): Account<"email", EmailClient> {
        const client = new EmailClient(config);
        const account = new Account<"email", EmailClient>(this, client, config);
        client.on("email", email => this.dispatchEmail(account, email));
        client.on("connected", () => {
            this.logger.info(`邮件账号 ${account.account_id} 的 IMAP 已连接`);
        });
        client.on("disconnected", error => {
            this.logger.warn(`邮件账号 ${account.account_id} 的 IMAP 暂时断开: ${error.message}`);
        });
        client.on("client_error", error => {
            this.logger.error(`邮件账号 ${account.account_id} 错误`, error);
        });
        account.on("start", async (signal: AbortSignal) => {
            try {
                await client.start(signal);
                account.status = AccountStatus.Online;
                account.nickname = config.display_name || config.address;
                account.avatar = "";
            } catch (error) {
                account.status = AccountStatus.OffLine;
                this.logger.error(`启动邮件账号 ${account.account_id} 失败`, error);
                throw error;
            }
        });
        account.on("stop", async () => {
            await client.stop();
            account.status = AccountStatus.OffLine;
        });
        return account;
    }

    private dispatchEmail(
        account: Account<"email", EmailClient>,
        email: EmailMessage,
    ): Promise<void> | undefined {
        if (email.from.address.toLowerCase() === account.client.config.address.toLowerCase())
            return;
        return account.dispatchAwaited(
            projectEmailEvent(email, {
                accountId: this.createId(account.client.config.address),
                ownAddress: account.client.config.address,
                createId: value => this.createId(value),
            }),
        );
    }

    private async findMessage(
        uin: string,
        value: CommonTypes.Id | string | number,
    ): Promise<EmailMessage> {
        return this.requireClient(uin).findEmail(this.platformSource(value));
    }

    private messageInfo(uin: string, email: EmailMessage): Adapter.MessageInfo {
        const client = this.requireClient(uin);
        const event = projectEmailEvent(email, {
            accountId: this.createId(client.config.address),
            ownAddress: client.config.address,
            createId: value => this.createId(value),
        });
        return toMessageInfo(email, event, client.config.address, value => this.createId(value));
    }

    private requireClient(uin: string): EmailClient {
        const account = this.getAccount(uin);
        if (!account) {
            throw new EmailError(`邮件账号 ${uin} 不存在`, { code: "EMAIL_ACCOUNT_NOT_FOUND" });
        }
        return account.client;
    }

    private platformSource(value: CommonTypes.Id | string | number): string {
        return String(this.coerceId(value).source);
    }

    private resolveReplyIds(message: readonly CommonTypes.Segment[]): CommonTypes.Segment[] {
        return message.map(segment => {
            if (segment.type !== "reply") return segment;
            const value = segment.data.message_id ?? segment.data.id;
            if (typeof value !== "string" && typeof value !== "number" && !isCommonId(value)) {
                return segment;
            }
            return {
                ...segment,
                data: { ...segment.data, message_id: this.platformSource(value) },
            };
        });
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommonId(value: unknown): value is CommonTypes.Id {
    return (
        isRecord(value) &&
        typeof value.string === "string" &&
        typeof value.number === "number" &&
        (typeof value.source === "string" || typeof value.source === "number")
    );
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            email: EmailConfig;
        }
    }
}

AdapterRegistry.register("email", EmailAdapter, {
    name: "email",
    displayName: "邮件适配器",
    description: "SMTP 发送、IMAP IDLE 接收与邮箱管理适配器",
    icon: "https://www.google.com/s2/favicons?domain=mail.google.com&sz=64",
    homepage: "https://en.wikipedia.org/wiki/Email",
    author: "凉菜",
    capabilities: emailCapabilities,
});
