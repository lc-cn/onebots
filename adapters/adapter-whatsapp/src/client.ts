import { EventEmitter } from "node:events";
import { emitAllAwaited, KeyedSingleFlight } from "onebots";
import { WhatsAppApiError } from "./errors.js";
import { deliverWhatsAppEvent } from "./event-delivery.js";
import { WhatsAppGraphApi } from "./graph-api.js";
import { WhatsAppGroups } from "./groups.js";
import { WhatsAppCalling } from "./calling.js";
import { WhatsAppHistory } from "./history.js";
import { WhatsAppSettings } from "./settings.js";
import { WhatsAppEncryptedMessages } from "./encrypted-messages.js";
import { WhatsAppPhoneNumbers } from "./phone-numbers.js";
import { WhatsAppBusinessEncryption } from "./business-encryption.js";
import {
    WhatsAppBusinessProfiles,
    type WhatsAppBusinessProfileField,
    type WhatsAppBusinessProfileResponse,
    type WhatsAppBusinessProfileUpdate,
    type WhatsAppBusinessProfileUpdateResponse,
} from "./business-profile.js";
import {
    WhatsAppBusinessCompliance,
    type WhatsAppBusinessComplianceField,
    type WhatsAppBusinessComplianceResponse,
    type WhatsAppBusinessComplianceUpdate,
    type WhatsAppBusinessComplianceUpdateResponse,
} from "./business-compliance.js";
import {
    WhatsAppSolutionMigration,
    type WhatsAppMigrationIntent,
    type WhatsAppMigrationIntentField,
    type WhatsAppSolutionMigrationRequest,
    type WhatsAppSolutionMigrationResponse,
} from "./solution-migration.js";
import {
    WhatsAppCommerce,
    type WhatsAppCommerceSettingsResponse,
    type WhatsAppCommerceSettingsUpdate,
    type WhatsAppCommerceSettingsUpdateResponse,
} from "./commerce.js";
import {
    WhatsAppQrCodes,
    type WhatsAppQrCodeCreate,
    type WhatsAppQrCodeDeleteResponse,
    type WhatsAppQrCodeFieldSelection,
    type WhatsAppQrCodeGetResponse,
    type WhatsAppQrCodeListQuery,
    type WhatsAppQrCodeListResponse,
    type WhatsAppQrCodeMutationResponse,
    type WhatsAppQrCodeUpdate,
} from "./qr-codes.js";
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
    /** 受控 Groups API 领域入口；与通用 call() 共用同一 Graph 传输。 */
    readonly groups: WhatsAppGroups;
    /** Calling API 控制平面；媒体协商与传输由调用方负责。 */
    readonly calling: WhatsAppCalling;
    /** 消息投递历史与 Webhook 更新状态查询。 */
    readonly history: WhatsAppHistory;
    /** 号码级 Calling、加密、身份变更与存储设置。 */
    readonly settings: WhatsAppSettings;
    /** 只承载 compact JWE 的 Payload Encryption 消息入口。 */
    readonly encryptedMessages: WhatsAppEncryptedMessages;
    /** 号码资料、注册、两步验证与所有权验证。 */
    readonly phoneNumbers: WhatsAppPhoneNumbers;
    /** Flow/data-channel Business Encryption 公钥与签名状态。 */
    readonly businessEncryption: WhatsAppBusinessEncryption;
    /** Business Profile 强类型读取与受控更新。 */
    readonly businessProfile: WhatsAppBusinessProfiles;
    /** Business Compliance 强类型读写与跨字段校验。 */
    readonly businessCompliance: WhatsAppBusinessCompliance;
    /** WABA Multi-Partner Solution 迁移意图控制面。 */
    readonly solutionMigration: WhatsAppSolutionMigration;
    /** Phone Number 级 Commerce 显示与购物车设置。 */
    readonly commerce: WhatsAppCommerce;
    /** Phone Number 级消息二维码增查改删与图片生成。 */
    readonly qrCodes: WhatsAppQrCodes;

    constructor(
        readonly config: WhatsAppConfig,
        fetcher: typeof fetch = fetch,
    ) {
        super();
        assertWhatsAppConfig(config);
        this.graph = new WhatsAppGraphApi(config, fetcher);
        this.groups = new WhatsAppGroups(this);
        this.calling = new WhatsAppCalling(this);
        this.history = new WhatsAppHistory(this);
        this.settings = new WhatsAppSettings(this);
        this.encryptedMessages = new WhatsAppEncryptedMessages(this);
        this.phoneNumbers = new WhatsAppPhoneNumbers(this);
        this.businessEncryption = new WhatsAppBusinessEncryption(this);
        this.businessProfile = new WhatsAppBusinessProfiles(this);
        this.businessCompliance = new WhatsAppBusinessCompliance(this);
        this.solutionMigration = new WhatsAppSolutionMigration(this);
        this.commerce = new WhatsAppCommerce(this);
        this.qrCodes = new WhatsAppQrCodes(this);
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
            info => emitAllAwaited(this, "ready", info),
        );
    }

    async stop(): Promise<void> {
        if (this.lifecycle.stop()) await emitAllAwaited(this, "stop");
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
        const { changes, messages, statuses, groupUpdates } = await deliverWhatsAppEvent(
            this,
            event,
        );
        this.markProcessed(key);
        return {
            accepted: messages + statuses + groupUpdates,
            duplicate: false,
            changes,
            messages,
            statuses,
            groupUpdates,
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
                    const id = contact.user_id || contact.wa_id;
                    if (!id) continue;
                    const observed = {
                        id,
                        name: contact.profile.name || contact.username || id,
                    };
                    for (const identity of [contact.user_id, contact.wa_id, contact.username]) {
                        if (identity) this.contacts.set(identity, observed);
                    }
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
        return this.phoneNumbers.getInfo();
    }

    getBusinessProfile(
        fields?: readonly WhatsAppBusinessProfileField[],
    ): Promise<WhatsAppBusinessProfileResponse> {
        return this.businessProfile.get(fields);
    }

    updateBusinessProfile(
        profile: WhatsAppBusinessProfileUpdate,
    ): Promise<WhatsAppBusinessProfileUpdateResponse> {
        return this.businessProfile.update(profile);
    }

    getBusinessComplianceInfo(
        fields?: readonly WhatsAppBusinessComplianceField[],
    ): Promise<WhatsAppBusinessComplianceResponse> {
        return this.businessCompliance.get(fields);
    }

    updateBusinessComplianceInfo(
        info: WhatsAppBusinessComplianceUpdate,
    ): Promise<WhatsAppBusinessComplianceUpdateResponse> {
        return this.businessCompliance.update(info);
    }

    getMigrationIntent(
        migrationIntentId: string,
        fields?: readonly WhatsAppMigrationIntentField[],
    ): Promise<WhatsAppMigrationIntent> {
        return this.solutionMigration.get(migrationIntentId, fields);
    }

    setSolutionMigrationIntent(
        request: WhatsAppSolutionMigrationRequest,
    ): Promise<WhatsAppSolutionMigrationResponse> {
        return this.solutionMigration.set(request);
    }

    getCommerceSettings(): Promise<WhatsAppCommerceSettingsResponse> {
        return this.commerce.get();
    }

    updateCommerceSettings(
        settings: WhatsAppCommerceSettingsUpdate,
    ): Promise<WhatsAppCommerceSettingsUpdateResponse> {
        return this.commerce.update(settings);
    }

    listQrCodes(query?: WhatsAppQrCodeListQuery): Promise<WhatsAppQrCodeListResponse> {
        return this.qrCodes.list(query);
    }

    getQrCode(
        code: string,
        selection?: WhatsAppQrCodeFieldSelection,
    ): Promise<WhatsAppQrCodeGetResponse> {
        return this.qrCodes.get(code, selection);
    }

    createQrCode(request: WhatsAppQrCodeCreate): Promise<WhatsAppQrCodeMutationResponse> {
        return this.qrCodes.create(request);
    }

    updateQrCode(request: WhatsAppQrCodeUpdate): Promise<WhatsAppQrCodeMutationResponse> {
        return this.qrCodes.update(request);
    }

    deleteQrCode(code: string): Promise<WhatsAppQrCodeDeleteResponse> {
        return this.qrCodes.delete(code);
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
        groupUpdates: 0,
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
