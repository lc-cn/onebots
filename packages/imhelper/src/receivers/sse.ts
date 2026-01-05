import { Receiver } from '../receiver.js';
import { Adapter } from '../adapter.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// 对于 Node.js 环境，使用 eventsource 库
// 对于浏览器环境，使用原生 EventSource
let EventSource: typeof import('eventsource').EventSource | typeof globalThis.EventSource;
if (typeof window !== 'undefined' && 'EventSource' in window) {
    // 浏览器环境
    EventSource = window.EventSource as typeof globalThis.EventSource;
} else {
    EventSource = require('eventsource');
}

export class SSEReceiver<Id extends string | number = string | number> extends Receiver<Id> {
    private eventSource?: any;
    private reconnectTimer?: NodeJS.Timeout;
    private accessToken?: string;

    async connect(_port?: number): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const url = new URL(this.url);
                if (this.accessToken) {
                    url.searchParams.set('access_token', this.accessToken);
                }

                // 对于 Node.js 的 eventsource 库，需要传递 headers
                // 浏览器原生 EventSource 不支持 headers，但 eventsource 库支持
                const options: any = {};
                if (this.accessToken && typeof window === 'undefined') {
                    // 只在 Node.js 环境下设置 headers
                    options.headers = {
                        'Authorization': `Bearer ${this.accessToken}`,
                    };
                }

                this.eventSource = new EventSource(url.toString(), options);

                this.eventSource.onopen = () => {
                    resolve();
                };

                this.eventSource.onmessage = (event: any) => {
                    try {
                        const data = JSON.parse(event.data);
                        this.handleEvent(data);
                    } catch (error) {
                        console.error('[SSEReceiver] Failed to parse SSE message:', error);
                    }
                };

                this.eventSource.onerror = (error: any) => {
                    console.error('[SSEReceiver] SSE error:', error);
                    if (this.eventSource?.readyState === 0) {
                        // CONNECTING state, might be initial connection failure
                        reject(error);
                    } else {
                        // Other errors, schedule reconnect
                        this.scheduleReconnect();
                    }
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    async disconnect(): Promise<void> {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }

        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = undefined;
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) {
            return;
        }

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this.connect().catch((error) => {
                console.error('[SSEReceiver] SSE reconnection failed:', error);
            });
        }, 5000);
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
