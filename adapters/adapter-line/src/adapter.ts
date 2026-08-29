import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { webhook } from "@line/bot-sdk";
import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    type CommonTypes,
} from "onebots";
import { LineBot } from "./bot.js";
import { lineCapabilities } from "./capabilities.js";
import { LineContextStore } from "./context-store.js";
import { LineApiError } from "./errors.js";
import { projectLineEvent } from "./events.js";
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

    async deleteMessage(): Promise<void> {
        this.unsupported(
            "delete_message",
            "platform_unsupported",
            "LINE 不支持机器人撤回已发送消息",
        );
    }

    async getMessage(): Promise<Adapter.MessageInfo> {
        return this.unsupported(
            "get_message",
            "platform_unsupported",
            "LINE 只允许按消息 ID 下载媒体内容，不提供消息查询接口",
        );
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
        const ids: string[] = [];
        let start: string | undefined;
        do {
            const page = await client.getFollowers(start, 1_000);
            ids.push(...page.userIds);
            start = page.next;
        } while (start);
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
        const client = this.requireBot(uin).getClient();
        const userIds: string[] = [];
        let start: string | undefined;
        do {
            const page =
                context?.type === "room" || (!context && id.startsWith("R"))
                    ? await client.getRoomMembersIds(id, start)
                    : await client.getGroupMembersIds(id, start);
            userIds.push(...page.memberIds);
            start = page.next;
        } while (start);
        return Promise.all(
            userIds.map(async userId => {
                const profile =
                    context?.type === "room" || (!context && id.startsWith("R"))
                        ? await client.getRoomMemberProfile(id, userId)
                        : await client.getGroupMemberProfile(id, userId);
                return this.toMemberInfo(params.group_id, profile);
            }),
        );
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
        const version = await readPackageVersion(new URL("../package.json", import.meta.url));
        return {
            app_name: "onebots LINE Adapter",
            app_version: version,
            impl: "@line/bot-sdk",
            version: "v2",
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

    createAccount(config: Account.Config<"line">): Account<"line", LineBot> {
        const bot = new LineBot(
            {
                account_id: config.account_id,
                channel_access_token: config.channel_access_token,
                channel_secret: config.channel_secret,
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
        this.app.router.post(`${account.path}/webhook`, ctx => {
            const rawBody = (ctx.request as { rawBody?: unknown }).rawBody;
            const response = this.handleWebhook(bot, rawBody, ctx.get("x-line-signature"));
            ctx.status = response.status;
            ctx.body = response.body;
        });
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
            bot.ingest(rawBody, signature);
            return { status: 200, body: { ok: true } };
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
        const projected = projectLineEvent(event, {
            botId: this.createId(account.config.account_id),
            createId: value => this.createId(value),
        });
        if (projected) account.dispatch(projected);
    }

    private captureChat(accountId: string, event: webhook.Event): void {
        const source = event.source;
        if (!source || source.type === "user") return;
        this.contexts.save(accountId, {
            id: source.type === "group" ? source.groupId : source.roomId,
            type: source.type,
        });
    }

    private bindLifecycle(account: Account<"line", LineBot>, bot: LineBot): void {
        account.on("start", async () => {
            try {
                const info = await bot.getBotInfo();
                account.status = AccountStatus.Online;
                account.nickname = info.displayName;
                account.avatar = info.pictureUrl;
                this.logger.info(`LINE Bot ${info.displayName} 已就绪`);
            } catch (error) {
                this.logger.error("启动 LINE Bot 失败", error);
                account.status = AccountStatus.OffLine;
            }
        });
        account.on("stop", () => {
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

async function readPackageVersion(url: URL): Promise<string> {
    const value = JSON.parse(await readFile(url, "utf8")) as { version?: unknown };
    if (typeof value.version !== "string") throw new Error(`package.json 缺少 version: ${url}`);
    return value.version;
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
