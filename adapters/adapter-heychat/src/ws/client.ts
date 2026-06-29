/**
 * 黑盒语音 WebSocket 客户端
 */
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { ConnectionManager, RetryPresets, createProxyAgent } from 'onebots';
import type { HeychatConfig, HeychatWsEnvelope } from '../types.js';

const DEFAULT_WS_URL = 'wss://chat.xiaoheihe.cn/chatroom/ws/connect';
const DEFAULT_CHAT_VERSION = '1.30.0';
const DEFAULT_PING_INTERVAL = 30;

export class HeychatWsClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private readonly token: string;
    private readonly wsUrl: string;
    private readonly chatVersion: string;
    private readonly pingIntervalMs: number;
    private readonly proxy?: HeychatConfig['proxy'];
    private pingTimer: ReturnType<typeof setInterval> | null = null;
    private lastSequence = 0;
    private closed = false;
    private connectionManager: ConnectionManager | null = null;

    constructor(config: Pick<HeychatConfig, 'token' | 'ws_url' | 'chat_version' | 'ping_interval' | 'proxy'>) {
        super();
        this.token = config.token;
        this.wsUrl = config.ws_url || DEFAULT_WS_URL;
        this.chatVersion = config.chat_version || DEFAULT_CHAT_VERSION;
        this.pingIntervalMs = (config.ping_interval ?? DEFAULT_PING_INTERVAL) * 1000;
        this.proxy = config.proxy;
    }

    /** 构建 WebSocket 连接 URL */
    private buildConnectUrl(): string {
        const url = new URL(this.wsUrl);
        url.searchParams.set('chat_os_type', 'bot');
        url.searchParams.set('client_type', 'heybox_chat');
        url.searchParams.set('chat_version', this.chatVersion);
        url.searchParams.set('token', this.token);
        return url.toString();
    }

    private attachSocket(ws: WebSocket): void {
        this.ws = ws;

        ws.on('message', (raw) => {
            this.handleMessage(raw.toString());
        });

        ws.on('ping', () => {
            ws.pong();
        });

        ws.on('close', () => {
            this.cleanupConnection(false);
            this.emit('close');
            if (!this.closed && this.connectionManager) {
                this.connectionManager.scheduleReconnect();
            }
        });

        ws.on('error', (error) => {
            const err = error instanceof Error ? error : new Error(String(error));
            this.emit('error', err);
        });
    }

    private async openSocket(): Promise<void> {
        const options: WebSocket.ClientOptions = {
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9',
            },
        };
        if (this.proxy?.url) {
            const agent = await createProxyAgent(this.proxy, true);
            if (agent) {
                options.agent = agent as WebSocket.ClientOptions['agent'];
            }
        }

        await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(this.buildConnectUrl(), options);
            ws.once('open', () => {
                this.attachSocket(ws);
                this.startHeartbeat();
                this.emit('ready');
                resolve();
            });
            ws.once('error', (error) => {
                reject(error instanceof Error ? error : new Error(String(error)));
            });
        });
    }

    async connect(): Promise<void> {
        if (this.closed) return;

        this.connectionManager = new ConnectionManager(
            async () => {
                await this.openSocket();
            },
            RetryPresets.websocket,
            {
                onConnected: () => {
                    this.connectionManager?.resetAttempts();
                },
            },
        );

        await this.connectionManager.start();
    }

    private handleMessage(raw: string): void {
        if (/^pong$/i.test(raw.trim()) || raw.startsWith('PONG')) {
            return;
        }

        let envelope: HeychatWsEnvelope;
        try {
            envelope = JSON.parse(raw) as HeychatWsEnvelope;
        } catch {
            return;
        }

        if (typeof envelope.sequence === 'number') {
            if (envelope.sequence <= this.lastSequence) {
                return;
            }
            this.lastSequence = envelope.sequence;
        }

        if (!envelope.data || typeof envelope.data !== 'object') {
            envelope.data = {};
        }

        this.emit('event', envelope);
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.pingTimer = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            try {
                this.ws.ping(Buffer.from('PING'));
            } catch (error) {
                this.emit('error', error instanceof Error ? error : new Error(String(error)));
            }
        }, this.pingIntervalMs);
    }

    private stopHeartbeat(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }

    private cleanupConnection(clearManager = true): void {
        this.stopHeartbeat();
        if (this.ws) {
            try {
                this.ws.removeAllListeners();
                this.ws.close();
            } catch {
                // ignore
            }
            this.ws = null;
        }
        if (clearManager && this.connectionManager) {
            this.connectionManager.stop();
            this.connectionManager = null;
        }
    }

    close(): void {
        this.closed = true;
        this.cleanupConnection(true);
    }

    isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}
