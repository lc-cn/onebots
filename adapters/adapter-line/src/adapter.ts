import { randomUUID } from "node:crypto";
import type { webhook } from "@line/bot-sdk";
import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    ConnectionManager,
    RetryPresets,
    readPackageVersion,
    type CommonTypes,
} from "onebots";
import { LineBot } from "./bot.js";
import { lineCapabilities } from "./capabilities.js";
import { LineContextStore } from "./context-store.js";
import { listLineFollowerIds, listLineMemberProfiles } from "./directory.js";
import { LineApiError } from "./errors.js";
import { projectLineEvents } from "./events.js";
import { chunkLineMessages, compileLineMessages } from "./messages.js";
import { executeLinePlatformAction, LINE_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { LineChatContext, LineConfig } from "./types.js";

export class LineAdapter extends Adapter<LineBot, "line"> {
    private readonly contexts: LineContextStore;

    constructor(app: BaseApp) {
        super(app, "line", lineCapabilities);
        this.icon = "https://line.me/favicon.ico";
        this.contexts = new LineContextStore(this.db);
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const bot = this.requireBot(uin);
        const target = this.coerceId(params.scene_id).string;
        const chunks = chunkLineMessages(compileLineMessages(params.message));
        let firstMessageId: string | undefined;
        for (const messages of chunks) {
            const response = await bot.pushMessage(target, messages, { retryKey: randomUUID() });
            firstMessageId ||= response.sentMessages[0]?.id;
        }
        if (!firstMessageId) {
            throw new LineApiError("LINE 未返回已发送消息 ID", {
                code: "LINE_EMPTY_SEND_RESPONSE",
            });
        }
        return { message_id: this.createId(firstMessageId) };
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const info = await this.requireBot(uin).getBotInfo();
        return {
            user_id: this.createId(info.userId),
            user_name: info.basicId,
            user_displayname: info.displayName,
            avatar: info.pictureUrl,
        };
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const profile = await this.requireBot(uin).getClient().getProfile(params.user_id.string);
        return this.toUserInfo(profile);
    }

    async getFriendList(uin: string): Promise<Adapter.FriendInfo[]> {
        const client = this.requireBot(uin).getClient();
        const ids = await listLineFollowerIds(client);
        return ids.map(id => ({ user_id: this.createId(id), user_name: id }));
    }

    async getFriendInfo(
        uin: string,
        params: Adapter.GetFriendInfoParams,
    ): Promise<Adapter.FriendInfo> {
        const profile = await this.requireBot(uin).getClient().getProfile(params.user_id.string);
        return {
            user_id: this.createId(profile.userId),
            user_name: profile.displayName,
            remark: profile.statusMessage,
        };
    }

    async getGroupList(uin: string): Promise<Adapter.GroupInfo[]> {
        const bot = this.requireBot(uin);
        return Promise.all(
            this.contexts.list(uin).map(context => this.resolveGroupInfo(bot, uin, context)),
        );
    }

    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const id = params.group_id.string;
        const context = this.contexts.get(uin, id) || {
            id,
            type: id.startsWith("R") ? ("room" as const) : ("group" as const),
            updated_at: 0,
        };
        return this.resolveGroupInfo(this.requireBot(uin), uin, context);
    }

    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        const id = params.group_id.string;
        const client = this.requireBot(uin).getClient();
        const context = this.contexts.get(uin, id);
        if (context?.type === "room" || (!context && id.startsWith("R"))) {
            await client.leaveRoom(id);
        } else await client.leaveGroup(id);
        this.contexts.remove(uin, id);
    }

    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const id = params.group_id.string;
        const context = this.contexts.get(uin, id);
        const profiles = await listLineMemberProfiles(this.requireBot(uin).getClient(), {
            id,
            type: context?.type === "room" || (!context && id.startsWith("R")) ? "room" : "group",
        });
        return profiles.map(profile => this.toMemberInfo(params.group_id, profile));
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const id = params.group_id.string;
        const client = this.requireBot(uin).getClient();
        const profile =
            this.contexts.get(uin, id)?.type === "room" || id.startsWith("R")
                ? await client.getRoomMemberProfile(id, params.user_id.string)
                : await client.getGroupMemberProfile(id, params.user_id.string);
        return this.toMemberInfo(params.group_id, profile);
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!LINE_PLATFORM_ACTIONS.has(action)) {
            return super.executePlatformAction(uin, action, params);
        }
        return executeLinePlatformAction(this.requireBot(uin), action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return LINE_PLATFORM_ACTIONS.has(action);
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        const [appVersion, sdkVersion] = await Promise.all([
            readPackageVersion(import.meta.url),
            readPackageVersion(import.meta.resolve("@line/bot-sdk")),
        ]);
        return {
            app_name: "onebots LINE Adapter",
            app_version: appVersion,
            impl: "@line/bot-sdk",
            version: sdkVersion,
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        const online = account?.status === AccountStatus.Online;
        return {
            online,
            good: online,
            bots: account
                ? [{ self: this.createId(account.client.getBotUserId() || uin), online }]
                : [],
        };
    }

    async canSendImage(): Promise<boolean> {
        return true;
    }

    async canSendRecord(): Promise<boolean> {
        return true;
    }

    createAccount(config: Account.Config<"line">): Account<"line", LineBot> {
        const bot = new LineBot(
            {
                account_id: config.account_id,
                channel_access_token: config.channel_access_token,
                channel_secret: config.channel_secret,
                receive_mode: config.receive_mode,
                destination: config.destination,
                api_base_url: config.api_base_url,
                data_api_base_url: config.data_api_base_url,
                deduplicate_webhooks: config.deduplicate_webhooks,
                webhook_deduplication_limit: config.webhook_deduplication_limit,
            },
            {
                has: eventId => this.contexts.hasEvent(config.account_id, eventId),
                save: (eventId, limit) =>
                    this.contexts.saveEvent(config.account_id, eventId, limit),
            },
        );
        const account = new Account<"line", LineBot>(this, bot, config);
        if (bot.receiveMode === "webhook") {
            this.app.router.post(`${account.path}/webhook`, ctx => {
                const rawBody = (ctx.request as { rawBody?: unknown }).rawBody;
                const response = this.handleWebhook(bot, rawBody, ctx.get("x-line-signature"));
                ctx.status = response.status;
                ctx.body = response.body;
            });
        }
        bot.on("event", (event: webhook.Event) => this.dispatchEvent(account, event));
        this.bindLifecycle(account, bot);
        return account;
    }

    private handleWebhook(
        bot: LineBot,
        rawBody: unknown,
        signature: string,
    ): { status: number; body: unknown } {
        try {
            if (typeof rawBody !== "string" && !Buffer.isBuffer(rawBody)) {
                throw new LineApiError("LINE Webhook 必须保留未经修改的 rawBody", {
                    code: "LINE_RAW_BODY_REQUIRED",
                    status: 400,
                });
            }
            const result = bot.ingestHttp(rawBody, signature);
            return {
                status: 200,
                body: { ok: true, accepted: result.accepted, duplicate: result.duplicate },
            };
        } catch (error) {
            const wrapped = LineApiError.wrap(error, "LINE_WEBHOOK_ERROR");
            this.logger.error("LINE Webhook 处理失败", wrapped);
            return {
                status: wrapped.status || 500,
                body: { error: { code: wrapped.code, message: wrapped.message } },
            };
        }
    }

    private dispatchEvent(account: Account<"line", LineBot>, event: webhook.Event): void {
        this.captureChat(account.config.account_id, event);
        const projected = projectLineEvents(event, {
            botId: this.createId(account.client.getBotUserId() || account.config.account_id),
            createId: value => this.createId(value),
        });
        for (const item of projected) account.dispatch(item);
    }

    private captureChat(accountId: string, event: webhook.Event): void {
        const source = event.source;
        if (!source || source.type === "user") return;
        const id = source.type === "group" ? source.groupId : source.roomId;
        if (event.type === "leave") {
            this.contexts.remove(accountId, id);
            return;
        }
        this.contexts.save(accountId, {
            id,
            type: source.type,
        });
    }

    private bindLifecycle(account: Account<"line", LineBot>, bot: LineBot): void {
        let connectedInfo: Awaited<ReturnType<LineBot["getBotInfo"]>> | undefined;
        const manager = new ConnectionManager(
            async () => {
                connectedInfo = await bot.getBotInfo();
            },
            RetryPresets.websocket,
            {
                logger: this.logger,
                onConnected: () => {
                    if (!connectedInfo) return;
                    account.status = AccountStatus.Online;
                    account.nickname = connectedInfo.displayName;
                    account.avatar = connectedInfo.pictureUrl ?? "";
                    this.logger.info(`LINE Bot ${connectedInfo.displayName} 已就绪`);
                },
            },
        );
        account.on("start", async () => {
            account.status = AccountStatus.Pending;
            await manager.start();
        });
        account.on("stop", () => {
            manager.stop();
            account.status = AccountStatus.OffLine;
        });
    }

    private async resolveGroupInfo(
        bot: LineBot,
        accountId: string,
        context: LineChatContext,
    ): Promise<Adapter.GroupInfo> {
        const client = bot.getClient();
        if (context.type === "room") {
            const count = await client.getRoomMemberCount(context.id);
            return {
                group_id: this.createId(context.id),
                group_name: context.name || "LINE Room",
                member_count: count.count,
            };
        }
        const [summary, count] = await Promise.all([
            client.getGroupSummary(context.id),
            client.getGroupMemberCount(context.id),
        ]);
        this.contexts.save(accountId, {
            id: context.id,
            type: "group",
            name: summary.groupName,
        });
        return {
            group_id: this.createId(summary.groupId),
            group_name: summary.groupName,
            member_count: count.count,
        };
    }

    private toUserInfo(profile: {
        userId: string;
        displayName: string;
        pictureUrl?: string;
    }): Adapter.UserInfo {
        return {
            user_id: this.createId(profile.userId),
            user_name: profile.displayName,
            user_displayname: profile.displayName,
            avatar: profile.pictureUrl,
        };
    }

    private toMemberInfo(
        groupId: CommonTypes.Id,
        profile: { userId: string; displayName: string; pictureUrl?: string },
    ): Adapter.GroupMemberInfo {
        return {
            group_id: groupId,
            user_id: this.createId(profile.userId),
            user_name: profile.displayName,
            card: profile.displayName,
            role: "member",
        };
    }

    private requireBot(uin: string): LineBot {
        const account = this.getAccount(uin);
        if (!account) {
            throw new LineApiError(`LINE 账号 ${uin} 不存在`, { code: "ACCOUNT_NOT_FOUND" });
        }
        return account.client;
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            line: LineConfig;
        }
    }
}

AdapterRegistry.register("line", LineAdapter, {
    name: "line",
    displayName: "LINE Messaging API",
    description: "基于官方 Node SDK 的 LINE Messaging API 适配器",
    icon: "https://line.me/favicon.ico",
    homepage: "https://developers.line.biz/en/docs/messaging-api/",
    author: "凉菜",
    capabilities: lineCapabilities,
});
