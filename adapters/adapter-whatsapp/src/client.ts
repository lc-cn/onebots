import { EventEmitter } from "node:events";
import { WhatsAppApiError } from "./errors.js";
import type {
    WhatsAppAPIResponse,
    WhatsAppCallOptions,
    WhatsAppClientEvents,
    WhatsAppConfig,
    WhatsAppIngestResult,
    WhatsAppMediaInfo,
    WhatsAppObservedContact,
    WhatsAppPhoneNumberInfo,
    WhatsAppSendMessageParams,
    WhatsAppWebhookEvent,
} from "./types.js";
import {
    acceptWhatsAppVerification,
    digestWhatsAppPayload,
    parseWhatsAppWebhook,
    parseWhatsAppWebhookBody,
    verifyWhatsAppSignature,
    whatsAppErrorResponse,
} from "./webhook.js";

const DEFAULT_API_BASE_URL = "https://graph.facebook.com";
const DEFAULT_DEDUPLICATION_LIMIT = 10_000;

/** WhatsApp Cloud API 客户端；保留通用 call 以覆盖 Graph API 新增能力。 */
export class WhatsAppClient extends EventEmitter<WhatsAppClientEvents> {
    readonly apiVersion: string;
    readonly apiBaseUrl: string;
    private readonly contacts = new Map<string, WhatsAppObservedContact>();
    private readonly processedEvents = new Set<string>();

    constructor(
        readonly config: WhatsAppConfig,
        private readonly fetcher: typeof fetch = fetch,
    ) {
        super();
        assertWhatsAppConfig(config);
        this.apiVersion = requireApiVersion(config.api_version);
        this.apiBaseUrl = requireHttpsBase(config.api_base_url || DEFAULT_API_BASE_URL);
    }

    async start(): Promise<WhatsAppPhoneNumberInfo> {
        const info = await this.getPhoneNumberInfo();
        this.emit("ready", info);
        return info;
    }

    stop(): void {
        this.emit("stop");
    }

    get receiveMode(): "webhook" | "manual" {
        return this.config.receive_mode || "webhook";
    }

    /** 最底层事件入口，供共享 Webhook Host、队列或其他可信连接复用。 */
    ingest(rawEvent: unknown, deduplicationKey?: string): WhatsAppIngestResult {
        const event = parseWhatsAppWebhook(rawEvent);
        const key = deduplicationKey || digestWhatsAppPayload(event);
        if (this.isDuplicate(key)) {
            return {
                accepted: 0,
                duplicate: true,
                changes: 0,
                messages: 0,
                statuses: 0,
                event,
            };
        }
        this.observeContacts(event);
        this.emit("raw_event", event);
        this.emit("webhook", event);
        let changes = 0;
        let messages = 0;
        let statuses = 0;
        for (const entry of event.entry) {
            for (const change of entry.changes) {
                this.emit("change", change, entry.id);
                changes += 1;
                for (const message of change.value.messages || []) {
                    this.emit("message", message, change.value.metadata, change);
                    messages += 1;
                }
                for (const status of change.value.statuses || []) {
                    this.emit("status", status, change.value.metadata, change);
                    statuses += 1;
                }
            }
        }
        this.markProcessed(key);
        return {
            accepted: messages + statuses,
            duplicate: false,
            changes,
            messages,
            statuses,
            event,
        };
    }

    /** 校验原始请求体签名，并交给与 manual 模式相同的 ingest 管线。 */
    ingestHttp(body: string | Buffer, signature?: string): WhatsAppIngestResult {
        const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
        verifyWhatsAppSignature(rawBody, signature, this.config.app_secret);
        return this.ingest(parseWhatsAppWebhookBody(rawBody), digestWhatsAppPayload(rawBody));
    }

    /** Fetch / WinterCG Host 可直接转交标准 Request，无需另开端口。 */
    async acceptHttp(request: Request): Promise<Response> {
        if (request.method === "GET") {
            return acceptWhatsAppVerification(request.url, this.config.webhook_verify_token);
        }
        if (request.method !== "POST") {
            return Response.json(
                { error: { code: "WHATSAPP_METHOD_NOT_ALLOWED", message: "Method Not Allowed" } },
                { status: 405, headers: { Allow: "GET, POST" } },
            );
        }
        try {
            const result = this.ingestHttp(
                Buffer.from(await request.arrayBuffer()),
                request.headers.get("x-hub-signature-256") || undefined,
            );
            return Response.json({
                ok: true,
                accepted: result.accepted,
                duplicate: result.duplicate,
                changes: result.changes,
            });
        } catch (error) {
            return whatsAppErrorResponse(WhatsAppApiError.wrap(error, "WHATSAPP_WEBHOOK_ERROR"));
        }
    }

    private isDuplicate(key: string): boolean {
        return this.config.deduplicate_webhooks !== false && this.processedEvents.has(key);
    }

    private markProcessed(key: string): void {
        if (this.config.deduplicate_webhooks === false) return;
        this.processedEvents.add(key);
        const limit = this.config.webhook_deduplication_limit || DEFAULT_DEDUPLICATION_LIMIT;
        while (this.processedEvents.size > limit) {
            const oldest = this.processedEvents.values().next().value;
            if (typeof oldest !== "string") break;
            this.processedEvents.delete(oldest);
        }
    }

    /** 返回 Webhook 中真实出现过的联系人；Cloud API 不支持任意号码资料查询。 */
    getObservedContact(userId: string): WhatsAppObservedContact | undefined {
        const contact = this.contacts.get(userId);
        return contact ? { ...contact } : undefined;
    }

    private observeContacts(event: WhatsAppWebhookEvent): void {
        for (const entry of event.entry) {
            for (const change of entry.changes) {
                for (const contact of change.value.contacts || []) {
                    this.contacts.set(contact.wa_id, {
                        id: contact.wa_id,
                        name: contact.profile.name || contact.wa_id,
                    });
                }
            }
        }
    }

    /** 调用任意经过路径约束的 Graph API 资源。 */
    async call<T = unknown>(options: WhatsAppCallOptions): Promise<T> {
        const url = this.resolveResource(options.resource, options.query);
        const headers = new Headers(options.headers);
        headers.set("Authorization", `Bearer ${this.config.access_token}`);
        let body: BodyInit | undefined;
        if (options.body instanceof FormData || typeof options.body === "string") {
            body = options.body;
        } else if (options.body !== undefined) {
            headers.set("Content-Type", "application/json");
            body = JSON.stringify(options.body);
        }
        let response: Response;
        try {
            response = await this.fetcher(url, {
                method: options.method || "GET",
                headers,
                body,
                signal: options.signal,
            });
        } catch (error) {
            throw new WhatsAppApiError("WhatsApp Graph API 网络请求失败", {
                code: "WHATSAPP_NETWORK_ERROR",
                resource: options.resource,
                cause: error,
            });
        }
        const payload = await parseResponse(response);
        if (!response.ok) throw graphError(response, payload, options.resource);
        return payload as T;
    }

    sendMessage(params: WhatsAppSendMessageParams): Promise<WhatsAppAPIResponse> {
        return this.call({
            method: "POST",
            resource: `${this.config.phone_number_id}/messages`,
            body: {
                ...params,
                messaging_product: "whatsapp",
                recipient_type: params.recipient_type || "individual",
            },
        });
    }

    markMessageRead(messageId: string, typingIndicator = false): Promise<unknown> {
        return this.call({
            method: "POST",
            resource: `${this.config.phone_number_id}/messages`,
            body: {
                messaging_product: "whatsapp",
                status: "read",
                message_id: requireString(messageId, "message_id"),
                ...(typingIndicator ? { typing_indicator: { type: "text" } } : {}),
            },
        });
    }

    getPhoneNumberInfo(): Promise<WhatsAppPhoneNumberInfo> {
        return this.call({
            resource: this.config.phone_number_id,
            query: {
                fields: "id,display_phone_number,verified_name,quality_rating,code_verification_status",
            },
        });
    }

    getBusinessProfile(
        fields = "about,address,description,email,profile_picture_url,websites,vertical",
    ): Promise<unknown> {
        return this.call({
            resource: `${this.config.phone_number_id}/whatsapp_business_profile`,
            query: { fields },
        });
    }

    updateBusinessProfile(profile: Readonly<Record<string, unknown>>): Promise<unknown> {
        return this.call({
            method: "POST",
            resource: `${this.config.phone_number_id}/whatsapp_business_profile`,
            body: { messaging_product: "whatsapp", ...profile },
        });
    }

    async uploadMedia(file: Blob, mimeType: string, filename = "upload"): Promise<{ id: string }> {
        const form = new FormData();
        form.set("messaging_product", "whatsapp");
        form.set("type", requireString(mimeType, "mime_type"));
        form.set("file", file, filename);
        return this.call({
            method: "POST",
            resource: `${this.config.phone_number_id}/media`,
            body: form,
        });
    }

    getMedia(mediaId: string): Promise<WhatsAppMediaInfo> {
        return this.call({ resource: requireString(mediaId, "media_id") });
    }

    async downloadMedia(mediaId: string, signal?: AbortSignal): Promise<Buffer> {
        return this.downloadMediaFrom(await this.getMedia(mediaId), signal);
    }

    /** 下载已经查询过临时 URL 的媒体，避免同一动作重复请求媒体元数据。 */
    async downloadMediaFrom(media: WhatsAppMediaInfo, signal?: AbortSignal): Promise<Buffer> {
        let response: Response;
        try {
            response = await this.fetcher(media.url, {
                headers: { Authorization: `Bearer ${this.config.access_token}` },
                signal,
            });
        } catch (error) {
            throw new WhatsAppApiError("WhatsApp 媒体下载请求失败", {
                code: "WHATSAPP_MEDIA_NETWORK_ERROR",
                resource: media.id,
                cause: error,
            });
        }
        if (!response.ok) {
            throw graphError(response, await parseResponse(response), media.id);
        }
        return Buffer.from(await response.arrayBuffer());
    }

    async deleteMedia(mediaId: string): Promise<void> {
        await this.call({ method: "DELETE", resource: requireString(mediaId, "media_id") });
    }

    private resolveResource(
        resource: string,
        query?: Readonly<Record<string, string | number | boolean | undefined>>,
    ): URL {
        const normalized = resource.replace(/\/+$/gu, "");
        if (!isSafeGraphResource(resource, normalized)) {
            throw new WhatsAppApiError("WhatsApp Graph API resource 必须是安全的相对路径", {
                code: "WHATSAPP_INVALID_RESOURCE",
                resource,
            });
        }
        const url = new URL(`${this.apiVersion}/${normalized}`, `${this.apiBaseUrl}/`);
        for (const [name, value] of Object.entries(query || {})) {
            if (value !== undefined) url.searchParams.set(name, String(value));
        }
        return url;
    }
}

function isSafeGraphResource(resource: string, normalized: string): boolean {
    if (
        !normalized ||
        resource.startsWith("/") ||
        resource.includes("?") ||
        resource.includes("#") ||
        resource.includes("\\") ||
        /[\u0000-\u001f\u007f]/u.test(resource) ||
        /^(?:https?|ftp):\/\//iu.test(resource)
    ) {
        return false;
    }
    try {
        return normalized.split("/").every(segment => {
            const decoded = decodeURIComponent(segment);
            return (
                decoded.length > 0 &&
                decoded !== "." &&
                decoded !== ".." &&
                !decoded.includes("/") &&
                !decoded.includes("\\") &&
                !decoded.includes("?") &&
                !decoded.includes("#") &&
                !/[\u0000-\u001f\u007f]/u.test(decoded)
            );
        });
    } catch {
        return false;
    }
}

async function parseResponse(response: Response): Promise<unknown> {
    if (response.status === 204) return undefined;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        try {
            return await response.json();
        } catch (error) {
            throw new WhatsAppApiError("WhatsApp Graph API 返回了无效 JSON", {
                code: "WHATSAPP_INVALID_RESPONSE",
                status: response.status,
                cause: error,
            });
        }
    }
    return response.text();
}

function graphError(response: Response, payload: unknown, resource: string): WhatsAppApiError {
    const record = asRecord(payload);
    const error = asRecord(record?.error);
    const message = typeof error?.message === "string" ? error.message : response.statusText;
    const code = typeof error?.code === "number" ? `WHATSAPP_${error.code}` : "WHATSAPP_HTTP_ERROR";
    return new WhatsAppApiError(message || `WhatsApp Graph API 返回 ${response.status}`, {
        code,
        status: response.status,
        resource,
        details: payload,
    });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function requireString(value: string, name: string): string {
    if (!value.trim()) {
        throw new WhatsAppApiError(`WhatsApp ${name} 不能为空`, {
            code: "WHATSAPP_INVALID_PARAMETER",
        });
    }
    return value;
}

function requireApiVersion(value: string): string {
    if (!/^v\d+\.\d+$/u.test(value)) {
        throw new WhatsAppApiError("WhatsApp api_version 必须使用 v数字.数字 格式", {
            code: "WHATSAPP_INVALID_API_VERSION",
            details: value,
        });
    }
    return value;
}

function requireHttpsBase(value: string): string {
    if (!URL.canParse(value)) {
        throw new WhatsAppApiError("WhatsApp api_base_url 必须是有效 HTTPS URL", {
            code: "WHATSAPP_INVALID_API_BASE_URL",
            details: value,
        });
    }
    const url = new URL(value);
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.pathname !== "/" && url.pathname !== "")
    ) {
        throw new WhatsAppApiError("WhatsApp api_base_url 必须是无凭据和路径语义的 HTTPS Origin", {
            code: "WHATSAPP_INVALID_API_BASE_URL",
            details: value,
        });
    }
    return url.origin;
}

function assertWhatsAppConfig(config: WhatsAppConfig): void {
    for (const [name, value] of [
        ["account_id", config.account_id],
        ["business_account_id", config.business_account_id],
        ["phone_number_id", config.phone_number_id],
        ["access_token", config.access_token],
    ] as const) {
        if (!value?.trim()) {
            throw new WhatsAppApiError(`WhatsApp ${name} 不能为空`, {
                code: "WHATSAPP_CONFIG_REQUIRED",
            });
        }
    }
    const receiveMode = config.receive_mode || "webhook";
    if (receiveMode !== "webhook" && receiveMode !== "manual") {
        throw new WhatsAppApiError("WhatsApp receive_mode 仅支持 webhook 或 manual", {
            code: "WHATSAPP_INVALID_RECEIVE_MODE",
        });
    }
    if (
        receiveMode === "webhook" &&
        (!config.app_secret?.trim() || !config.webhook_verify_token?.trim())
    ) {
        throw new WhatsAppApiError(
            "WhatsApp Webhook 模式必须配置 app_secret 和 webhook_verify_token",
            {
                code: "WHATSAPP_WEBHOOK_CONFIG_REQUIRED",
            },
        );
    }
    if (
        config.webhook_deduplication_limit !== undefined &&
        (!Number.isInteger(config.webhook_deduplication_limit) ||
            config.webhook_deduplication_limit < 100)
    ) {
        throw new WhatsAppApiError(
            "WhatsApp webhook_deduplication_limit 必须是大于等于 100 的整数",
            {
                code: "WHATSAPP_INVALID_DEDUPLICATION_LIMIT",
            },
        );
    }
}
