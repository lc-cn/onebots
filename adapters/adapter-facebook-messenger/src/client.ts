import { EventEmitter } from "node:events";
import { MetaGraphTransport, MetaWebhookClient, type MetaWebhookDelivery } from "@onebots/meta";
import { emitAllAwaited } from "onebots";
import {
    parseAttachmentId,
    parseConversation,
    parseConversationList,
    parsePageProfile,
    parseSendResponse,
    parseUserProfile,
} from "./entities.js";
import { FacebookMessengerError } from "./errors.js";
import type {
    FacebookMessengerCallOptions,
    FacebookMessengerClientEvents,
    FacebookMessengerConfig,
    FacebookMessengerDelivery,
    FacebookMessengerGraphMethod,
    FacebookMessengerHttpRequest,
    FacebookMessengerHttpResponse,
    FacebookMessengerIngestResult,
    MessengerConversation,
    MessengerOutgoingMessage,
    MessengerPageProfile,
    MessengerSendResponse,
    MessengerUserProfile,
} from "./types.js";
import { assertFacebookMessengerConfig, assertMetaId, assertNumericMetaId } from "./validation.js";
import { FacebookMessengerWebhookCodec } from "./webhook-codec.js";

export interface FacebookMessengerClientDependencies {
    fetcher?: typeof fetch;
    reportError?(error: Error): void;
}

/** Graph API 与 Webhook/manual ingress 共用的可嵌入 Messenger Client。 */
export class FacebookMessengerClient extends EventEmitter<FacebookMessengerClientEvents> {
    private readonly transport: MetaGraphTransport;
    private readonly webhook: MetaWebhookClient<
        FacebookMessengerDelivery["event"],
        FacebookMessengerDelivery["rawEnvelope"]
    >;
    private page?: MessengerPageProfile;
    private startTask?: Promise<void>;
    private startAbort?: AbortController;
    private startSignal?: AbortSignal;
    private startSignalAbort?: () => void;
    private generation = 0;
    private started = false;

    constructor(
        readonly config: FacebookMessengerConfig,
        private readonly dependencies: FacebookMessengerClientDependencies = {},
    ) {
        super();
        assertFacebookMessengerConfig(config);
        this.transport = new MetaGraphTransport(
            {
                accessToken: config.page_access_token,
                appSecret: config.app_secret,
                apiOrigin: config.api_origin,
                apiVersion: config.api_version,
            },
            dependencies.fetcher,
        );
        this.webhook = new MetaWebhookClient(
            {
                receiveMode: config.receive_mode || "webhook",
                verifyToken: config.verify_token,
                appSecret: config.app_secret,
                httpPath: config.http_path,
                maxBodyBytes: config.max_body_bytes,
            },
            new FacebookMessengerWebhookCodec(config.page_id, config.event_types),
            { reportError: error => this.reportError(error) },
        );
        this.webhook.on("event", delivery => this.forward(delivery));
        this.webhook.on("ready", () => emitAllAwaited(this, "ready"));
        this.webhook.on("stop", () => emitAllAwaited(this, "stop"));
    }

    get receiveMode(): "webhook" | "manual" {
        return this.config.receive_mode || "webhook";
    }

    get isStarted(): boolean {
        return this.started;
    }

    get pageProfile(): MessengerPageProfile | undefined {
        return this.page ? structuredClone(this.page) : undefined;
    }

    async start(signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        if (this.started) return;
        if (this.startTask) return this.startTask;
        this.bindStartSignal(signal);
        const generation = ++this.generation;
        const controller = new AbortController();
        this.startAbort = controller;
        const task = this.startInternal(generation, controller.signal);
        this.startTask = task;
        try {
            await task;
        } finally {
            if (this.startTask === task) this.startTask = undefined;
            if (this.startAbort === controller) this.startAbort = undefined;
            if (!this.started) this.unbindStartSignal();
        }
    }

    async stop(): Promise<void> {
        this.unbindStartSignal();
        ++this.generation;
        this.startAbort?.abort();
        await this.startTask?.catch(() => undefined);
        this.started = false;
        await this.webhook.stop();
    }

    private bindStartSignal(signal?: AbortSignal): void {
        this.unbindStartSignal();
        if (!signal) return;
        const abort = () => {
            void this.stop().catch(error =>
                this.reportError(
                    FacebookMessengerError.wrap(error, "FACEBOOK_MESSENGER_STOP_FAILED"),
                ),
            );
        };
        this.startSignal = signal;
        this.startSignalAbort = abort;
        signal.addEventListener("abort", abort, { once: true });
    }

    private unbindStartSignal(): void {
        if (this.startSignal && this.startSignalAbort) {
            this.startSignal.removeEventListener("abort", this.startSignalAbort);
        }
        this.startSignal = undefined;
        this.startSignalAbort = undefined;
    }

    call<T = unknown>(
        method: FacebookMessengerGraphMethod,
        path: string,
        options?: FacebookMessengerCallOptions,
    ): Promise<T> {
        return this.transport.call<T>(method, path, options);
    }

    ingest(rawEvent: unknown): Promise<FacebookMessengerIngestResult[]> {
        return this.webhook.ingest(rawEvent);
    }

    ingestHttp(request: FacebookMessengerHttpRequest): Promise<FacebookMessengerHttpResponse> {
        return this.webhook.ingestHttp(request);
    }

    acceptHttp(request: Request): Promise<Response> {
        return this.webhook.acceptHttp(request);
    }

    async send(
        recipientId: string,
        message: MessengerOutgoingMessage,
        options: {
            messagingType?: "RESPONSE" | "UPDATE" | "MESSAGE_TAG" | "UTILITY";
            tag?: string;
            notificationType?: "REGULAR" | "SILENT_PUSH" | "NO_PUSH";
        } = {},
    ): Promise<MessengerSendResponse> {
        assertNumericMetaId(recipientId, "recipient_id");
        const messagingType =
            options.messagingType || this.config.default_messaging_type || "RESPONSE";
        const tag = options.tag || this.config.default_message_tag;
        if (messagingType === "MESSAGE_TAG" && !tag) {
            throw FacebookMessengerError.invalid("MESSAGE_TAG 发送必须提供 tag");
        }
        return parseSendResponse(
            await this.call("POST", `/${this.config.page_id}/messages`, {
                body: {
                    recipient: { id: recipientId },
                    messaging_type: messagingType,
                    ...(tag ? { tag } : {}),
                    ...(options.notificationType
                        ? { notification_type: options.notificationType }
                        : {}),
                    message,
                },
            }),
        );
    }

    async senderAction(
        recipientId: string,
        action: "mark_seen" | "typing_on" | "typing_off",
    ): Promise<MessengerSendResponse> {
        assertNumericMetaId(recipientId, "recipient_id");
        return parseSendResponse(
            await this.call("POST", `/${this.config.page_id}/messages`, {
                body: { recipient: { id: recipientId }, sender_action: action },
            }),
        );
    }

    async uploadAttachment(
        type: "image" | "video" | "audio" | "file",
        source: { url: string } | { blob: Blob; filename: string },
        reusable = true,
    ): Promise<string> {
        let response: unknown;
        if ("url" in source) {
            if (!URL.canParse(source.url)) {
                throw FacebookMessengerError.invalid("Messenger attachment URL 无效");
            }
            const url = new URL(source.url);
            if (url.protocol !== "https:" || url.username || url.password) {
                throw FacebookMessengerError.invalid(
                    "Messenger attachment URL 必须是无凭据 HTTPS URL",
                );
            }
            response = await this.call("POST", `/${this.config.page_id}/message_attachments`, {
                body: {
                    message: {
                        attachment: {
                            type,
                            payload: { url: url.toString(), is_reusable: reusable },
                        },
                    },
                },
            });
        } else {
            const form = new FormData();
            form.set(
                "message",
                JSON.stringify({ attachment: { type, payload: { is_reusable: reusable } } }),
            );
            form.set("filedata", source.blob, source.filename);
            response = await this.call("POST", `/${this.config.page_id}/message_attachments`, {
                form,
            });
        }
        return parseAttachmentId(response);
    }

    async getUserProfile(userId: string): Promise<MessengerUserProfile> {
        assertNumericMetaId(userId, "user_id");
        return parseUserProfile(
            await this.call("GET", `/${userId}`, {
                query: {
                    fields: "id,first_name,last_name,name,profile_pic,locale,timezone,gender",
                },
            }),
        );
    }

    async listConversations(
        after?: string,
        limit = 25,
    ): Promise<ReturnType<typeof parseConversationList>> {
        return parseConversationList(
            await this.call("GET", `/${this.config.page_id}/conversations`, {
                query: {
                    fields: "id,link,updated_time,message_count,participants",
                    limit: boundedLimit(limit),
                    after,
                },
            }),
        );
    }

    async findConversation(userId: string): Promise<MessengerConversation | undefined> {
        assertNumericMetaId(userId, "user_id");
        const result = parseConversationList(
            await this.call("GET", `/${this.config.page_id}/conversations`, {
                query: {
                    user_id: userId,
                    fields: "id,link,updated_time,message_count,participants",
                },
            }),
        );
        if (result.data.length > 1) {
            throw new FacebookMessengerError("Conversations API 对单个 PSID 返回了多个会话", {
                code: "FACEBOOK_MESSENGER_AMBIGUOUS_CONVERSATION",
                details: { user_id: userId, count: result.data.length },
            });
        }
        return result.data[0];
    }

    async getConversation(conversationId: string, limit = 25): Promise<MessengerConversation> {
        assertMetaId(conversationId, "conversation_id");
        return parseConversation(
            await this.call("GET", `/${conversationId}`, {
                query: {
                    fields: `id,link,updated_time,message_count,participants,messages.limit(${boundedLimit(limit)}){id,created_time,from,to,message,attachments,reply_to}`,
                },
            }),
        );
    }

    private async startInternal(generation: number, signal: AbortSignal): Promise<void> {
        const page = parsePageProfile(
            await this.call("GET", `/${this.config.page_id}`, {
                query: { fields: "id,name,picture" },
                signal,
            }),
        );
        if (page.id !== this.config.page_id) {
            throw new FacebookMessengerError("Page access token 返回了不同的 Page ID", {
                code: "FACEBOOK_MESSENGER_PAGE_ID_MISMATCH",
                details: { expected: this.config.page_id, actual: page.id },
            });
        }
        if (this.config.auto_subscribe) await this.subscribe(signal);
        if (generation !== this.generation) return;
        this.page = page;
        await this.webhook.start();
        if (generation !== this.generation) {
            await this.webhook.stop();
            return;
        }
        this.started = true;
    }

    private async subscribe(signal: AbortSignal): Promise<void> {
        const fields = this.config.subscribed_fields?.length
            ? this.config.subscribed_fields
            : ["messages", "message_deliveries", "message_reads", "messaging_postbacks"];
        await this.call("POST", `/${this.config.page_id}/subscribed_apps`, {
            query: { subscribed_fields: fields.join(",") },
            signal,
        });
    }

    private forward(
        delivery: MetaWebhookDelivery<
            FacebookMessengerDelivery["event"],
            FacebookMessengerDelivery["rawEnvelope"]
        >,
    ): Promise<void> {
        return emitAllAwaited(this, "event", delivery);
    }

    private reportError(error: Error): void {
        this.dependencies.reportError?.(error);
        if (this.listenerCount("error")) this.emit("error", error);
    }
}

function boundedLimit(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw FacebookMessengerError.invalid("limit 必须是正安全整数");
    }
    return Math.min(value, 100);
}
