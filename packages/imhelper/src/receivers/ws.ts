import { Receiver } from '../receiver.js';
import { Adapter } from '../adapter.js';
import WebSocket from 'ws';

export class WebSocketReceiver<Id extends string | number = string | number> extends Receiver<Id> {
    private ws?: WebSocket;
    private reconnectTimer?: NodeJS.Timeout;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private accessToken?: string;
    private isDisconnecting = false;

    async connect(_port?: number): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const url = new URL(this.url);
                if (this.accessToken) {
                    url.searchParams.set('access_token', this.accessToken);
                }

                const wsUrl = url.toString();
                console.log('[WebSocketReceiver] Connecting to:', wsUrl);
                this.ws = new WebSocket(wsUrl);

                this.ws.on('open', () => {
                    this.reconnectAttempts = 0;
                    console.log('[WebSocketReceiver] WebSocket connected successfully');
                    this.isDisconnecting = false; // 重置断开标志
                    resolve();
                });

                this.ws.on('message', (data: Buffer) => {
                    try {
                        const event = JSON.parse(data.toString());
                        console.log('[WebSocketReceiver] Received message:',event);
                        this.handleEvent(event);
                    } catch (error) {
                        console.error('[WebSocketReceiver] Failed to parse message:', error);
                    }
                });

                this.ws.on('error', (error) => {
                    console.error('[WebSocketReceiver] WebSocket error:', error);
                    if (this.reconnectAttempts === 0) {
                        reject(error);
                    }
                });

                this.ws.on('close', (code: number, reason: Buffer) => {
                    const reasonStr = reason.toString();
                    console.log(`[WebSocketReceiver] WebSocket closed: code=${code}, reason=${reasonStr || 'none'}, isDisconnecting=${this.isDisconnecting}`);
                    if (!this.isDisconnecting) {
                        console.log('[WebSocketReceiver] Connection closed unexpectedly, will attempt to reconnect');
                        this.scheduleReconnect();
                    } else {
                        console.log('[WebSocketReceiver] Connection closed intentionally, no reconnect');
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    async disconnect(): Promise<void> {
        console.log('[WebSocketReceiver] Disconnecting...');
        this.isDisconnecting = true;
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
            console.log('[WebSocketReceiver] Reconnect timer cleared');
        }

        if (this.ws) {
            // 移除 close 事件监听器，防止触发重连逻辑
            this.ws.removeAllListeners('close');
            this.ws.close();
            this.ws = undefined;
            console.log('[WebSocketReceiver] WebSocket closed');
        }
        
        // 不重置 isDisconnecting，因为已经断开连接了
    }

    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[WebSocketReceiver] Max reconnection attempts reached');
            return;
        }

        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;

        console.log(`[WebSocketReceiver] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.reconnectTimer = setTimeout(() => {
            console.log('[WebSocketReceiver] Attempting to reconnect...');
            this.connect().catch((error) => {
                console.error('[WebSocketReceiver] Reconnection failed:', error);
            });
        }, delay);
    }

    private handleEvent(event: any): void {
        // 直接调用 adapter 的 transformEvent 方法进行转换
        // transformEvent 会负责 emit 所有需要的事件（包括 'event' 和 'message.*'）
        this.transformToMessage(event);
    }

    private transformToMessage(event: unknown): void {
        // 如果 adapter 有 transformEvent 方法，使用它
        if (this.adapter.transformEvent) {
            this.adapter.transformEvent(event);
        }else{
            throw new Error('Adapter does not have transformEvent method');
        }
    }

    constructor(adapter: Adapter<Id>, public url: string, accessToken?: string) {
        super(adapter);
        this.accessToken = accessToken;
    }
}
