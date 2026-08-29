import { EventEmitter } from "node:events";
import { HeychatHttpClient } from "./http/client.js";
import { HeychatWsClient } from "./ws/client.js";
import type {
    HeychatApiRequestOptions,
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

/** 聚合 REST 与正向 WebSocket 的平台客户端，不承担通用事件投影。 */
export class HeychatBot extends EventEmitter {
    private readonly http: HeychatHttpClient;
    private ws: HeychatWsClient | null = null;
    private botId: number | null = null;
    private running = false;
    private readonly channelContexts = new Map<string, HeychatChannelContext>();
    private readonly messageContexts = new Map<string, HeychatChannelContext>();

    constructor(private readonly config: HeychatConfig) {
        super();
        this.http = new HeychatHttpClient(config);
    }

    async start(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            const ws = new HeychatWsClient(this.config);
            this.ws = ws;
            ws.on("ready", () => this.emit("ready"));
            ws.on("disconnected", details => this.emit("disconnected", details));
            ws.on("reconnecting", details => this.emit("reconnecting", details));
            ws.on("error", error => this.emit("error", error));
            ws.on("event", (envelope: HeychatWsEnvelope) => {
                this.observeEnvelope(envelope);
                this.emit("event", envelope);
            });
            await ws.connect();
        } catch (error) {
            this.running = false;
            this.ws = null;
            throw error;
        }
    }

    async stop(): Promise<void> {
        if (!this.running) return;
        this.running = false;
        this.ws?.close();
        this.ws = null;
        this.emit("stopped");
    }

    isConnected(): boolean {
        return this.ws?.isConnected() ?? false;
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
        throw new Error(
            `无法解析 scene_id=${sceneId}；频道消息请使用 room_id:channel_id，或先接收该频道命令事件`,
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
        if (envelope.type !== "50") return;
        const data = envelope.data as unknown as HeychatUseCommandData;
        const room = data.room_base_info;
        const channel = data.channel_base_info;
        if (data.bot_id !== undefined) this.botId = data.bot_id;
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
        setBounded(this.channelContexts, context.room_id, context);
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
