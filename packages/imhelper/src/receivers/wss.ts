import { Receiver } from '../receiver.js';
import { Adapter } from '../adapter.js';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

export class WSSReceiver<Id extends string | number = string | number> extends Receiver<Id> {
    private server?: http.Server;
    private wss?: WebSocketServer;
    private accessToken?: string;

    async connect(port?: number): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer();
            this.wss = new WebSocketServer({ 
                server: this.server,
                path: this.path,
            });

            this.wss.on('connection', (ws: WebSocket, request: http.IncomingMessage) => {
                // 验证 access_token
                if (this.accessToken) {
                    const url = new URL(request.url || '', `http://localhost`);
                    const token = url.searchParams.get('access_token') || 
                                  request.headers.authorization?.replace('Bearer ', '');
                    
                    if (token !== this.accessToken) {
                        ws.close(1008, 'Unauthorized');
                        return;
                    }
                }

                ws.on('message', (data: Buffer) => {
                    try {
                        const event = JSON.parse(data.toString());
                        this.handleEvent(event);
                    } catch (error) {
                        console.error('[WSSReceiver] Failed to parse message:', error);
                    }
                });

                ws.on('error', (error) => {
                    console.error('[WSSReceiver] WebSocket error:', error);
                });

                ws.on('close', () => {
                    // Connection closed
                });
            });

            this.server.listen(port || 8080, (error?: Error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    async disconnect(): Promise<void> {
        return new Promise((resolve) => {
            if (this.wss) {
                this.wss.close(() => {
                    if (this.server) {
                        this.server.close(() => {
                            resolve();
                        });
                    } else {
                        resolve();
                    }
                });
            } else if (this.server) {
                this.server.close(() => {
                    resolve();
                });
            } else {
                resolve();
            }
        });
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

    constructor(adapter: Adapter<Id>, public path: string, accessToken?: string) {
        super(adapter);
        this.accessToken = accessToken;
    }
}
