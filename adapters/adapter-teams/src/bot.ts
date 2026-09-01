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
    emitAllAwaited,
    emitAwaited,
    type MediaSourceInput,
    type Next,
    type RouterContext,
} from "onebots";
import { transformConversationReference } from "./activity-transform.js";
import { TeamsActivityIngress, type TeamsActivityIngressResult } from "./activity-ingress.js";
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
import { TeamsInvokeResponder, type TeamsInvokeHandler } from "./invoke-response.js";
import { TeamsBotLifecycle } from "./lifecycle.js";
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
    private readonly activityIngress = new TeamsActivityIngress();
    private readonly invokeResponder = new TeamsInvokeResponder();
    private readonly lifecycle = new TeamsBotLifecycle(
        () => emitAllAwaited(this, "ready"),
        () => emitAllAwaited(this, "stopped"),
    );
    private me: TeamsUser;

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

    async start(signal?: AbortSignal): Promise<void> {
        await this.lifecycle.start(signal);
    }

    async stop(): Promise<void> {
        await this.lifecycle.stop();
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

    /** 注册当前 Turn 内生成 Invoke HTTP 响应的唯一处理器；传入 undefined 可恢复默认行为。 */
    setInvokeHandler(handler?: TeamsInvokeHandler): void {
        this.invokeResponder.setHandler(handler);
    }

    async sendActivity(conversationId: string, activity: Activity): Promise<ResourceResponse> {
        const response = await this.sendRawActivity(conversationId, activity);
        if (!response)
            throw new TeamsApiError("Teams 未返回消息资源", { code: "TEAMS_EMPTY_RESPONSE" });
        return response;
    }

    /**
     * 发送原生 Activity。流式消息的中间帧按微软约定可以返回空响应，因此与普通消息分离。
     */
    async sendRawActivity(
        conversationId: string,
        activity: Activity,
    ): Promise<ResourceResponse | undefined> {
        return this.withConversation(conversationId, async context => {
            const response = await context.turn.sendActivity(activity);
            if (response) this.references.saveMessage(response.id, conversationId);
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
    async ingest(activity: Activity): Promise<TeamsEvent | undefined> {
        const result = await this.ingestActivity(activity);
        return result.delivered ? result.event : undefined;
    }

    private async ingestActivity(activity: Activity): Promise<TeamsActivityIngressResult> {
        this.captureReference(activity);
        await emitAwaited(this, "raw_activity", activity);
        return this.activityIngress.ingest(activity, async (event, deliveries) => {
            this.fileConsents.capture(activity);
            if (event.activity.recipient?.id) this.me = event.activity.recipient;
            for (const delivery of deliveries) {
                await emitAwaited(this, delivery.channel, delivery.event);
            }
        });
    }

    private async handleTurn(context: TurnContext): Promise<void> {
        const result = await this.ingestActivity(context.activity);
        if (context.activity.type !== ActivityTypes.Invoke) return;
        const response = await this.invokeResponder.respond(result.event);
        if (!response) return;
        await context.sendActivity(
            Activity.fromObject({ type: ActivityTypes.InvokeResponse, value: response }),
        );
    }

    private captureReference(activity: Activity): void {
        const reference = transformConversationReference(activity.getConversationReference());
        validateReference(reference);
        this.references.save(reference);
        const activityId = activity.id;
        if (activityId) this.references.saveMessage(activityId, reference.conversation.id);
    }
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
