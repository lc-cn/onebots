import { EventEmitter } from "node:events";
import { emitAwaited, KeyedSingleFlight } from "onebots";
import { WhatsAppApiError } from "./errors.js";
import { WhatsAppGraphApi } from "./graph-api.js";
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
    WhatsAppVerifiedWebhook,
} from "./types.js";
import {
    acceptWhatsAppVerification,
    digestWhatsAppPayload,
    parseWhatsAppWebhook,
    parseWhatsAppWebhookBody,
    verifyWhatsAppSignature,
    whatsAppErrorResponse,
} from "./webhook.js";
import { WhatsAppClientLifecycle } from "./client-lifecycle.js";

const DEFAULT_DEDUPLICATION_LIMIT = 10_000;

/** WhatsApp Cloud API 客户端；保留通用 call 以覆盖 Graph API 新增能力。 */
export class WhatsAppClient extends EventEmitter<WhatsAppClientEvents> {
    private readonly graph: WhatsAppGraphApi;
    private readonly contacts = new Map<string, WhatsAppObservedContact>();
    private readonly processedEvents = new Set<string>();
    private readonly processingEvents = new KeyedSingleFlight<string, WhatsAppIngestResult>();
    private readonly lifecycle = new WhatsAppClientLifecycle<WhatsAppPhoneNumberInfo>();

    constructor(
        readonly config: WhatsAppConfig,
        fetcher: typeof fetch = fetch,
    ) {
        super();
        assertWhatsAppConfig(config);
        this.graph = new WhatsAppGraphApi(config, fetcher);
    }

    get apiVersion(): string {
        return this.graph.apiVersion;
    }

    get apiBaseUrl(): string {
        return this.graph.apiBaseUrl;
    }

    async start(): Promise<WhatsAppPhoneNumberInfo> {
        return this.lifecycle.start(
            () => this.getPhoneNumberInfo(),
            info => this.emit("ready", info),
        );
    }

    stop(): void {
        if (this.lifecycle.stop()) this.emit("stop");
    }

    get receiveMode(): "webhook" | "manual" {
        return this.config.receive_mode || "webhook";
    }

    /** 最底层事件入口，供共享 Webhook Host、队列或其他可信连接复用。 */
    async ingest(rawEvent: unknown, deduplicationKey?: string): Promise<WhatsAppIngestResult> {
        const event = parseWhatsAppWebhook(rawEvent);
        const key = deduplicationKey || digestWhatsAppPayload(event);
        if (this.isDuplicate(key)) {
            return duplicateResult(event);
        }
        return this.processingEvents.run(key, () => this.deliver(event, key));
    }

    private async deliver(event: WhatsAppWebhookEvent, key: string): Promise<WhatsAppIngestResult> {
        this.observeContacts(event);
        await emitAwaited(this, "raw_event", event);
        await emitAwaited(this, "webhook", event);
        let changes = 0;
        let messages = 0;
        let statuses = 0;
        for (const entry of event.entry) {
            for (const change of entry.changes) {
                await emitAwaited(this, "change", change, entry.id);
                changes += 1;
                for (const message of change.value.messages || []) {
                    await emitAwaited(this, "message", message, change.value.metadata, change);
                    messages += 1;
                }
                for (const status of change.value.statuses || []) {
                    await emitAwaited(this, "status", status, change.value.metadata, change);
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
            ignoredChanges: 0,
            event,
        };
    }

    /** 校验原始请求体签名，并交给与 manual 模式相同的 ingest 管线。 */
    async ingestHttp(body: string | Buffer, signature?: string): Promise<WhatsAppIngestResult> {
        const verified = this.verifyHttp(body, signature);
        return this.ingest(verified.event, verified.deduplicationKey);
    }

    /** 只完成签名与结构校验，供 Adapter 在一次验签后按号码分流。 */
    verifyHttp(body: string | Buffer, signature?: string): WhatsAppVerifiedWebhook {
        const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
        verifyWhatsAppSignature(rawBody, signature, this.config.app_secret);
        return {
            event: parseWhatsAppWebhookBody(rawBody),
            deduplicationKey: digestWhatsAppPayload(rawBody),
        };
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
            const result = await this.ingestHttp(
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
    call<T = unknown>(options: WhatsAppCallOptions): Promise<T> {
        return this.graph.call<T>(options);
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
        return this.graph.download(media.url, media.id, signal);
    }

    async deleteMedia(mediaId: string): Promise<void> {
        await this.call({ method: "DELETE", resource: requireString(mediaId, "media_id") });
    }
}

function duplicateResult(event: WhatsAppWebhookEvent): WhatsAppIngestResult {
    return {
        accepted: 0,
        duplicate: true,
        changes: 0,
        messages: 0,
        statuses: 0,
        ignoredChanges: 0,
        event,
    };
}

function requireString(value: string, name: string): string {
    if (!value.trim()) {
        throw new WhatsAppApiError(`WhatsApp ${name} 不能为空`, {
            code: "WHATSAPP_INVALID_PARAMETER",
        });
    }
    return value;
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
    for (const [name, value] of [
        ["business_account_id", config.business_account_id],
        ["phone_number_id", config.phone_number_id],
    ] as const) {
        if (!/^[A-Za-z\d._:-]+$/u.test(value)) {
            throw new WhatsAppApiError(`WhatsApp ${name} 必须是单段 Graph 资源 ID`, {
                code: "WHATSAPP_CONFIG_INVALID",
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
