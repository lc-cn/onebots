import { EventEmitter } from "node:events";
import {
    AuthType,
    CloudAdapter,
    type ConnectorClient,
    OutboundHostValidator,
    type AuthConfiguration,
    type Request as AgentsRequest,
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
import {
    ErrorCategory,
    RecentEventDeduplicator,
    type MediaSourceInput,
    type Next,
    type RouterContext,
} from "onebots";
import { transformConversationReference, transformTeamsActivity } from "./activity-transform.js";
import {
    allowedServiceUrlHosts,
    acceptTeamsFetchRequest,
    applyTeamsHttpResponse,
    bodyValue,
    isTeamsFetchRequest,
    normalizeHeaders,
    requireHttpsConfigUrl,
    StructuredAgentsResponse,
} from "./bot-utils.js";
import { TeamsApiError, TeamsConversationReferenceError } from "./errors.js";
import { TeamsGraphClient, type TeamsGraphRequestOptions } from "./graph.js";
import { TeamsFileConsentManager, type TeamsFileConsentResult } from "./file-consent.js";
import type {
    TeamsConfig,
    TeamsConversationReference,
    TeamsEvent,
    TeamsHttpContext,
    TeamsHttpRequest,
    TeamsHttpResponse,
    TeamsUser,
} from "./types.js";

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
export interface TeamsBotEvents {
    ready: [];
    stopped: [];
    client_error: [error: TeamsApiError];
    raw_activity: [activity: Activity];
    private_message: [event: TeamsEvent];
    group_message: [event: TeamsEvent];
    message_edited: [event: TeamsEvent];
    message_deleted: [event: TeamsEvent];
    member_joined: [event: TeamsEvent];
    member_left: [event: TeamsEvent];
    reaction_added: [event: TeamsEvent];
    reaction_removed: [event: TeamsEvent];
    event: [event: TeamsEvent];
}

export class TeamsBot extends EventEmitter<TeamsBotEvents> {
    private readonly adapter: CloudAdapter;
    private readonly botAudience: string;
    private readonly graph: TeamsGraphClient;
    private readonly fileConsents: TeamsFileConsentManager;
    private me: TeamsUser;
    private running = false;
    private readonly receivedActivities = new RecentEventDeduplicator<string>();

    constructor(
        private readonly config: TeamsConfig,
        private readonly references: TeamsReferenceRepository,
    ) {
        super();
        this.botAudience = requireHttpsConfigUrl(
            config.bot_audience || "https://api.botframework.com",
            "bot_audience",
        );
        this.graph = new TeamsGraphClient(config);
        this.fileConsents = new TeamsFileConsentManager((conversationId, activity) =>
            this.sendActivity(conversationId, activity),
        );
        const authConfig: AuthConfiguration = {
            authType: AuthType.ClientSecret,
            clientId: config.app_id,
            clientSecret: config.app_password,
            tenantId: config.tenant_id || "botframework.com",
            authorityEndpoint: config.authority_endpoint
                ? requireHttpsConfigUrl(config.authority_endpoint, "authority_endpoint")
                : undefined,
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
            this.emit("client_error", TeamsApiError.wrap(error, "TEAMS_TURN_ERROR", "turn"));
        };
        this.me = { id: config.app_id, name: "Microsoft Teams Agent", role: "bot" };
    }

    async start(): Promise<void> {
        if (this.running) return;
        this.running = true;
        this.emit("ready");
    }

    async stop(): Promise<void> {
        if (!this.running) return;
        this.running = false;
        this.emit("stopped");
    }

    /** 由任意 HTTP Host 调用，完成 JWT 校验并返回宿主无关的结构化响应。 */
    async ingestHttp(input: TeamsHttpRequest): Promise<TeamsHttpResponse> {
        const response = new StructuredAgentsResponse();
        let processing: Promise<void> | undefined;
        try {
            const method = (input.method || "POST").toUpperCase();
            if (method !== "POST") {
                throw new TeamsApiError("Teams Activity 入口只接受 POST", {
                    code: "TEAMS_WEBHOOK_METHOD_NOT_ALLOWED",
                    category: ErrorCategory.VALIDATION,
                    status: 405,
                });
            }
            const request: AgentsRequest = {
                method,
                headers: normalizeHeaders(input.headers ?? {}),
                body: bodyValue(input.body),
            };
            await this.adapter.authorizeRequest(request, response, error => {
                if (error) throw error;
                processing = this.adapter.process(request, response, turnContext =>
                    this.handleTurn(turnContext),
                );
            });
            await processing;
        } catch (error) {
            const wrapped = TeamsApiError.wrap(error, "TEAMS_WEBHOOK_ERROR");
            this.emit("client_error", wrapped);
            if (!response.headersSent) {
                response
                    .status(
                        wrapped.status ||
                            (wrapped.category === ErrorCategory.VALIDATION ? 400 : 500),
                    )
                    .send({ error: { code: wrapped.code, message: wrapped.message } });
            }
        }
        return response.toResponse();
    }

    async acceptHttp(request: globalThis.Request): Promise<Response>;
    async acceptHttp(context: TeamsHttpContext): Promise<void>;
    /** 接入 Fetch Request 或 Koa Context，并复用同一认证与 Turn 管线。 */
    async acceptHttp(input: globalThis.Request | TeamsHttpContext): Promise<Response | void> {
        if (isTeamsFetchRequest(input)) {
            return acceptTeamsFetchRequest(
                input,
                request => this.ingestHttp(request),
                error => this.emit("client_error", error),
            );
        }
        applyTeamsHttpResponse(
            input,
            await this.ingestHttp({
                method: input.method,
                headers: input.headers,
                body: input.request.body,
            }),
        );
    }

    /** OneBots 路由入口；保留标准 Koa 中间件签名。 */
    async handleWebhook(context: RouterContext, _next: Next): Promise<void> {
        await this.acceptHttp(context);
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

    /** 完成由已认证 fileConsent/invoke 建立的一次性文件上传。 */
    completeFileConsentUpload(
        consentActivityId: string,
        source: MediaSourceInput,
    ): Promise<TeamsFileConsentResult> {
        return this.fileConsents.complete(consentActivityId, source);
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
                    this.captureReference(context.activity);
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
        return this.graph.baseUrl;
    }

    async callGraphApi(path: string, options: TeamsGraphRequestOptions): Promise<unknown> {
        return this.graph.call(path, options);
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

    /** 将已认证或既有 Agents SDK 连接中的 Activity 汇入统一事件管线。 */
    ingest(activity: Activity): TeamsEvent | undefined {
        this.captureReference(activity);
        this.emit("raw_activity", activity);
        if (activity.id && this.receivedActivities.has(activity.id)) return undefined;
        this.fileConsents.capture(activity);
        const transformed = transformTeamsActivity(activity);
        if (transformed.recipient?.id) this.me = transformed.recipient;
        const event: TeamsEvent = {
            type: activity.type,
            activity: transformed,
            raw_activity: activity,
        };

        if (activity.type === ActivityTypes.Message) {
            this.emit(isGroupActivity(transformed) ? "group_message" : "private_message", event);
        } else if (activity.type === ActivityTypes.MessageUpdate)
            this.emit("message_edited", event);
        else if (activity.type === ActivityTypes.MessageDelete) this.emit("message_deleted", event);
        else if (activity.type === ActivityTypes.ConversationUpdate) this.emitMembers(event);
        else if (activity.type === ActivityTypes.MessageReaction) this.emitReactions(event);
        else this.emit("event", event);
        if (activity.id) this.receivedActivities.commit(activity.id);
        return event;
    }

    private async handleTurn(context: TurnContext): Promise<void> {
        this.ingest(context.activity);
    }

    private captureReference(activity: Activity): void {
        const reference = transformConversationReference(activity.getConversationReference());
        this.references.save(reference);
        const activityId = activity.id;
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
        for (const reaction of event.activity.reactionsAdded || []) {
            this.emit("reaction_added", {
                ...event,
                activity: {
                    ...event.activity,
                    reactionsAdded: [reaction],
                    reactionsRemoved: [],
                },
            });
        }
        for (const reaction of event.activity.reactionsRemoved || []) {
            this.emit("reaction_removed", {
                ...event,
                activity: {
                    ...event.activity,
                    reactionsAdded: [],
                    reactionsRemoved: [reaction],
                },
            });
        }
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
        new URL(reference.serviceUrl).protocol !== "https:" ||
        new URL(reference.serviceUrl).username ||
        new URL(reference.serviceUrl).password
    ) {
        throw new TeamsApiError("Teams ConversationReference serviceUrl 必须是有效 HTTPS URL", {
            code: "TEAMS_INVALID_SERVICE_URL",
            details: reference.serviceUrl,
        });
    }
}
