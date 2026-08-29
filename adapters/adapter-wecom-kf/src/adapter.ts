import { readFile } from "node:fs/promises";
import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    readPackageVersion,
} from "onebots";
import { weComKfCapabilities } from "./capabilities.js";
import { WeComKfClient } from "./client.js";
import { WeComKfError } from "./errors.js";
import { projectKfCallback, projectKfItem } from "./events.js";
import { assertKfUploadSize, decodeKfBase64 } from "./media.js";
import { compileKfMessages } from "./messages.js";
import { executeWeComKfPlatformAction, WECOM_KF_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { KfAccount, KfMsgItem, WeComKfConfig } from "./types.js";
import { WeComKfWebhookHost, type WeComKfHttpContext } from "./webhook-host.js";

/** 企业微信“微信客服”适配器。 */
export class WeComKfAdapter extends Adapter<WeComKfClient, "wecom-kf"> {
    private readonly userLastOpenKf = new Map<string, string>();

    constructor(app: BaseApp) {
        super(app, "wecom-kf", weComKfCapabilities);
        this.icon = "https://work.weixin.qq.com/favicon.ico";
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        if (params.scene_type !== "private" && params.scene_type !== "direct") {
            return this.unsupported(
                "send_message",
                "platform_unsupported",
                "微信客服只支持客户私聊会话",
            );
        }
        const client = this.requireClient(uin);
        const externalUserid = this.coerceId(params.scene_id).string;
        const openKfid =
            this.userLastOpenKf.get(this.contextKey(uin, externalUserid)) ||
            client.config.open_kfid;
        if (!openKfid)
            throw new WeComKfError("没有会话上下文且未配置 open_kfid", {
                code: "WECOM_KF_ACCOUNT_CONTEXT_REQUIRED",
            });
        let firstId: string | undefined;
        for (const message of compileKfMessages(params.message)) {
            const id = await client.sendMessage(externalUserid, openKfid, message);
            firstId ||= id;
        }
        if (!firstId)
            throw new WeComKfError("微信客服未生成消息 ID", {
                code: "WECOM_KF_EMPTY_SEND_RESPONSE",
            });
        return { message_id: this.createId(firstId) };
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const client = this.requireClient(uin);
        const account = await resolveLoginAccount(client);
        return {
            user_id: this.createId(account.open_kfid),
            user_name: account.name || account.open_kfid,
            user_displayname: account.name,
            avatar: account.avatar,
        };
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const externalUserid = params.user_id.string;
        const result = await this.requireClient(uin).customerBatchGet([externalUserid]);
        const customer = result.customer_list?.[0];
        if (!customer)
            throw new WeComKfError(`未找到微信客服客户 ${externalUserid}`, {
                code: "WECOM_KF_CUSTOMER_NOT_FOUND",
                details: result.invalid_external_userid,
            });
        return {
            user_id: this.createId(customer.external_userid),
            user_name: customer.nickname || customer.external_userid,
            user_displayname: customer.nickname,
            avatar: customer.avatar,
        };
    }

    async uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        const data = await loadUpload(params);
        const result = await this.requireClient(uin).uploadTemporaryMedia(
            "file",
            new Blob([Uint8Array.from(data.bytes)], { type: "application/octet-stream" }),
            data.filename,
        );
        return {
            file_id: this.createId(result.media_id),
            file_name: data.filename,
            file_size: data.bytes.length,
        };
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!WECOM_KF_PLATFORM_ACTIONS.has(action))
            return super.executePlatformAction(uin, action, params);
        return executeWeComKfPlatformAction(this.requireClient(uin), action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return WECOM_KF_PLATFORM_ACTIONS.has(action);
    }

    async canSendImage(): Promise<boolean> {
        return true;
    }

    async canSendRecord(): Promise<boolean> {
        return true;
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots WeCom Customer Service Adapter",
            app_version: await readPackageVersion(import.meta.url),
            impl: "WeCom Customer Service API",
            version: "v1",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        const online = account?.status === AccountStatus.Online;
        return {
            online,
            good: online,
            bots:
                account?.client
                    .getKnownOpenKfIds()
                    .map(openKfid => ({ self: this.createId(openKfid), online })) || [],
        };
    }

    createAccount(config: Account.Config<"wecom-kf">): Account<"wecom-kf", WeComKfClient> {
        const client = new WeComKfClient(normalizeConfig(config));
        const account = new Account<"wecom-kf", WeComKfClient>(this, client, config);
        client.on("kf_item", ({ open_kfid, item }: { open_kfid: string; item: KfMsgItem }) => {
            const externalUserId =
                item.external_userid || stringField(item.event, "external_userid");
            const eventOpenKfId = stringField(item.event, "open_kfid");
            if (externalUserId) {
                this.userLastOpenKf.set(
                    this.contextKey(account.account_id, externalUserId),
                    item.open_kfid || eventOpenKfId || open_kfid,
                );
            }
            account.dispatch(
                projectKfItem(item, {
                    botId: account.account_id,
                    openKfId: open_kfid,
                    createId: value => this.createId(value),
                }),
            );
        });
        client.on("callback", event => {
            account.dispatch(
                projectKfCallback(event, {
                    botId: account.account_id,
                    createId: value => this.createId(value),
                }),
            );
        });
        client.on("client_error", error => this.logger.error("微信客服客户端错误", error));
        if (client.receiveMode === "webhook") {
            const webhook = new WeComKfWebhookHost(client.config, client, error =>
                this.logger.error("微信客服 Webhook 处理失败", error),
            );
            this.app.router.all(webhook.path, ctx =>
                webhook.acceptHttp(ctx as unknown as WeComKfHttpContext),
            );
        }
        account.on("start", async () => {
            try {
                await client.start();
                account.status = AccountStatus.Online;
                account.nickname = "微信客服";
                account.avatar = this.icon;
                this.logger.info(`微信客服账号 ${config.account_id} 已启动`);
            } catch (error) {
                account.status = AccountStatus.OffLine;
                this.logger.error("启动微信客服失败", error);
            }
        });
        account.on("stop", () => {
            client.stop();
            account.status = AccountStatus.OffLine;
        });
        return account;
    }

    private requireClient(uin: string): WeComKfClient {
        const account = this.getAccount(uin);
        if (!account)
            throw new WeComKfError(`微信客服账号 ${uin} 不存在`, {
                code: "ACCOUNT_NOT_FOUND",
            });
        return account.client;
    }

    private contextKey(accountId: string, externalUserid: string): string {
        return `${accountId}\0${externalUserid}`;
    }
}

async function resolveLoginAccount(client: WeComKfClient): Promise<KfAccount> {
    if (client.config.open_kfid) return client.getAccount(client.config.open_kfid);
    const known = client.getKnownOpenKfIds();
    if (known.length === 1) return client.getAccount(known[0]!);
    const accounts = await client.listAccounts();
    if (accounts.length === 1) return accounts[0]!;
    throw new WeComKfError("get_login_info 需要唯一客服账号，请配置 open_kfid", {
        code: "WECOM_KF_ACCOUNT_CONTEXT_REQUIRED",
        details: { account_count: accounts.length },
    });
}

function stringField(
    value: Readonly<Record<string, unknown>> | undefined,
    key: string,
): string | undefined {
    const field = value?.[key];
    return typeof field === "string" && field ? field : undefined;
}

function normalizeConfig(config: Account.Config<"wecom-kf">): WeComKfConfig {
    return {
        account_id: config.account_id,
        corp_id: config.corp_id,
        corp_secret: config.corp_secret,
        receive_mode: config.receive_mode,
        token: config.token,
        encoding_aes_key: config.encoding_aes_key,
        open_kfid: config.open_kfid,
        webhook_path: config.webhook_path,
        enable_sync_poll: config.enable_sync_poll,
        sync_poll_interval_ms: config.sync_poll_interval_ms,
        cursor_store_path: config.cursor_store_path,
        deduplicate_messages: config.deduplicate_messages,
        message_deduplication_limit: config.message_deduplication_limit,
        api_base_url: config.api_base_url,
    };
}

async function loadUpload(params: Adapter.UploadFileParams): Promise<{
    bytes: Buffer;
    filename: string;
}> {
    let bytes: Buffer;
    if (params.data) {
        bytes = decodeKfBase64(params.data, "upload_file.data");
    } else if (params.path) {
        try {
            bytes = await readFile(params.path);
        } catch (error) {
            throw new WeComKfError(`读取上传文件失败：${params.path}`, {
                code: "WECOM_KF_UPLOAD_READ_ERROR",
                cause: error,
            });
        }
    } else if (params.url) {
        if (!URL.canParse(params.url))
            throw new WeComKfError("upload_file.url 必须是有效 HTTPS URL", {
                code: "WECOM_KF_INVALID_UPLOAD_URL",
            });
        const url = new URL(params.url);
        if (url.protocol !== "https:" || url.username || url.password)
            throw new WeComKfError("upload_file.url 必须是无凭据 HTTPS URL", {
                code: "WECOM_KF_INVALID_UPLOAD_URL",
            });
        let response: Response;
        try {
            response = await fetch(url, { redirect: "error" });
        } catch (error) {
            throw new WeComKfError("下载上传文件失败", {
                code: "WECOM_KF_UPLOAD_DOWNLOAD_ERROR",
                cause: error,
            });
        }
        if (!response.ok)
            throw new WeComKfError(`下载上传文件失败: HTTP ${response.status}`, {
                code: "WECOM_KF_UPLOAD_DOWNLOAD_ERROR",
                status: response.status,
            });
        bytes = Buffer.from(await response.arrayBuffer());
    } else {
        throw new WeComKfError("upload_file 需要 data、path 或 url", {
            code: "WECOM_KF_INVALID_UPLOAD",
        });
    }
    assertKfUploadSize(bytes.length);
    return { bytes, filename: params.name || "upload.bin" };
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            "wecom-kf": WeComKfConfig;
        }
    }
}

AdapterRegistry.register("wecom-kf", WeComKfAdapter, {
    name: "wecom-kf",
    displayName: "企业微信·微信客服",
    description: "微信客服官方 API：客服账号、会话分配、sync_msg 与消息收发",
    icon: "https://work.weixin.qq.com/favicon.ico",
    homepage: "https://developer.work.weixin.qq.com/document/path/94638",
    author: "凉菜",
    capabilities: weComKfCapabilities,
});
