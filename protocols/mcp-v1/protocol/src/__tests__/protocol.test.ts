import { describe, it, expect, vi } from 'vitest';

vi.mock('onebots', () => {
    class Protocol {
        public logger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            trace: vi.fn(),
        };
        public router = { get: vi.fn(), post: vi.fn() };
        public path = '/qq/bot/mcp/v1';
        public config: Record<string, unknown>;
        public adapter: unknown;
        public account: unknown;
        public filterFn = () => true;

        constructor(
            public _adapter: unknown,
            public _account: unknown,
            cfg: unknown,
        ) {
            this.adapter = _adapter;
            this.account = _account;
            this.config = (cfg ?? {}) as Record<string, unknown>;
        }

        removeAllListeners() {}
    }

    return {
        Protocol,
        ProtocolRegistry: {
            registerSchema: vi.fn(),
            register: vi.fn(),
        },
        App: {
            registerGeneral: vi.fn(),
        },
        Account: class {},
        Adapter: class {},
        CommonEvent: {},
        CommonTypes: {},
    };
});

const { McpV1Protocol } = await import('../index.js');

function createProtocol(config: Record<string, unknown> = {}) {
    const adapter = {
        resolveId: vi.fn((id: string | number) => ({
            string: String(id),
            number: typeof id === 'number' ? id : parseInt(id, 10) || 0,
            source: String(id),
        })),
        getLoginInfo: vi.fn().mockResolvedValue({
            user_id: { string: 'bot_123', number: 123 },
            user_name: 'TestBot',
            avatar: 'https://example.com/avatar.png',
        }),
        getGroupList: vi.fn().mockResolvedValue([]),
        getFriendList: vi.fn().mockResolvedValue([]),
        getStatus: vi.fn().mockResolvedValue({ online: true, good: true }),
        sendMessage: vi.fn().mockResolvedValue({
            message_id: { string: 'msg_1', number: 1, source: 'msg_1' },
        }),
    };

    const account = { platform: 'qq', account_id: 'bot_123' };

    const protocol = new McpV1Protocol(
        adapter as never,
        account as never,
        { protocol: 'mcp', version: 'v1', ...config } as never,
    );

    return { adapter, account, protocol };
}

describe('McpV1Protocol handleJsonRpc', () => {
    it('responds to initialize', async () => {
        const { protocol } = createProtocol();
        const response = await protocol.handleJsonRpc({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'test', version: '0.1.0' },
            },
        });

        expect(response.jsonrpc).toBe('2.0');
        expect(response.id).toBe(1);
        expect(response.error).toBeUndefined();

        const result = response.result as Record<string, unknown>;
        expect(result.protocolVersion).toBe('2025-03-26');
        expect(result.serverInfo).toEqual({
            name: 'onebots-mcp',
            version: '0.1.0',
        });
        expect(result.capabilities).toBeDefined();
    });

    it('responds to initialized notification', async () => {
        const { protocol } = createProtocol();
        const response = await protocol.handleJsonRpc({
            jsonrpc: '2.0',
            id: 2,
            method: 'initialized',
        });

        expect(response.result).toEqual({});
        expect(response.error).toBeUndefined();
    });

    it('responds to ping', async () => {
        const { protocol } = createProtocol();
        const response = await protocol.handleJsonRpc({
            jsonrpc: '2.0',
            id: 3,
            method: 'ping',
        });

        expect(response.result).toEqual({});
        expect(response.error).toBeUndefined();
    });

    it('lists tools', async () => {
        const { protocol } = createProtocol();
        const response = await protocol.handleJsonRpc({
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/list',
        });

        expect(response.error).toBeUndefined();
        const result = response.result as { tools: unknown[] };
        expect(result.tools).toBeDefined();
        expect(result.tools.length).toBeGreaterThan(0);
    });

    it('lists tools with whitelist filter', async () => {
        const { protocol } = createProtocol({
            tools_whitelist: ['get_login_info', 'get_status'],
        });
        const response = await protocol.handleJsonRpc({
            jsonrpc: '2.0',
            id: 5,
            method: 'tools/list',
        });

        const result = response.result as { tools: { name: string }[] };
        expect(result.tools).toHaveLength(2);
        expect(result.tools.map(t => t.name).sort()).toEqual(['get_login_info', 'get_status']);
    });

    it('calls a tool successfully', async () => {
        const { protocol } = createProtocol();
        const response = await protocol.handleJsonRpc({
            jsonrpc: '2.0',
            id: 6,
            method: 'tools/call',
            params: { name: 'get_status', arguments: {} },
        });

        expect(response.error).toBeUndefined();
        const result = response.result as { content: { text: string }[]; isError?: boolean };
        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.online).toBe(true);
    });

    it('rejects disabled tool call', async () => {
        const { protocol } = createProtocol({
            tools_whitelist: ['get_login_info'],
        });
        const response = await protocol.handleJsonRpc({
            jsonrpc: '2.0',
            id: 7,
            method: 'tools/call',
            params: { name: 'get_status', arguments: {} },
        });

        expect(response.error).toBeUndefined();
        const result = response.result as { content: { text: string }[]; isError: boolean };
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('不可用');
    });

    it('returns empty resources list', async () => {
        const { protocol } = createProtocol();
        const response = await protocol.handleJsonRpc({
            jsonrpc: '2.0',
            id: 8,
            method: 'resources/list',
        });

        expect(response.result).toEqual({ resources: [] });
    });

    it('returns empty prompts list', async () => {
        const { protocol } = createProtocol();
        const response = await protocol.handleJsonRpc({
            jsonrpc: '2.0',
            id: 9,
            method: 'prompts/list',
        });

        expect(response.result).toEqual({ prompts: [] });
    });

    it('returns error for unknown method', async () => {
        const { protocol } = createProtocol();
        const response = await protocol.handleJsonRpc({
            jsonrpc: '2.0',
            id: 10,
            method: 'unknown/method',
        });

        expect(response.error).toBeDefined();
        expect(response.error!.code).toBe(-32601);
        expect(response.error!.message).toContain('未知方法');
    });
});

describe('McpV1Protocol handleStdioMessage', () => {
    it('parses valid JSON-RPC and returns response', async () => {
        const { protocol } = createProtocol();
        const line = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'ping',
        });
        const result = await protocol.handleStdioMessage(line);
        expect(result).not.toBeNull();

        const parsed = JSON.parse(result!);
        expect(parsed.jsonrpc).toBe('2.0');
        expect(parsed.id).toBe(1);
        expect(parsed.result).toEqual({});
    });

    it('returns parse error for invalid JSON', async () => {
        const { protocol } = createProtocol();
        const result = await protocol.handleStdioMessage('not valid json');
        expect(result).not.toBeNull();

        const parsed = JSON.parse(result!);
        expect(parsed.error.code).toBe(-32700);
    });

    it('returns error for non JSON-RPC 2.0', async () => {
        const { protocol } = createProtocol();
        const result = await protocol.handleStdioMessage(JSON.stringify({
            id: 1,
            method: 'ping',
        }));
        expect(result).not.toBeNull();

        const parsed = JSON.parse(result!);
        expect(parsed.error.code).toBe(-32600);
    });

    it('returns null for initialized notification', async () => {
        const { protocol } = createProtocol();
        const result = await protocol.handleStdioMessage(JSON.stringify({
            jsonrpc: '2.0',
            method: 'initialized',
        }));
        expect(result).toBeNull();
    });
});

describe('McpV1Protocol lifecycle', () => {
    it('start logs startup message', () => {
        const { protocol } = createProtocol();
        protocol.start();
        expect(protocol.logger.info).toHaveBeenCalled();
    });

    it('stop clears state', async () => {
        const { protocol } = createProtocol();
        await protocol.stop();
        expect(protocol.logger.info).toHaveBeenCalled();
    });
});
