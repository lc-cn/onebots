/** Microsoft Teams Agents SDK 适配器配置。 */
export interface TeamsConfig {
    account_id: string;
    /** 由 OneBots 挂载 Webhook，或由已有 Host 手动转交请求。 */
    receive_mode?: "webhook" | "manual";
    /** Webhook 模式挂载路径；默认使用账号标准路径。 */
    webhook_path?: string;
    /** Microsoft Entra 应用（Azure Bot）客户端 ID。 */
    app_id: string;
    /** 客户端密钥。 */
    app_password: string;
    /** 单租户应用必须填写；多租户应用可使用 organizations。 */
    tenant_id?: string;
    /** Entra 认证端点；主权云可覆盖。 */
    authority_endpoint?: string;
    /** Graph API 根地址；主权云可覆盖。 */
    graph_base_url?: string;
    /** Graph app-only token 使用的具体租户；多租户 Bot 与 Bot auth tenant 分离。 */
    graph_tenant_id?: string;
    /** Connector token audience；美国政府云使用 api.botframework.us。 */
    bot_audience?: string;
    /** 除微软内置 allowlist 外额外信任的 Connector service URL。 */
    allowed_service_urls?: Array<string | { url: string }>;
    /** 是否严格校验入站 token 中的 serviceUrl，生产环境默认开启。 */
    validate_service_url?: boolean;
}

/** 与具体 HTTP 框架无关的 Teams Activity 请求。 */
export interface TeamsHttpRequest {
    method?: string;
    headers?: Readonly<Record<string, unknown>>;
    body: unknown;
}

/** Microsoft Agents SDK 处理完成后的结构化 HTTP 响应。 */
export interface TeamsHttpResponse {
    status: number;
    headers: Readonly<Record<string, string>>;
    body?: unknown;
}

/** OneBots/Koa Host 所需的最小上下文接口。 */
export interface TeamsHttpContext {
    method: string;
    headers: Readonly<Record<string, unknown>>;
    request: { body?: unknown };
    status: number;
    body: unknown;
    set(name: string, value: string): unknown;
}

export interface TeamsUser {
    id: string;
    name: string;
    aadObjectId?: string;
    tenantId?: string;
    role?: string;
}

export interface TeamsConversation {
    id: string;
    name?: string;
    isGroup?: boolean;
    conversationType?: string;
    tenantId?: string;
}

export interface TeamsChannelDataTenant {
    id?: string;
    name?: string;
}

export interface TeamsChannelData {
    channel?: { id?: string; name?: string };
    team?: { id?: string; name?: string };
    tenant?: TeamsChannelDataTenant;
    meeting?: { id?: string };
    eventType?: string;
    [key: string]: unknown;
}

export interface TeamsEntity {
    type: string;
    mentioned?: TeamsUser;
    text?: string;
    [key: string]: unknown;
}

export interface TeamsAttachment {
    contentType: string;
    contentUrl?: string;
    content?: unknown;
    name?: string;
    thumbnailUrl?: string;
}

/** 无损保留协议关键字段的 Teams Activity 投影。 */
export interface TeamsActivity {
    type: string;
    id: string;
    timestamp: string;
    localTimestamp?: string;
    localTimezone?: string;
    serviceUrl?: string;
    channelId: string;
    from: TeamsUser;
    recipient?: TeamsUser;
    conversation: TeamsConversation;
    replyToId?: string;
    text?: string;
    textFormat?: string;
    locale?: string;
    inputHint?: string;
    importance?: string;
    deliveryMode?: string;
    name?: string;
    action?: string;
    summary?: string;
    attachmentLayout?: string;
    suggestedActions?: TeamsSuggestedActions;
    channelData?: TeamsChannelData;
    entities?: TeamsEntity[];
    attachments?: TeamsAttachment[];
    membersAdded?: TeamsUser[];
    membersRemoved?: TeamsUser[];
    reactionsAdded?: Array<{ type: string }>;
    reactionsRemoved?: Array<{ type: string }>;
    value?: unknown;
    relatesTo?: unknown;
    [key: string]: unknown;
}

export interface TeamsEvent {
    type: string;
    activity: TeamsActivity;
    /** Agents SDK 原始 Activity；用于访问尚未进入稳定投影的新字段。 */
    raw_activity: import("@microsoft/agents-activity").Activity;
}

/** 可序列化并跨重启恢复的 Agents SDK 会话引用。 */
export interface TeamsConversationReference {
    activityId?: string;
    user?: TeamsUser;
    locale?: string;
    agent?: TeamsUser | null;
    conversation: TeamsConversation & { id: string };
    channelId: string;
    serviceUrl?: string;
}

export interface TeamsOutboundActivity {
    text?: string;
    textFormat?: string;
    replyToId?: string;
    summary?: string;
    importance?: string;
    locale?: string;
    inputHint?: string;
    deliveryMode?: string;
    attachmentLayout?: string;
    suggestedActions?: TeamsSuggestedActions;
    value?: unknown;
    attachments?: TeamsAttachment[];
    entities?: TeamsEntity[];
    channelData?: Record<string, unknown>;
}

export interface TeamsSuggestedAction {
    type: string;
    title: string;
    image?: string;
    text?: string;
    displayText?: string;
    value?: unknown;
    channelData?: unknown;
    imageAltText?: string;
}

export interface TeamsSuggestedActions {
    to: string[];
    actions: TeamsSuggestedAction[];
}

export interface TeamsSendOptions {
    reply_to_message_id?: string;
}

export interface TeamsApiContext {
    conversation_id: string;
    service_url: string;
    team_id?: string;
    tenant_id?: string;
}

export interface TeamsChannel {
    id: string;
    name?: string;
    type?: "standard" | "private" | "shared";
    teamId?: string;
}

export type TeamsMessage = TeamsActivity;
