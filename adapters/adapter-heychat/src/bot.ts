import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import type WebSocket from "ws";
import { emitAllAwaited, FailureCollector } from "onebots";
import { assertHeychatConfig, resolveHeychatReceiveMode } from "./config.js";
import { HeychatApiError } from "./errors.js";
import { HeychatHttpClient } from "./http/client.js";
import {
    decodeHeychatEnvelope,
    HeychatEventIngress,
    isHeychatControlPayload,
    type HeychatIngestResult,
} from "./ingress.js";
import { HeychatWsClient } from "./ws/client.js";
import type {
    HeychatApiRequestOptions,
    HeychatCardClickData,
    HeychatChannelContext,
    HeychatConfig,
    HeychatOutboundMessage,
    HeychatRoomInfo,
    HeychatRoomUsersResult,
    HeychatRoomViewResult,
    HeychatSendMessageResult,
    HeychatUseCommandData,
    HeychatWsEnvelope,
} from "./types.js";

const MAX_CONTEXTS = 10_000;

export interface HeychatBotEvents {
    ready: [];
    disconnected: [details: { code: number; reason: string }];
    reconnecting: [details: { attempt: number; delay: number }];
    error: [error: HeychatApiError];
    event: [event: HeychatWsEnvelope];
    stopped: [];
}

/** 聚合 REST 与正向 WebSocket 的平台客户端，不承担通用事件投影。 */
export class HeychatBot extends EventEmitter<HeychatBotEvents> {
    private readonly http: HeychatHttpClient;
    private ws: HeychatWsClient | null = null;
    private readonly ingress = new HeychatEventIngress();
    private detachAcceptedSocket: (() => void) | null = null;
    private deliveryAbort: AbortController | null = null;
    private deliveryGeneration = 0;
    private socketDeliveryTail: Promise<void> = Promise.resolve();
    private botId: number | null = null;
    private running = false;
    private startPromise: Promise<void> | null = null;
    private readonly channelContexts = new Map<string, HeychatChannelContext>();
    private readonly messageContexts = new Map<string, HeychatChannelContext>();

    constructor(private readonly config: HeychatConfig) {
        super();
        assertHeychatConfig(config);
        this.http = new HeychatHttpClient(config);
    }

    async start(): Promise<void> {
        if (this.startPromise) return this.startPromise;
        if (this.running) return;
        const start = this.startInternal();
        this.startPromise = start;
        try {
            await start;
        } finally {
            if (this.startPromise === start) this.startPromise = null;
        }
    }

    private async startInternal(): Promise<void> {
        this.running = true;
        const generation = ++this.deliveryGeneration;
        const deliveryAbort = new AbortController();
        this.deliveryAbort = deliveryAbort;
        let startingWs: HeychatWsClient | null = null;
        try {
            if (resolveHeychatReceiveMode(this.config) === "manual") {
                this.ingress.reset();
                await emitAllAwaited(this, "ready");
                return;
            }
            const ws = new HeychatWsClient(this.config);
            startingWs = ws;
            this.ws = ws;
            ws.on("ready", async () => {
                this.ingress.reset();
                await emitAllAwaited(this, "ready");
            });
            ws.on("disconnected", details => this.emit("disconnected", details));
            ws.on("reconnecting", details => this.emit("reconnecting", details));
            ws.on("error", error => this.emit("error", error));
            ws.on("event", envelope => this.enqueueSocketEvent(envelope));
            await ws.connect();
        } catch (error) {
            if (generation === this.deliveryGeneration) {
                this.running = false;
                this.deliveryGeneration += 1;
                deliveryAbort.abort(new DOMException("HeyChat 启动失败", "AbortError"));
                if (this.deliveryAbort === deliveryAbort) this.deliveryAbort = null;
                if (this.ws === startingWs) this.ws = null;
            }
            throw error;
        }
    }

    async stop(): Promise<void> {
        const wasActive = this.running || Boolean(this.startPromise || this.ws);
        if (!wasActive) return;
        this.running = false;
        this.startPromise = null;
        this.deliveryGeneration += 1;
        this.deliveryAbort?.abort(new DOMException("HeyChat 已停止", "AbortError"));
        this.deliveryAbort = null;
        const detachAcceptedSocket = this.detachAcceptedSocket;
        this.detachAcceptedSocket = null;
        const ws = this.ws;
        this.ws = null;
        const deliveryTail = this.socketDeliveryTail;
        const failures = new FailureCollector();
        if (detachAcceptedSocket) await failures.capture(detachAcceptedSocket);
        if (ws) await failures.capture(() => ws.close());
        await failures.capture(() => deliveryTail);
        await failures.capture(() => emitAllAwaited(this, "stopped"));
        try {
            failures.throwIfAny("黑盒语音客户端停止期间发生多个错误");
        } catch (error) {
            throw HeychatApiError.wrap(error, "HEYCHAT_STOP_FAILED");
        }
    }

    isConnected(): boolean {
        return resolveHeychatReceiveMode(this.config) === "manual"
            ? this.running
            : (this.ws?.isConnected() ?? false);
    }

    /** 将宿主收到的结构化事件或 WS 文本帧交给统一事件管线。 */
    ingest(rawEvent: unknown): Promise<HeychatIngestResult> {
        return this.ingress.ingest(rawEvent, async event => {
            this.observeEnvelope(event);
            for (const listener of this.rawListeners("event")) {
                try {
                    await Reflect.apply(listener, this, [event]);
                } catch (error) {
                    throw HeychatApiError.wrap(error, "HEYCHAT_EVENT_DELIVERY_FAILED");
                }
            }
        });
    }

    /**
     * 接收宿主已升级的 ws socket。适配器只订阅 message，不接管心跳、关闭或重连。
     */
    acceptWebSocket(socket: WebSocket): () => void {
        if (resolveHeychatReceiveMode(this.config) !== "manual") {
            throw HeychatApiError.invalid(
                "acceptWebSocket 仅可在 receive_mode=manual 时使用",
                "HEYCHAT_MANUAL_MODE_REQUIRED",
            );
        }
        this.detachAcceptedSocket?.();
        this.ingress.reset();
        const onMessage = (data: WebSocket.RawData): void => {
            if (isHeychatControlPayload(data)) return;
            try {
                this.enqueueSocketEvent(decodeHeychatEnvelope(data));
            } catch (error) {
                const wrapped = HeychatApiError.wrap(error, "HEYCHAT_INVALID_WS_EVENT");
                socket.close(
                    wrapped.code === "HEYCHAT_EVENT_TOO_LARGE" ? 1009 : 1007,
                    wrapped.code,
                );
                this.emit("error", wrapped);
            }
        };
        socket.on("message", onMessage);
        const detach = (): void => {
            socket.off("message", onMessage);
        };
        this.detachAcceptedSocket = detach;
        return () => {
            detach();
            if (this.detachAcceptedSocket === detach) this.detachAcceptedSocket = null;
        };
    }

    /** Socket 没有业务 ACK，故本地按序保留事件并以有界退避重试到成功或账号停止。 */
    private enqueueSocketEvent(rawEvent: HeychatWsEnvelope): void {
        const generation = this.deliveryGeneration;
        const signal = this.deliveryAbort?.signal;
        const delivery = this.socketDeliveryTail.then(async () => {
            let retryDelay = this.config.reconnect_initial_delay_ms ?? 1_000;
            const retryMax = Math.max(retryDelay, this.config.reconnect_max_delay_ms ?? 30_000);
            while (this.running && generation === this.deliveryGeneration && !signal?.aborted) {
                try {
                    await this.ingest(rawEvent);
                    return;
                } catch (error) {
                    const wrapped = HeychatApiError.wrap(error, "HEYCHAT_EVENT_DELIVERY_FAILED");
                    this.emit("error", wrapped);
                    try {
                        await delay(retryDelay, undefined, { signal });
                    } catch (delayError) {
                        if (signal?.aborted) return;
                        throw delayError;
                    }
                    retryDelay = Math.min(retryDelay * 2, retryMax);
                }
            }
        });
        this.socketDeliveryTail = delivery.catch(error => {
            if (!signal?.aborted) {
                this.emit("error", HeychatApiError.wrap(error, "HEYCHAT_EVENT_DELIVERY_FAILED"));
            }
        });
    }

    getBotId(): number | null {
        return this.botId;
    }

    getChannelContext(channelId: string): HeychatChannelContext | undefined {
        return this.channelContexts.get(channelId);
    }

    getMessageContext(msgId: string): HeychatChannelContext | undefined {
        return this.messageContexts.get(msgId);
    }

    resolveSendTarget(sceneId: string): { room_id: string; channel_id: string } {
        if (sceneId.includes(":")) {
            const [roomId, channelId] = sceneId.split(":", 2);
            if (roomId && channelId) return { room_id: roomId, channel_id: channelId };
        }
        const context = this.channelContexts.get(sceneId);
        if (context) return { room_id: context.room_id, channel_id: context.channel_id };
        throw HeychatApiError.invalid(
            `无法解析 scene_id=${sceneId}；频道消息请使用 room_id:channel_id，或先接收该频道命令事件`,
            "HEYCHAT_SCENE_CONTEXT_REQUIRED",
            { scene_id: sceneId },
        );
    }

    callApi<T = unknown>(path: string, options: HeychatApiRequestOptions = {}): Promise<T> {
        return this.http.callApi(path, options);
    }

    uploadMedia(data: Uint8Array, filename: string, contentType?: string): Promise<string> {
        return this.http.uploadMedia(data, filename, contentType);
    }

    async sendChannelMessage(
        roomId: string,
        channelId: string,
        message: HeychatOutboundMessage,
    ): Promise<HeychatSendMessageResult> {
        const result = await this.http.sendChannelMessage(roomId, channelId, message);
        this.cacheMessageContext(result.msg_id, { room_id: roomId, channel_id: channelId });
        return result;
    }

    sendPrivateMessage(
        userId: string,
        message: HeychatOutboundMessage,
    ): Promise<HeychatSendMessageResult> {
        return this.http.sendPrivateMessage(userId, message);
    }

    deleteChannelMessage(roomId: string, channelId: string, msgId: string): Promise<void> {
        return this.http.deleteChannelMessage(roomId, channelId, msgId);
    }

    getRoomInfo(roomId: string): Promise<HeychatRoomInfo> {
        return this.http.getRoomInfo(roomId);
    }

    getRoomView(roomId: string): Promise<HeychatRoomViewResult> {
        return this.http.getRoomView(roomId);
    }

    rememberChannel(context: HeychatChannelContext): void {
        this.cacheChannelContext(context);
    }

    listJoinedRooms(): Promise<HeychatRoomInfo[]> {
        return this.http.listJoinedRooms();
    }

    listRoomUsers(
        roomId: string,
        userId?: string,
        offset?: number,
        limit?: number,
    ): Promise<HeychatRoomUsersResult> {
        return this.http.listRoomUsers(roomId, userId, offset, limit);
    }

    private observeEnvelope(envelope: HeychatWsEnvelope): void {
        if (envelope.type !== "50" && envelope.type !== "card_message_btn_click") return;
        const data = envelope.data as unknown as HeychatUseCommandData | HeychatCardClickData;
        const room = data.room_base_info;
        const channel = data.channel_base_info;
        const eventBotId = "bot_id" in data ? data.bot_id : undefined;
        if (typeof eventBotId === "number") this.botId = eventBotId;
        if (!room?.room_id || !channel?.channel_id) return;
        const context: HeychatChannelContext = {
            room_id: room.room_id,
            room_name: room.room_name,
            channel_id: channel.channel_id,
            channel_name: channel.channel_name,
            channel_type: channel.channel_type,
        };
        this.cacheChannelContext(context);
        if (data.msg_id) this.cacheMessageContext(data.msg_id, context);
    }

    private cacheChannelContext(context: HeychatChannelContext): void {
        setBounded(this.channelContexts, context.channel_id, context);
        setBounded(this.channelContexts, `${context.room_id}:${context.channel_id}`, context);
    }

    private cacheMessageContext(msgId: string, context: HeychatChannelContext): void {
        setBounded(this.messageContexts, msgId, context);
        this.cacheChannelContext(context);
    }
}

function setBounded<T>(map: Map<string, T>, key: string, value: T): void {
    map.delete(key);
    map.set(key, value);
    while (map.size > MAX_CONTEXTS) {
        const oldest = map.keys().next().value;
        if (typeof oldest !== "string") break;
        map.delete(oldest);
    }
}
