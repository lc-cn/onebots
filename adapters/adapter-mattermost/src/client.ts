import { emitAllAwaited, ReliableEventIngress, sha256Json } from "onebots";
import { WebSocket } from "ws";
import { MattermostApiClient, type MattermostApiDependencies } from "./client-api.js";
import { assertMattermostConfig } from "./configuration.js";
import { MattermostError } from "./errors.js";
import type {
    MattermostConfig,
    MattermostDelivery,
    MattermostIngestResult,
    MattermostSocketAttachOptions,
    MattermostWebSocketEvent,
    MattermostWebSocketResponse,
} from "./types.js";
import { parseMattermostDelivery, parseMattermostWebSocketMessage } from "./validation.js";
import { MattermostWebSocketTransport, type MattermostWebSocketDependencies } from "./websocket.js";

export interface MattermostClientDependencies
    extends MattermostApiDependencies, MattermostWebSocketDependencies {
    reportError?(error: Error): void;
}

/** 可独立嵌入的 Mattermost REST v4、可靠 WebSocket 与 manual ingress Client。 */
export class MattermostClient extends MattermostApiClient {
    private readonly websocket: MattermostWebSocketTransport;
    private readonly ingress = new ReliableEventIngress<string>();
    private startTask?: Promise<void>;
    private startAbort?: AbortController;
    private externalSignal?: AbortSignal;
    private externalAbort?: () => void;
    private generation = 0;
    private started = false;

    constructor(
        config: MattermostConfig,
        private readonly dependencies: MattermostClientDependencies = {},
    ) {
        super(config, dependencies);
        assertMattermostConfig(config);
        this.websocket = new MattermostWebSocketTransport(config, dependencies);
        this.websocket.on("event", event => this.ingest(event).then(() => undefined));
        this.websocket.on("connected", event => emitAllAwaited(this, "connected", event));
        this.websocket.on("disconnected", error => emitAllAwaited(this, "disconnected", error));
        this.websocket.on("missed", (expected, actual, event) =>
            emitAllAwaited(this, "missed", expected, actual, event),
        );
        this.websocket.on("error", error => this.reportError(error));
    }

    get receiveMode(): "websocket" | "manual" {
        return this.config.receive_mode || "websocket";
    }

    get isStarted(): boolean {
        return this.started;
    }

    get isConnected(): boolean {
        return this.websocket.connected;
    }

    async start(signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        if (this.started) return;
        if (this.startTask) return this.startTask;
        const generation = ++this.generation;
        const controller = new AbortController();
        this.startAbort = controller;
        this.bindExternalSignal(signal, controller);
        const task = this.initialize(generation, controller.signal);
        this.startTask = task;
        try {
            await task;
        } finally {
            if (this.startTask === task) this.startTask = undefined;
            if (!this.started) {
                this.unbindExternalSignal();
                if (this.startAbort === controller) this.startAbort = undefined;
            }
        }
    }

    private async initialize(generation: number, signal: AbortSignal): Promise<void> {
        try {
            const user = await this.getMe(signal);
            this.assertCurrent(generation, signal);
            this.setCurrentUser(user);
            if (this.receiveMode === "websocket") await this.websocket.start(signal);
            this.assertCurrent(generation, signal);
            this.started = true;
            await emitAllAwaited(this, "ready", user);
        } catch (error) {
            this.setCurrentUser(undefined);
            this.started = false;
            await this.websocket.stop();
            throw MattermostError.wrap(error, "MATTERMOST_START_FAILED");
        }
    }

    async stop(): Promise<void> {
        ++this.generation;
        this.unbindExternalSignal();
        this.startAbort?.abort();
        await this.startTask?.catch(() => undefined);
        await this.websocket.stop();
        this.started = false;
        this.setCurrentUser(undefined);
        await emitAllAwaited(this, "stop");
    }

    private bindExternalSignal(signal: AbortSignal | undefined, controller: AbortController): void {
        this.unbindExternalSignal();
        if (!signal) return;
        const abort = (): void => {
            controller.abort(signal.reason);
            void this.stop().catch(error => this.reportError(MattermostError.wrap(error)));
        };
        this.externalSignal = signal;
        this.externalAbort = abort;
        signal.addEventListener("abort", abort, { once: true });
    }

    private unbindExternalSignal(): void {
        if (this.externalSignal && this.externalAbort) {
            this.externalSignal.removeEventListener("abort", this.externalAbort);
        }
        this.externalSignal = undefined;
        this.externalAbort = undefined;
    }

    /** 已有连接、消息队列和测试夹具共用的最底层可靠事件入口。 */
    async ingest(rawEvent: unknown): Promise<MattermostIngestResult> {
        const packet = parseMattermostWebSocketMessage(rawEvent);
        if (!("event" in packet)) {
            throw MattermostError.invalid("ingest(rawEvent) 只接受 Mattermost WebSocket event");
        }
        const delivery = parseMattermostDelivery(packet);
        this.rememberDelivery(delivery);
        if (!this.shouldDeliver(delivery)) {
            return { accepted: false, duplicate: false, filtered: true, delivery };
        }
        const accepted = await this.ingress.deliver(deliveryKey(delivery), () =>
            emitAllAwaited(this, "event", delivery),
        );
        return { accepted, duplicate: !accepted, filtered: false, delivery };
    }

    /** 将外部创建或已有 Host 管理的连接交给同一可靠 WebSocket 管线。 */
    acceptSocket(
        socket: WebSocket,
        options?: MattermostSocketAttachOptions,
        signal?: AbortSignal,
    ): Promise<MattermostWebSocketEvent> {
        return this.websocket.acceptSocket(socket, options, signal);
    }

    sendWebSocketAction(
        action: "user_typing" | "get_statuses" | "get_statuses_by_ids",
        data: Readonly<Record<string, unknown>> = {},
    ): Promise<MattermostWebSocketResponse> {
        return this.websocket.sendAction(action, data);
    }

    private shouldDeliver(delivery: MattermostDelivery): boolean {
        const { event } = delivery;
        if (this.config.event_types?.length && !this.config.event_types.includes(event.event)) {
            return false;
        }
        const teamId =
            delivery.team?.id || event.broadcast.team_id || stringField(event.data.team_id);
        if (this.config.team_ids?.length && teamId && !this.config.team_ids.includes(teamId)) {
            return false;
        }
        const channelId =
            delivery.post?.channel_id ||
            delivery.channel?.id ||
            event.broadcast.channel_id ||
            stringField(event.data.channel_id);
        if (
            this.config.channel_ids?.length &&
            channelId &&
            !this.config.channel_ids.includes(channelId)
        ) {
            return false;
        }
        return true;
    }

    private rememberDelivery(delivery: MattermostDelivery): void {
        if (delivery.channel) this.rememberChannel(delivery.channel);
    }

    private assertCurrent(generation: number, signal: AbortSignal): void {
        if (generation !== this.generation) {
            throw new MattermostError("Mattermost Client 启动已取消", {
                code: "MATTERMOST_START_CANCELLED",
            });
        }
        signal.throwIfAborted();
    }

    private reportError(error: Error): void {
        this.dependencies.reportError?.(error);
        void emitAllAwaited(this, "error", error).catch(() => undefined);
    }
}

function deliveryKey(delivery: MattermostDelivery): string {
    if (delivery.post) {
        return `${delivery.event.event}:post:${delivery.post.id}:${delivery.post.update_at}:${delivery.post.delete_at}`;
    }
    if (delivery.reaction) {
        const reaction = delivery.reaction;
        return `${delivery.event.event}:reaction:${reaction.user_id}:${reaction.post_id}:${reaction.emoji_name}:${reaction.create_at}`;
    }
    return `${delivery.event.event}:${sha256Json(delivery.event)}`;
}

function stringField(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}
