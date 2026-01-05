import { Receiver } from '../receiver.js';
import { Adapter } from '../adapter.js';
import http from 'http';

export class WebhookReceiver<Id extends string | number = string | number> extends Receiver<Id> {
    private server?: http.Server;
    private accessToken?: string;

    async connect(port?: number): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                if (req.url === this.path && req.method === 'POST') {
                    // 验证 access_token
                    if (this.accessToken) {
                        const token = req.headers.authorization?.replace('Bearer ', '') ||
                                     new URL(req.url || '', `http://localhost`).searchParams.get('access_token');
                        
                        if (token !== this.accessToken) {
                            res.writeHead(401, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ status: 'error', message: 'Unauthorized' }));
                            return;
                        }
                    }

                    let body = '';

                    req.on('data', (chunk) => {
                        body += chunk.toString();
                    });

                    req.on('end', () => {
                        try {
                            const event = JSON.parse(body);
                            this.handleEvent(event);
                            
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ status: 'ok' }));
                        } catch (error) {
                            console.error('[WebhookReceiver] Failed to parse payload:', error);
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
                        }
                    });
                } else {
                    res.writeHead(404);
                    res.end();
                }
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
            if (this.server) {
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
            this.adapter.transformEvent!(event);
        } else {
            throw new Error('Adapter does not have transformEvent method');
        }
    }

    constructor(adapter: Adapter<Id>, public path: string, accessToken?: string) {
        super(adapter);
        this.accessToken = accessToken;
    }
}
