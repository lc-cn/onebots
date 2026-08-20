import { Protocol, ProtocolRegistry, Account, Adapter, CommonEvent } from 'onebots';
import type { Schema } from 'onebots';
import type {
    McpV1Config,
    JsonRpcRequest,
    JsonRpcResponse,
    McpInitializeParams,
    McpInitializeResult,
    McpToolCallParams,
    SseClient,
} from './types.js';
import { MCP_TOOLS, executeTool, filterTools } from './tools.js';
import './config.js';

const PROTOCOL_VERSION = '2025-03-26';
const SERVER_NAME = 'onebots-mcp';
const SERVER_VERSION = '0.1.0';

const mcpV1Schema: Schema = {
    access_token: { type: 'string', label: 'Access Token（鉴权）' },
    tools_whitelist: { type: 'array', label: '工具白名单（留空则全部启用）' },
    tools_blacklist: { type: 'array', label: '工具黑名单' },
};

ProtocolRegistry.registerSchema('mcp.v1', mcpV1Schema);

export class McpV1Protocol extends Protocol<'v1', McpV1Config> {
    public readonly name = 'mcp';
    public readonly version = 'v1' as const;

    private sseClients: Map<string, SseClient> = new Map();
    private clientIdCounter = 0;

    constructor(adapter: Adapter, account: Account, config: McpV1Config) {
        super(adapter, account, {
            ...config,
            protocol: 'mcp',
            version: 'v1',
        });
    }

    // ============ 生命周期 ============

    start(): void {
        this.startSseTransport();
        this.logger.info(`MCP v1 协议已启动 | SSE: ${this.path}/sse | 消息: ${this.path}/message`);
    }

    async stop(_force?: boolean): Promise<void> {
        for (const client of this.sseClients.values()) {
            client.close();
        }
        this.sseClients.clear();
        this.removeAllListeners();
        this.logger.info('MCP v1 协议已停止');
    }

    // ============ 事件分发 ============

    dispatch(event: any): void {
        if (!this.filterFn(event)) return;

        const notification = this.convertToMcpNotification(event);
        if (!notification) return;

        const data = JSON.stringify(notification);
        for (const client of this.sseClients.values()) {
            if (client.initialized) {
                client.write('message', data);
            }
        }
    }

    format(event: string, payload: any): any {
        return { event, ...payload };
    }

    async apply(action: string, params?: any): Promise<any> {
        return this.handleJsonRpc({
            jsonrpc: '2.0',
            id: Date.now(),
            method: action,
            params,
        });
    }

    // ============ JSON-RPC 处理 ============

    async handleJsonRpc(request: JsonRpcRequest): Promise<JsonRpcResponse> {
        const { id, method, params } = request;

        try {
            let result: unknown;

            switch (method) {
                case 'initialize':
                    result = this.handleInitialize(params as unknown as McpInitializeParams);
                    break;

                case 'initialized':
                    result = {};
                    break;

                case 'ping':
                    result = {};
                    break;

                case 'tools/list':
                    result = this.handleToolsList();
                    break;

                case 'tools/call':
                    result = await this.handleToolCall(params as unknown as McpToolCallParams);
                    break;

                case 'resources/list':
                    result = { resources: [] };
                    break;

                case 'prompts/list':
                    result = { prompts: [] };
                    break;

                default:
                    return {
                        jsonrpc: '2.0',
                        id,
                        error: { code: -32601, message: `未知方法: ${method}` },
                    };
            }

            return { jsonrpc: '2.0', id, result };
        } catch (err: any) {
            return {
                jsonrpc: '2.0',
                id,
                error: { code: -32603, message: err.message || String(err) },
            };
        }
    }

    // ============ MCP 方法实现 ============

    private handleInitialize(_params: McpInitializeParams): McpInitializeResult {
        return {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
                tools: { listChanged: false },
                resources: { subscribe: false, listChanged: false },
                prompts: { listChanged: false },
                logging: {},
            },
            serverInfo: {
                name: SERVER_NAME,
                version: SERVER_VERSION,
            },
            instructions: `OneBots MCP 服务 — 平台: ${this.account.platform}, 账号: ${this.account.account_id}`,
        };
    }

    private handleToolsList() {
        const tools = filterTools(
            MCP_TOOLS,
            this.config.tools_whitelist,
            this.config.tools_blacklist,
        );
        return { tools };
    }

    private async handleToolCall(params: McpToolCallParams) {
        const { name, arguments: args } = params;

        const availableTools = filterTools(
            MCP_TOOLS,
            this.config.tools_whitelist,
            this.config.tools_blacklist,
        );
        if (!availableTools.find(t => t.name === name)) {
            return {
                content: [{ type: 'text' as const, text: `Tool "${name}" 不可用或已被禁用` }],
                isError: true,
            };
        }

        return executeTool(this.adapter, this.account.account_id, name, args ?? {});
    }

    // ============ HTTP/SSE 传输 ============

    private startSseTransport(): void {
        // GET /{platform}/{account_id}/mcp/v1/sse — SSE 连接
        this.router.get(`${this.path}/sse`, (ctx) => {
            if (!this.verifyToken(ctx)) {
                ctx.status = 401;
                ctx.body = { error: 'Unauthorized' };
                return;
            }

            const clientId = `sse_${++this.clientIdCounter}`;
            ctx.set('Content-Type', 'text/event-stream');
            ctx.set('Cache-Control', 'no-cache');
            ctx.set('Connection', 'keep-alive');
            ctx.set('X-Accel-Buffering', 'no');

            ctx.status = 200;
            ctx.respond = false;

            const res = ctx.res;
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            });

            const client: SseClient = {
                id: clientId,
                res,
                initialized: false,
                write(event: string, data: string) {
                    res.write(`event: ${event}\ndata: ${data}\n\n`);
                },
                close() {
                    try { res.end(); } catch {}
                },
            };

            this.sseClients.set(clientId, client);
            this.logger.info(`SSE 客户端已连接: ${clientId}`);

            // 发送 endpoint 事件，告知客户端消息端点
            const messageUrl = `${this.path}/message?session_id=${clientId}`;
            client.write('endpoint', messageUrl);

            res.on('close', () => {
                this.sseClients.delete(clientId);
                this.logger.info(`SSE 客户端已断开: ${clientId}`);
            });
        });

        // POST /{platform}/{account_id}/mcp/v1/message — JSON-RPC 消息
        this.router.post(`${this.path}/message`, async (ctx) => {
            if (!this.verifyToken(ctx)) {
                ctx.status = 401;
                ctx.body = { error: 'Unauthorized' };
                return;
            }

            const sessionId = ctx.query.session_id as string;
            const client = sessionId ? this.sseClients.get(sessionId) : undefined;

            const body = (ctx.request as any).body;
            if (!body || body.jsonrpc !== '2.0') {
                ctx.status = 400;
                ctx.body = { error: '请求必须是 JSON-RPC 2.0 格式' };
                return;
            }

            const request = body as JsonRpcRequest;

            // 标记客户端已初始化（收到 initialized 通知后开始推送事件）
            if (request.method === 'initialized' && client) {
                client.initialized = true;
            }

            // 处理 initialize 时也标记
            if (request.method === 'initialize' && client) {
                client.initialized = true;
            }

            const response = await this.handleJsonRpc(request);

            // 通知类消息（没有 id）不需要响应
            if (request.id === undefined || request.id === null) {
                ctx.status = 204;
                return;
            }

            ctx.body = response;
        });
    }

    // ============ Stdio 传输入口（供外部调用） ============

    async handleStdioMessage(line: string): Promise<string | null> {
        let request: JsonRpcRequest;
        try {
            request = JSON.parse(line);
        } catch {
            const err: JsonRpcResponse = {
                jsonrpc: '2.0',
                id: 0,
                error: { code: -32700, message: 'JSON 解析错误' },
            };
            return JSON.stringify(err);
        }

        if (request.jsonrpc !== '2.0') {
            const err: JsonRpcResponse = {
                jsonrpc: '2.0',
                id: request.id ?? 0,
                error: { code: -32600, message: '必须使用 JSON-RPC 2.0' },
            };
            return JSON.stringify(err);
        }

        // 标记初始化
        if (request.method === 'initialized') {
            return null;
        }

        const response = await this.handleJsonRpc(request);

        // 通知类消息不需要响应
        if (request.id === undefined || request.id === null) {
            return null;
        }

        return JSON.stringify(response);
    }

    sendStdioNotification(notification: Record<string, unknown>): string {
        return JSON.stringify({
            jsonrpc: '2.0',
            ...notification,
        });
    }

    // ============ 事件转 MCP 通知 ============

    private convertToMcpNotification(event: CommonEvent.Event): Record<string, unknown> | null {
        if (event.type === 'message') {
            const msg = event as CommonEvent.Message;
            return {
                method: 'notifications/message',
                params: {
                    platform: this.account.platform,
                    account_id: this.account.account_id,
                    message_type: msg.message_type,
                    message_id: msg.message_id?.string,
                    sender: {
                        id: msg.sender?.id?.string,
                        name: msg.sender?.name,
                    },
                    group: msg.group ? {
                        id: msg.group.id?.string,
                        name: msg.group.name,
                    } : undefined,
                    raw_message: msg.raw_message,
                    timestamp: msg.timestamp,
                },
            };
        }

        if (event.type === 'notice') {
            const notice = event as CommonEvent.Notice;
            return {
                method: 'notifications/notice',
                params: {
                    platform: this.account.platform,
                    account_id: this.account.account_id,
                    notice_type: notice.notice_type,
                    sub_type: notice.sub_type,
                    user: notice.user ? { id: notice.user.id?.string, name: notice.user.name } : undefined,
                    group: notice.group ? { id: notice.group.id?.string, name: notice.group.name } : undefined,
                    operator: notice.operator ? { id: notice.operator.id?.string, name: notice.operator.name } : undefined,
                    timestamp: notice.timestamp,
                },
            };
        }

        return null;
    }

    // ============ 鉴权 ============

    private verifyToken(ctx: any): boolean {
        if (!this.config.access_token) return true;
        const authHeader = ctx.headers?.authorization;
        const token = (typeof authHeader === 'string'
            ? authHeader.replace(/^Bearer\s+/i, '').trim()
            : undefined) || ctx.query?.access_token;
        return token === this.config.access_token;
    }
}

ProtocolRegistry.register('mcp', 'v1', McpV1Protocol, {
    displayName: 'MCP (Model Context Protocol)',
    description: 'MCP v1 协议 — 让 AI Agent 通过标准化接口调用 IM 能力',
});

export * from './types.js';
export * from './tools.js';
export * from './config.js';
export * from './stdio.js';
