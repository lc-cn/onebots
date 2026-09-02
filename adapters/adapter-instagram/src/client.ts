import { EventEmitter } from "node:events";
import { MetaGraphTransport, MetaWebhookClient, type MetaWebhookDelivery } from "@onebots/meta";
import { emitAllAwaited } from "onebots";
import {
    parseAttachmentId,
    parseBusinessProfile,
    parseConversation,
    parseConversationList,
    parseSendResponse,
    parseUserProfile,
} from "./entities.js";
import { InstagramError } from "./errors.js";
import type {
    InstagramBusinessProfile,
    InstagramCallOptions,
    InstagramClientEvents,
    InstagramConfig,
    InstagramConversation,
    InstagramDelivery,
    InstagramGraphMethod,
    InstagramHttpRequest,
    InstagramHttpResponse,
    InstagramIngestResult,
    InstagramList,
    InstagramOutgoingMessage,
    InstagramSendResponse,
    InstagramUserProfile,
} from "./types.js";
import {
    assertHttpsUrl,
    assertInstagramConfig,
    assertMetaId,
    assertNumericMetaId,
} from "./validation.js";
import { InstagramWebhookCodec } from "./webhook-codec.js";

export interface InstagramClientDependencies {
    fetcher?: typeof fetch;
    reportError?(error: Error): void;
}

/** Graph API 与 Webhook/manual ingress 共用的可嵌入 Instagram Client。 */
export class InstagramClient extends EventEmitter<InstagramClientEvents> {
    private readonly transport: MetaGraphTransport;
    private readonly webhook: MetaWebhookClient<
        InstagramDelivery["event"],
        InstagramDelivery["rawEnvelope"]
    >;
    private profile?: InstagramBusinessProfile;
    private startTask?: Promise<void>;
    private startAbort?: AbortController;
    private generation = 0;
    private started = false;

    constructor(
        readonly config: InstagramConfig,
        private readonly dependencies: InstagramClientDependencies = {},
    ) {
        super();
        assertInstagramConfig(config);
        this.transport = new MetaGraphTransport(
            {
                accessToken: config.access_token,
                appSecret: config.app_secret,
                apiOrigin: config.api_origin || "https://graph.instagram.com",
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
            new InstagramWebhookCodec(config.instagram_user_id, config.event_types),
            { reportError: error => this.reportError(error) },
        );
        this.webhook.on("event", delivery => this.forward(delivery));
        this.webhook.on("ready", () => emitAllAwaited(this, "ready"));
        this.webhook.on("stop", () => emitAllAwaited(this, "stop"));
    }

    get receiveMode(): InstagramReceiveMode {
        return this.config.receive_mode || "webhook";
    }

    get isStarted(): boolean {
        return this.started;
    }

    get businessProfile(): InstagramBusinessProfile | undefined {
        return this.profile ? structuredClone(this.profile) : undefined;
    }

    async start(): Promise<void> {
        if (this.started) return;
        if (this.startTask) return this.startTask;
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
        }
    }

    async stop(): Promise<void> {
        ++this.generation;
        this.startAbort?.abort();
        await this.startTask?.catch(() => undefined);
        this.started = false;
        await this.webhook.stop();
    }

    call<T = unknown>(
        method: InstagramGraphMethod,
        path: string,
        options?: InstagramCallOptions,
    ): Promise<T> {
        return this.transport.call<T>(method, path, options);
    }

    ingest(rawEvent: unknown): Promise<InstagramIngestResult[]> {
        return this.webhook.ingest(rawEvent);
    }

    ingestHttp(request: InstagramHttpRequest): Promise<InstagramHttpResponse> {
        return this.webhook.ingestHttp(request);
    }

    acceptHttp(request: Request): Promise<Response> {
        return this.webhook.acceptHttp(request);
    }

    async send(
        recipientId: string,
        message: InstagramOutgoingMessage,
        options: { humanAgent?: boolean } = {},
    ): Promise<InstagramSendResponse> {
        assertNumericMetaId(recipientId, "recipient_id");
        return parseSendResponse(
            await this.call("POST", `/${this.config.instagram_user_id}/messages`, {
                body: {
                    recipient: { id: recipientId },
                    message,
                    ...(options.humanAgent ? { tag: "HUMAN_AGENT" } : {}),
                },
            }),
        );
    }

    async sendPrivateReply(commentId: string, text: string): Promise<InstagramSendResponse> {
        assertNumericMetaId(commentId, "comment_id");
        if (!text) throw InstagramError.invalid("private reply text 不能为空");
        return parseSendResponse(
            await this.call("POST", `/${this.config.instagram_user_id}/messages`, {
                body: { recipient: { comment_id: commentId }, message: { text } },
            }),
        );
    }

    react(recipientId: string, messageId: string, action: "react" | "unreact"): Promise<unknown> {
        assertNumericMetaId(recipientId, "recipient_id");
        assertMetaId(messageId, "message_id");
        return this.call("POST", `/${this.config.instagram_user_id}/messages`, {
            body: {
                recipient: { id: recipientId },
                sender_action: action,
                payload: { message_id: messageId, reaction: "love" },
            },
        });
    }

    async uploadAttachment(
        type: "image" | "video" | "audio" | "file",
        source: { url: string } | { blob: Blob; filename: string },
        reusable = true,
    ): Promise<string> {
        let response: unknown;
        if ("url" in source) {
            response = await this.call(
                "POST",
                `/${this.config.instagram_user_id}/message_attachments`,
                {
                    body: {
                        message: {
                            attachment: {
                                type,
                                payload: {
                                    url: assertHttpsUrl(source.url, "attachment.url"),
                                    is_reusable: reusable,
                                },
                            },
                        },
                    },
                },
            );
        } else {
            const form = new FormData();
            form.set(
                "message",
                JSON.stringify({ attachment: { type, payload: { is_reusable: reusable } } }),
            );
            form.set("filedata", source.blob, source.filename);
            response = await this.call(
                "POST",
                `/${this.config.instagram_user_id}/message_attachments`,
                {
                    form,
                },
            );
        }
        return parseAttachmentId(response);
    }

    async getUserProfile(userId: string): Promise<InstagramUserProfile> {
        assertNumericMetaId(userId, "user_id");
        return parseUserProfile(
            await this.call("GET", `/${userId}`, {
                query: {
                    fields: "id,name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user,is_verified_user",
                },
            }),
        );
    }

    async listConversations(
        after?: string,
        limit = 25,
    ): Promise<InstagramList<InstagramConversation>> {
        return parseConversationList(
            await this.call("GET", `/${this.config.instagram_user_id}/conversations`, {
                query: {
                    platform: "instagram",
                    fields: "id,updated_time,participants",
                    limit: boundedLimit(limit),
                    after,
                },
            }),
        );
    }

    async findConversation(userId: string): Promise<InstagramConversation | undefined> {
        assertNumericMetaId(userId, "user_id");
        const result = parseConversationList(
            await this.call("GET", `/${this.config.instagram_user_id}/conversations`, {
                query: {
                    platform: "instagram",
                    user_id: userId,
                    fields: "id,updated_time,participants",
                },
            }),
        );
        if (result.data.length > 1) {
            throw new InstagramError("Conversations API 对单个 IGSID 返回了多个会话", {
                code: "INSTAGRAM_AMBIGUOUS_CONVERSATION",
                details: { user_id: userId, count: result.data.length },
            });
        }
        return result.data[0];
    }

    async getConversation(conversationId: string, limit = 20): Promise<InstagramConversation> {
        assertMetaId(conversationId, "conversation_id");
        return parseConversation(
            await this.call("GET", `/${conversationId}`, {
                query: {
                    fields: `id,updated_time,participants,messages.limit(${boundedMessageLimit(limit)}){id,created_time,from,to,message}`,
                },
            }),
        );
    }

    private async startInternal(generation: number, signal: AbortSignal): Promise<void> {
        const profile = parseBusinessProfile(
            await this.call("GET", `/${this.config.instagram_user_id}`, {
                query: { fields: "id,username" },
                signal,
            }),
        );
        if (profile.id !== this.config.instagram_user_id) {
            throw new InstagramError("access token 返回了不同的 Instagram User ID", {
                code: "INSTAGRAM_USER_ID_MISMATCH",
                details: { expected: this.config.instagram_user_id, actual: profile.id },
            });
        }
        if (this.config.auto_subscribe) await this.subscribe(signal);
        if (generation !== this.generation) return;
        this.profile = profile;
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
            : ["messages", "messaging_postbacks", "messaging_seen", "message_reactions"];
        await this.call("POST", `/${this.config.instagram_user_id}/subscribed_apps`, {
            query: { subscribed_fields: fields.join(",") },
            signal,
        });
    }

    private forward(
        delivery: MetaWebhookDelivery<InstagramDelivery["event"], InstagramDelivery["rawEnvelope"]>,
    ): Promise<void> {
        return emitAllAwaited(this, "event", delivery);
    }

    private reportError(error: Error): void {
        this.dependencies.reportError?.(error);
        if (this.listenerCount("error")) this.emit("error", error);
    }
}

type InstagramReceiveMode = "webhook" | "manual";

function boundedLimit(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw InstagramError.invalid("limit 必须是正安全整数");
    }
    return Math.min(value, 100);
}

function boundedMessageLimit(value: number): number {
    return Math.min(boundedLimit(value), 20);
}
