import { McpClient } from './client.js';
import type { McpSseClientOptions } from './types.js';

export class McpSseClient extends McpClient {
    private readonly url: string;
    private messageEndpoint: string | null = null;
    private abortController: AbortController | null = null;

    constructor(options: McpSseClientOptions) {
        super(options);
        this.url = options.url.replace(/\/$/, '');
    }

    async connect(): Promise<void> {
        this.abortController = new AbortController();
        const sseUrl = `${this.url}/sse`;
        const headers: Record<string, string> = {};
        if (this.accessToken) {
            headers['Authorization'] = `Bearer ${this.accessToken}`;
        }

        const response = await fetch(sseUrl, {
            headers,
            signal: this.abortController.signal,
        });

        if (!response.ok) {
            throw new Error(`SSE 连接失败: ${response.status} ${response.statusText}`);
        }

        if (!response.body) {
            throw new Error('SSE 响应没有 body');
        }

        const endpointReady = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('等待 endpoint 事件超时')), 10000);
            const onEndpoint = () => {
                clearTimeout(timeout);
                resolve();
            };
            this.once('_endpoint_ready', onEndpoint);
        });

        this.readSseStream(response.body);
        await endpointReady;
        await this.initialize();
    }

    private async readSseStream(body: ReadableStream<Uint8Array>): Promise<void> {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = '';
        let currentData = '';

        const processLine = (line: string) => {
            if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
                currentData = line.slice(6);
            } else if (line === '') {
                if (currentEvent && currentData) {
                    this.handleSseEvent(currentEvent, currentData);
                }
                currentEvent = '';
                currentData = '';
            }
        };

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    processLine(line);
                }
            }
        } catch (err: any) {
            if (err.name !== 'AbortError') {
                this.emit('error', err);
            }
        } finally {
            this.initialized = false;
            this.emit('close');
        }
    }

    private handleSseEvent(event: string, data: string): void {
        if (event === 'endpoint') {
            this.messageEndpoint = data.trim();
            this.emit('_endpoint_ready');
        } else if (event === 'message') {
            this.handleResponse(data);
        }
    }

    protected send(data: string): void {
        if (!this.messageEndpoint) {
            throw new Error('SSE 连接未就绪');
        }

        const url = this.messageEndpoint.startsWith('http')
            ? this.messageEndpoint
            : `${this.url}${this.messageEndpoint}`;

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.accessToken) {
            headers['Authorization'] = `Bearer ${this.accessToken}`;
        }

        fetch(url, { method: 'POST', headers, body: data }).catch((err) => {
            this.emit('error', err);
        });
    }

    async close(): Promise<void> {
        this.abortController?.abort();
        this.abortController = null;
        this.messageEndpoint = null;
        this.initialized = false;
    }
}
