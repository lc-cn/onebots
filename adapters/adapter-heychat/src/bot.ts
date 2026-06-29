/**
 * 黑盒语音 Bot 客户端
 */
import { EventEmitter } from 'events';
import { HeychatHttpClient } from './http/client.js';
import { HeychatWsClient } from './ws/client.js';
import {
    parseChannelMessageEvent,
    parseCommandEvent,
} from './utils.js';
import type {
    HeychatChannelContext,
    HeychatChannelMessageData,
    HeychatConfig,
    HeychatMessageEvent,
    HeychatSendMessageOptions,
    HeychatSendMessageResult,
    HeychatUseCommandData,
    HeychatRoomInfo,
} from './types.js';

export class HeychatBot extends EventEmitter {
    private readonly config: HeychatConfig;
    private readonly http: HeychatHttpClient;
    private ws: HeychatWsClient | null = null;
    private botId: number | null = null;
    private running = false;

    /** channel_id -> 上下文 */
    private readonly channelContexts = new Map<string, HeychatChannelContext>();
    /** msg_id -> 上下文 */
    private readonly messageContexts = new Map<string, HeychatChannelContext & { msg_id: string }>();

    constructor(config: HeychatConfig) {
        super();
        this.config = config;
        this.http = new HeychatHttpClient(config);
    }

    /** 缓存频道上下文 */
    cacheContext(event: HeychatMessageEvent): void {
        const context: HeychatChannelContext = {
            room_id: event.room_id,
            channel_id: event.channel_id,
            channel_type: event.channel_type,
            room_name: event.room_name,
            channel_name: event.channel_name,
        };
        this.channelContexts.set(event.channel_id, context);
        this.channelContexts.set(`${event.room_id}:${event.channel_id}`, context);
        this.channelContexts.set(event.room_id, context);
        this.messageContexts.set(event.msg_id, { ...context, msg_id: event.msg_id });
        if (event.bot_id !== undefined) {
            this.botId = event.bot_id;
        }
    }

    getBotId(): number | null {
        return this.botId;
    }

    getChannelContext(channelId: string): HeychatChannelContext | undefined {
        return this.channelContexts.get(channelId);
    }

    getMessageContext(msgId: string): (HeychatChannelContext & { msg_id: string }) | undefined {
        return this.messageContexts.get(msgId);
    }

    resolveSendTarget(
        sceneType: string,
        sceneId: string,
    ): { room_id: string; channel_id: string } {
        if (sceneId.includes(':')) {
            const [roomId, channelId] = sceneId.split(':', 2);
            return { room_id: roomId, channel_id: channelId };
        }

        const context = this.channelContexts.get(sceneId);
        if (context) {
            return { room_id: context.room_id, channel_id: context.channel_id };
        }

        if (sceneType === 'group') {
            throw new Error(
                '[Heychat] 发送消息需要 room_id:channel_id 格式的 scene_id，或先收到该频道的消息事件',
            );
        }

        throw new Error(
            `[Heychat] 无法解析 scene_id=${sceneId}，请使用 room_id:channel_id 格式或等待该频道消息事件`,
        );
    }

    async start(): Promise<void> {
        if (this.running) return;
        this.running = true;

        this.ws = new HeychatWsClient(this.config);
        this.ws.on('ready', () => {
            this.emit('ready');
        });
        this.ws.on('event', (envelope) => {
            this.handleWsEvent(envelope.type, envelope.data, envelope.timestamp);
        });
        this.ws.on('error', (error) => {
            this.emit('error', error);
        });
        this.ws.on('close', () => {
            if (!this.running) {
                this.emit('stopped');
            }
        });

        await this.ws.connect();
    }

    async stop(): Promise<void> {
        this.running = false;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.emit('stopped');
    }

    private handleWsEvent(type: string, data: Record<string, unknown>, timestamp?: number): void {
        switch (type) {
            case '50': {
                const event = parseCommandEvent(data as HeychatUseCommandData);
                if (!event) return;
                if (this.shouldIgnoreSelf(event)) return;
                this.cacheContext(event);
                this.emit('command', event);
                this.emit('message', event);
                return;
            }
            case '5': {
                const event = parseChannelMessageEvent(data as HeychatChannelMessageData);
                if (!event) return;
                if (this.shouldIgnoreSelf(event)) return;
                this.cacheContext(event);
                this.emit('channel_message', event);
                this.emit('message', event);
                return;
            }
            case '5003':
                this.emit('reaction', { ...data, timestamp });
                return;
            case '3001':
                this.emit('member_update', { ...data, timestamp });
                return;
            default:
                this.emit('raw_event', { type, data, timestamp });
        }
    }

    private shouldIgnoreSelf(event: HeychatMessageEvent): boolean {
        if (this.config.ignore_self_messages === false) return false;
        if (event.user_id === this.botId) return true;
        return false;
    }

    async sendChannelMessage(
        roomId: string,
        channelId: string,
        content: string,
        options?: HeychatSendMessageOptions,
    ): Promise<HeychatSendMessageResult> {
        return this.http.sendChannelMessage(roomId, channelId, content, options);
    }

    async deleteChannelMessage(roomId: string, channelId: string, msgId: string): Promise<void> {
        await this.http.deleteChannelMessage(roomId, channelId, msgId);
    }

    async getRoomInfo(roomId: string): Promise<HeychatRoomInfo> {
        return this.http.getRoomInfo(roomId);
    }
}
