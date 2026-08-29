import { EventEmitter } from "node:events";
import {
    AuthType,
    CloudAdapter,
    type ConnectorClient,
    OutboundHostValidator,
    type AuthConfiguration,
    type Request,
    type ResourceResponse,
    type TurnContext,
} from "@microsoft/agents-hosting";
import { Client as TeamsApiClient } from "@microsoft/teams.api";
import {
    Activity,
    ActivityTypes,
    type ConversationParameters,
    type ConversationReference,
} from "@microsoft/agents-activity";
import type { Next, RouterContext } from "onebots";
import { transformConversationReference, transformTeamsActivity } from "./activity-transform.js";
import {
    allowedServiceUrlHosts,
    bodyValue,
    graphErrorCode,
    graphTokenAuthority,
    KoaAgentsResponse,
    normalizeHeaders,
    recordString,
    recordValue,
    requireHttpsConfigUrl,
    responsePayload,
} from "./bot-utils.js";
import { TeamsApiError, TeamsConversationReferenceError } from "./errors.js";
import type { TeamsConfig, TeamsConversationReference, TeamsEvent, TeamsUser } from "./types.js";

export interface TeamsReferenceRepository {
    get(conversationId: string): TeamsConversationReference | undefined;
    list(): TeamsConversationReference[];
    save(reference: TeamsConversationReference): void;
    saveMessage(messageId: string, conversationId: string): void;
}

export interface TeamsContext {
    turn: TurnContext;
    client: TeamsApiClient;
}

/** 当前 Microsoft 365 Agents SDK 上的 Teams Connector 客户端。 */
export class TeamsBot extends EventEmitter {
    private readonly adapter: CloudAdapter;
    private readonly botAudience: string;
    private me: TeamsUser;
    private graphToken?: { value: string; expiresAt: number };

    constructor(
        private readonly config: TeamsConfig,
        private readonly references: TeamsReferenceRepository,
    ) {
        super();
        this.botAudience = requireHttpsConfigUrl(
            config.bot_audience || "https://api.botframework.com",
            "bot_audience",
        );
        const authConfig: AuthConfiguration = {
            authType: AuthType.ClientSecret,
            clientId: config.app_id,
            clientSecret: config.app_password,
            tenantId: config.tenant_id || "botframework.com",
            authorityEndpoint: config.authority_endpoint,
            scopes: [this.botAudience],
            validateIssuer: true,
        };
        this.adapter = new CloudAdapter(
            authConfig,
            undefined,
            undefined,
            { validateServiceUrl: config.validate_service_url !== false },
            new OutboundHostValidator({
                enabled: true,
                includeDefaultMicrosoftHosts: true,
                hosts: allowedServiceUrlHosts(config.allowed_service_urls),
            }),
        );
        this.adapter.onTurnError = async (_context, error) => {
            // 错误只交给网关日志/事件体系，不向最终用户注入隐藏消息。
            this.emit("error", TeamsApiError.wrap(error, "TEAMS_TURN_ERROR"));
        };
        this.me = { id: config.app_id, name: "Microsoft Teams Agent", role: "bot" };
    }

    async start(): Promise<void> {
        this.emit("ready");
    }

    async stop(): Promise<void> {
        this.emit("stopped");
    }

    /** 在 OneBots 的 Koa 路由中完成 JWT 校验并处理 Activity。 */
    async handleWebhook(ctx: RouterContext, _next: Next): Promise<void> {
        const request: Request = {
            method: ctx.method,
            headers: normalizeHeaders(ctx.headers),
            body: bodyValue(ctx.request.body),
        };
        const response = new KoaAgentsResponse(ctx);
        let processing: Promise<void> | undefined;
        try {
            await this.adapter.authorizeRequest(request, response, error => {
                if (error) throw error;
                processing = this.adapter.process(request, response, turnContext =>
                    this.handleTurn(turnContext),
                );
            });
            await processing;
        } catch (error) {
            const wrapped = TeamsApiError.wrap(error, "TEAMS_WEBHOOK_ERROR");
            this.emit("error", wrapped);
            if (!response.headersSent) {
                ctx.status = wrapped.status || 500;
                ctx.body = { error: { code: wrapped.code, message: wrapped.message } };
            }
        }
    }

    getCachedMe(): TeamsUser {
        return { ...this.me };
    }

    getConversationReference(conversationId: string): TeamsConversationReference | undefined {
        const reference = this.references.get(conversationId);
        return reference ? structuredClone(reference) : undefined;
    }

    listConversationReferences(): TeamsConversationReference[] {
        return this.references.list().map(reference => structuredClone(reference));
    }

    registerConversationReference(reference: TeamsConversationReference): void {
        validateReference(reference);
        this.references.save(structuredClone(reference));
    }

    async sendActivity(conversationId: string, activity: Activity): Promise<ResourceResponse> {
        return this.withConversation(conversationId, async context => {
            const response = await context.turn.sendActivity(activity);
            if (!response)
                throw new TeamsApiError("Teams 未返回消息资源", { code: "TEAMS_EMPTY_RESPONSE" });
            this.references.saveMessage(response.id, conversationId);
            return response;
        });
    }

    async updateActivity(
        conversationId: string,
        activityId: string,
        activity: Activity,
    ): Promise<void> {
        activity.id = activityId;
        await this.withConversation(conversationId, context =>
            context.turn.updateActivity(activity),
        );
    }

    async deleteActivity(conversationId: string, activityId: string): Promise<void> {
        await this.withConversation(conversationId, context =>
            context.turn.deleteActivity(activityId),
        );
    }

    /** 在恢复出的真实会话上下文中调用 Teams Connector、Graph 或发送接口。 */
    async withConversation<T>(
        conversationId: string,
        logic: (context: TeamsContext) => Promise<T>,
    ): Promise<T> {
        const reference = this.references.get(conversationId);
        if (!reference) throw new TeamsConversationReferenceError(conversationId);
        validateReference(reference);
        let result: T | undefined;
        try {
            await this.adapter.continueConversation(
                this.config.app_id,
                reference as ConversationReference,
                async turnContext => {
                    result = await logic(this.createTeamsContext(turnContext));
                },
            );
        } catch (error) {
            throw TeamsApiError.wrap(error);
        }
        return result as T;
    }

    async withAnyConversation<T>(logic: (context: TeamsContext) => Promise<T>): Promise<T> {
        const reference = this.references.list()[0];
        if (!reference) throw new TeamsConversationReferenceError("<任意已知会话>");
        return this.withConversation(reference.conversation.id, logic);
    }

    /** 创建首次主动私聊；成功后立即保存微软返回的真实会话引用。 */
    async createPersonalConversation(params: {
        service_url: string;
        tenant_id: string;
        aad_object_id: string;
        activity: Activity;
    }): Promise<TeamsConversationReference> {
        const conversation: ConversationParameters = {
            isGroup: false,
            agent: { id: this.config.app_id, name: this.me.name, role: "bot" },
            members: [{ aadObjectId: params.aad_object_id, tenantId: params.tenant_id }],
            tenantId: params.tenant_id,
            activity: params.activity,
            channelData: { tenant: { id: params.tenant_id } },
        };
        let result: TeamsConversationReference | undefined;
        try {
            await this.adapter.createConversationAsync(
                this.config.app_id,
                "msteams",
                params.service_url,
                this.botAudience,
                conversation,
                async context => {
                    this.captureReference(context);
                    const conversationId = context.activity.conversation?.id;
                    if (conversationId) result = this.references.get(conversationId);
                },
            );
            if (!result) {
                throw new TeamsApiError("Teams 创建会话后未返回 ConversationReference", {
                    code: "TEAMS_CREATE_CONVERSATION_EMPTY",
                });
            }
            return result;
        } catch (error) {
            throw TeamsApiError.wrap(error, "TEAMS_CREATE_CONVERSATION_ERROR");
        }
    }

    getGraphBaseUrl(): string {
        return this.config.graph_base_url || "https://graph.microsoft.com/v1.0";
    }

    async callGraphApi(
        path: string,
        options: {
            method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
            query?: Record<string, string | number | boolean>;
            body?: Record<string, unknown>;
        },
    ): Promise<unknown> {
        const token = await this.getGraphToken();
        const baseUrl = this.getGraphBaseUrl().replace(/\/$/u, "");
        const url = new URL(`${baseUrl}/${path.replace(/^\//u, "")}`);
        for (const [key, value] of Object.entries(options.query || {})) {
            url.searchParams.set(key, String(value));
        }
        const response = await fetch(url, {
            method: options.method,
            headers: {
                authorization: `Bearer ${token}`,
                ...(options.body ? { "content-type": "application/json" } : {}),
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
        });
        const payload = await responsePayload(response);
        if (!response.ok) {
            throw new TeamsApiError(`Microsoft Graph 请求失败: ${response.status}`, {
                code: graphErrorCode(payload),
                status: response.status,
                details: payload,
            });
        }
        return payload;
    }

    getAdapter(): CloudAdapter {
        return this.adapter;
    }

    private createTeamsContext(context: TurnContext): TeamsContext {
        const connector = context.turnState.get<ConnectorClient>(
            context.adapter.ConnectorClientKey,
        );
        const serviceUrl = context.activity.serviceUrl || connector?.httpClient.baseURL;
        if (!connector || !serviceUrl) {
            throw new TeamsApiError("Teams ConnectorClient 未初始化", {
                code: "TEAMS_CONNECTOR_CLIENT_MISSING",
            });
        }
        return {
            turn: context,
            client: new TeamsApiClient(serviceUrl, {
                headers: { ...connector.httpClient.defaultHeaders },
            }),
        };
    }

    private async getGraphToken(): Promise<string> {
        if (this.graphToken && this.graphToken.expiresAt > Date.now()) return this.graphToken.value;
        const tenantId = this.config.graph_tenant_id || this.config.tenant_id;
        if (!tenantId || ["botframework.com", "organizations", "common"].includes(tenantId)) {
            throw new TeamsApiError("Graph 应用凭据流必须配置具体 tenant_id，不能使用多租户别名", {
                code: "TEAMS_GRAPH_TENANT_REQUIRED",
            });
        }
        const authority = graphTokenAuthority(
            this.config.authority_endpoint || "https://login.microsoftonline.com",
            tenantId,
        );
        const scope = `${new URL(this.getGraphBaseUrl()).origin}/.default`;
        const body = new URLSearchParams({
            client_id: this.config.app_id,
            client_secret: this.config.app_password,
            grant_type: "client_credentials",
            scope,
        });
        const response = await fetch(`${authority}/oauth2/v2.0/token`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body,
        });
        const payload = await responsePayload(response);
        const accessToken = recordString(payload, "access_token");
        if (!response.ok || !accessToken) {
            throw new TeamsApiError("获取 Microsoft Graph access token 失败", {
                code: recordString(payload, "error") || "TEAMS_GRAPH_AUTH_ERROR",
                status: response.status,
                details: payload,
            });
        }
        const expiresIn = Number(recordValue(payload, "expires_in")) || 3600;
        this.graphToken = {
            value: accessToken,
            expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
        };
        return accessToken;
    }

    private async handleTurn(context: TurnContext): Promise<void> {
        this.captureReference(context);
        const activity = context.activity;
        const transformed = transformTeamsActivity(activity);
        if (transformed.recipient?.id) this.me = transformed.recipient;
        const event: TeamsEvent = { type: activity.type, activity: transformed };

        if (activity.type === ActivityTypes.Message) {
            this.emit(isGroupActivity(transformed) ? "group_message" : "private_message", event);
        } else if (activity.type === ActivityTypes.MessageUpdate)
            this.emit("message_edited", event);
        else if (activity.type === ActivityTypes.MessageDelete) this.emit("message_deleted", event);
        else if (activity.type === ActivityTypes.ConversationUpdate) this.emitMembers(event);
        else if (activity.type === ActivityTypes.MessageReaction) this.emitReactions(event);
        else this.emit("event", event);
    }

    private captureReference(context: TurnContext): void {
        const reference = transformConversationReference(
            context.activity.getConversationReference(),
        );
        this.references.save(reference);
        const activityId = context.activity.id;
        if (activityId) this.references.saveMessage(activityId, reference.conversation.id);
    }

    private emitMembers(event: TeamsEvent): void {
        for (const member of event.activity.membersAdded || []) {
            this.emit("member_joined", {
                ...event,
                activity: { ...event.activity, membersAdded: [member], membersRemoved: [] },
            });
        }
        for (const member of event.activity.membersRemoved || []) {
            this.emit("member_left", {
                ...event,
                activity: { ...event.activity, membersAdded: [], membersRemoved: [member] },
            });
        }
        if (!event.activity.membersAdded?.length && !event.activity.membersRemoved?.length) {
            this.emit("event", event);
        }
    }

    private emitReactions(event: TeamsEvent): void {
        if (event.activity.reactionsAdded?.length) this.emit("reaction_added", event);
        if (event.activity.reactionsRemoved?.length) this.emit("reaction_removed", event);
        if (!event.activity.reactionsAdded?.length && !event.activity.reactionsRemoved?.length) {
            this.emit("event", event);
        }
    }
}

function isGroupActivity(activity: TeamsEvent["activity"]): boolean {
    return Boolean(
        activity.conversation.isGroup ||
        ["channel", "groupChat"].includes(activity.conversation.conversationType || ""),
    );
}

function validateReference(reference: TeamsConversationReference): void {
    if (!reference.conversation?.id || !reference.channelId || !reference.serviceUrl) {
        throw new TeamsApiError(
            "Teams ConversationReference 缺少 conversation/channelId/serviceUrl",
            {
                code: "TEAMS_INVALID_CONVERSATION_REFERENCE",
                details: reference,
            },
        );
    }
    if (
        !URL.canParse(reference.serviceUrl) ||
        new URL(reference.serviceUrl).protocol !== "https:"
    ) {
        throw new TeamsApiError("Teams ConversationReference serviceUrl 必须是有效 HTTPS URL", {
            code: "TEAMS_INVALID_SERVICE_URL",
            details: reference.serviceUrl,
        });
    }
}
