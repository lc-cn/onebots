import { readFile } from "node:fs/promises";
import {
    Account,
    AccountStatus,
    Adapter,
    AdapterRegistry,
    BaseApp,
    type CommonTypes,
} from "onebots";
import { compileTeamsActivity } from "./activity.js";
import { TeamsBot } from "./bot.js";
import { teamsCapabilities } from "./capabilities.js";
import { TeamsConversationStore } from "./conversation-store.js";
import { TeamsApiError } from "./errors.js";
import { projectTeamsEvent, type TeamsProjectionKind } from "./events.js";
import { executeTeamsPlatformAction, TEAMS_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { TeamsConfig, TeamsEvent } from "./types.js";

export class TeamsAdapter extends Adapter<TeamsBot, "teams"> {
    private readonly conversationStore: TeamsConversationStore;

    constructor(app: BaseApp) {
        super(app, "teams", teamsCapabilities);
        this.icon = "https://teams.microsoft.com/favicon.ico";
        this.conversationStore = new TeamsConversationStore(this.db);
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const bot = this.requireBot(uin);
        const conversationId = this.coerceId(params.scene_id).string;
        const activity = this.compileActivity(params.message);
        const result = await bot.sendActivity(conversationId, activity);
        return { message_id: this.createId(result.id) };
    }

    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        const messageId = this.coerceId(params.message_id).string;
        const conversationId = this.requireMessageConversation(uin, messageId);
        await this.requireBot(uin).updateActivity(
            conversationId,
            messageId,
            this.compileActivity(params.message),
        );
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const messageId = this.coerceId(params.message_id).string;
        const conversationId = params.scene_id
            ? this.coerceId(params.scene_id).string
            : this.requireMessageConversation(uin, messageId);
        await this.requireBot(uin).deleteActivity(conversationId, messageId);
    }

    async getGroupList(uin: string): Promise<Adapter.GroupInfo[]> {
        return this.conversationStore
            .listReferences(uin)
            .filter(reference =>
                Boolean(
                    reference.conversation.isGroup ||
                    ["channel", "groupChat"].includes(
                        reference.conversation.conversationType || "",
                    ),
                ),
            )
            .map(reference => ({
                group_id: this.createId(reference.conversation.id),
                group_name: reference.conversation.name || reference.conversation.id,
            }));
    }

    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        const conversationId = this.coerceId(params.group_id).string;
        const reference = this.conversationStore.getReference(uin, conversationId);
        if (!reference)
            this.unsupported("get_group_info", "context_missing", "尚未收到该 Teams 会话事件");
        return {
            group_id: this.createId(conversationId),
            group_name: reference.conversation.name || conversationId,
        };
    }

    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const conversationId = this.coerceId(params.group_id).string;
        const members = await this.requireBot(uin).withConversation(conversationId, context =>
            context.client.conversations.getMembers(conversationId),
        );
        return members.map(member => this.toGroupMember(member, params.group_id));
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const conversationId = this.coerceId(params.group_id).string;
        const userId = this.resolveId(params.user_id).string;
        const member = await this.requireBot(uin).withConversation(conversationId, context =>
            context.client.conversations.getMemberById(conversationId, userId),
        );
        return this.toGroupMember(member, params.group_id);
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const me = this.requireBot(uin).getCachedMe();
        return {
            user_id: this.createId(me.id),
            user_name: me.name,
            user_displayname: me.name,
        };
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!TEAMS_PLATFORM_ACTIONS.has(action)) {
            return super.executePlatformAction(uin, action, params);
        }
        return executeTeamsPlatformAction(this.requireBot(uin), action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return TEAMS_PLATFORM_ACTIONS.has(action);
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        const version = await readPackageVersion(new URL("../package.json", import.meta.url));
        return {
            app_name: "onebots Microsoft Teams Adapter",
            app_version: version,
            impl: "microsoft-365-agents-sdk",
            version,
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const online = this.getAccount(uin)?.status === AccountStatus.Online;
        return { online, good: online };
    }

    createAccount(config: Account.Config<"teams">): Account<"teams", TeamsBot> {
        const teamsConfig: TeamsConfig = {
            account_id: config.account_id,
            app_id: config.app_id,
            app_password: config.app_password,
            tenant_id: config.tenant_id,
            authority_endpoint: config.authority_endpoint,
            graph_base_url: config.graph_base_url,
            graph_tenant_id: config.graph_tenant_id,
            bot_audience: config.bot_audience,
            allowed_service_urls: config.allowed_service_urls,
            validate_service_url: config.validate_service_url,
        };
        const accountId = config.account_id;
        const bot = new TeamsBot(teamsConfig, {
            get: conversationId => this.conversationStore.getReference(accountId, conversationId),
            list: () => this.conversationStore.listReferences(accountId),
            save: reference => this.conversationStore.saveReference(accountId, reference),
            saveMessage: (messageId, conversationId) =>
                this.conversationStore.saveMessageContext(accountId, messageId, conversationId),
        });
        const account = new Account<"teams", TeamsBot>(this, bot, config);
        this.app.router.post(`${account.path}/webhook`, bot.handleWebhook.bind(bot));
        this.bindLifecycle(account, bot);
        this.bindEvents(account, bot);
        return account;
    }

    private bindLifecycle(account: Account<"teams", TeamsBot>, bot: TeamsBot): void {
        bot.on("ready", () => {
            account.status = AccountStatus.Online;
            this.logger.info(`Teams Agent ${account.config.account_id} 已就绪`);
        });
        bot.on("error", (error: Error) => {
            // 单次 Webhook/API 错误不代表账号离线；Webhook 服务仍可继续接收下一事件。
            this.logger.error(`Teams Agent ${account.config.account_id} 错误`, error);
            this.emit("error", { account_id: account.config.account_id, error });
        });
        bot.on("stopped", () => {
            account.status = AccountStatus.OffLine;
        });
        account.on("start", async () => {
            try {
                await bot.start();
                account.status = AccountStatus.Online;
                const me = bot.getCachedMe();
                account.nickname = me.name;
                account.avatar = this.icon;
            } catch (error) {
                this.logger.error("启动 Teams Agent 失败", error);
                account.status = AccountStatus.OffLine;
            }
        });
        account.on("stop", async () => {
            await bot.stop();
            account.status = AccountStatus.OffLine;
        });
    }

    private bindEvents(account: Account<"teams", TeamsBot>, bot: TeamsBot): void {
        const routes: Array<[string, TeamsProjectionKind]> = [
            ["private_message", "private_message"],
            ["group_message", "group_message"],
            ["message_edited", "message_updated"],
            ["message_deleted", "message_deleted"],
            ["member_joined", "member_joined"],
            ["member_left", "member_left"],
            ["reaction_added", "reaction_added"],
            ["reaction_removed", "reaction_removed"],
        ];
        for (const [eventName, kind] of routes) {
            bot.on(eventName, (event: TeamsEvent) => this.dispatchTeamsEvent(account, kind, event));
        }
        bot.on("event", (event: TeamsEvent) => {
            const kind = event.activity.type === "invoke" ? "interaction" : "custom";
            this.dispatchTeamsEvent(account, kind, event);
        });
    }

    private dispatchTeamsEvent(
        account: Account<"teams", TeamsBot>,
        kind: TeamsProjectionKind,
        event: TeamsEvent,
    ): void {
        account.dispatch(
            projectTeamsEvent(kind, event, {
                botId: account.config.account_id,
                createId: value => this.createId(value),
            }),
        );
    }

    private compileActivity(message: CommonTypes.Segment[]) {
        return compileTeamsActivity(message, {
            resolveUserId: value => String(this.resolveId(value).source),
        });
    }

    private requireBot(uin: string): TeamsBot {
        const account = this.getAccount(uin);
        if (!account)
            throw new TeamsApiError(`Teams 账号 ${uin} 不存在`, { code: "ACCOUNT_NOT_FOUND" });
        return account.client;
    }

    private requireMessageConversation(uin: string, messageId: string): string {
        const conversationId = this.conversationStore.findConversationByMessage(uin, messageId);
        if (!conversationId) {
            throw new TeamsApiError(`未记录 Teams 消息 ${messageId} 所属会话`, {
                code: "TEAMS_MESSAGE_CONTEXT_MISSING",
            });
        }
        return conversationId;
    }

    private toGroupMember(
        member: { id?: string; name?: string; aadObjectId?: string; role?: string },
        groupId: CommonTypes.Id,
    ): Adapter.GroupMemberInfo {
        const id = member.id || member.aadObjectId || "";
        const role = member.role === "owner" || member.role === "admin" ? member.role : "member";
        return {
            group_id: groupId,
            user_id: this.createId(id),
            user_name: member.name || id,
            card: member.name,
            role,
        };
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
            teams: TeamsConfig;
        }
    }
}

AdapterRegistry.register("teams", TeamsAdapter, {
    name: "teams",
    displayName: "Microsoft Teams",
    description: "基于 Microsoft 365 Agents SDK 的 Teams 适配器",
    icon: "https://teams.microsoft.com/favicon.ico",
    homepage: "https://learn.microsoft.com/microsoft-365/agents-sdk/",
    author: "凉菜",
    capabilities: teamsCapabilities,
});
