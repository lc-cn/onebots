export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
}

export interface McpToolInfo {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export interface McpToolCallResult {
    content: { type: string; text: string }[];
    isError?: boolean;
}

export interface McpServerInfo {
    protocolVersion: string;
    capabilities: Record<string, unknown>;
    serverInfo: { name: string; version: string };
    instructions?: string;
}

export interface McpClientOptions {
    accessToken?: string;
}

export interface McpStdioClientOptions extends McpClientOptions {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
}

export interface McpSseClientOptions extends McpClientOptions {
    url: string;
}
