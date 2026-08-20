import { EventEmitter } from 'events';
import type {
    JsonRpcRequest,
    JsonRpcResponse,
    JsonRpcNotification,
    McpToolInfo,
    McpToolCallResult,
    McpServerInfo,
    McpClientOptions,
} from './types.js';

export abstract class McpClient extends EventEmitter {
    protected requestId = 0;
    protected pendingRequests = new Map<number, {
        resolve: (value: unknown) => void;
        reject: (reason: Error) => void;
    }>();
    protected initialized = false;
    protected serverInfo: McpServerInfo | null = null;
    protected accessToken?: string;

    constructor(options: McpClientOptions = {}) {
        super();
        this.accessToken = options.accessToken;
    }

    abstract connect(): Promise<void>;
    abstract close(): Promise<void>;
    protected abstract send(data: string): void;

    protected handleResponse(data: string): void {
        let parsed: JsonRpcResponse | JsonRpcNotification;
        try {
            parsed = JSON.parse(data);
        } catch {
            return;
        }

        if ('id' in parsed && parsed.id !== undefined) {
            const pending = this.pendingRequests.get(parsed.id as number);
            if (pending) {
                this.pendingRequests.delete(parsed.id as number);
                const response = parsed as JsonRpcResponse;
                if (response.error) {
                    pending.reject(new Error(`[${response.error.code}] ${response.error.message}`));
                } else {
                    pending.resolve(response.result);
                }
            }
        } else {
            const notification = parsed as JsonRpcNotification;
            this.emit('notification', notification);
            if (notification.method) {
                this.emit(notification.method, notification.params);
            }
        }
    }

    protected request(method: string, params?: Record<string, unknown>): Promise<unknown> {
        const id = ++this.requestId;
        const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.send(JSON.stringify(request));
        });
    }

    async initialize(): Promise<McpServerInfo> {
        const result = await this.request('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'onebots-mcp-client', version: '0.1.0' },
        }) as McpServerInfo;
        this.serverInfo = result;
        this.send(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }));
        this.initialized = true;
        return result;
    }

    async listTools(): Promise<McpToolInfo[]> {
        const result = await this.request('tools/list') as { tools: McpToolInfo[] };
        return result.tools;
    }

    async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolCallResult> {
        return await this.request('tools/call', { name, arguments: args }) as McpToolCallResult;
    }

    async ping(): Promise<void> {
        await this.request('ping');
    }

    async listResources(): Promise<{ resources: unknown[] }> {
        return await this.request('resources/list') as { resources: unknown[] };
    }

    async listPrompts(): Promise<{ prompts: unknown[] }> {
        return await this.request('prompts/list') as { prompts: unknown[] };
    }

    getServerInfo(): McpServerInfo | null {
        return this.serverInfo;
    }

    isConnected(): boolean {
        return this.initialized;
    }
}
