/**
 * MCP (Model Context Protocol) v1 类型定义
 * 基于 MCP 2025-03-26 规范
 */

// ============ JSON-RPC 2.0 ============

export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: string | number | null;
    method: string;
    params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: unknown;
    error?: JsonRpcError;
}

export interface JsonRpcError {
    code: number;
    message: string;
    data?: unknown;
}

// ============ MCP 生命周期 ============

export interface McpInitializeParams {
    protocolVersion: string;
    capabilities: ClientCapabilities;
    clientInfo: Implementation;
}

export interface McpInitializeResult {
    protocolVersion: string;
    capabilities: ServerCapabilities;
    serverInfo: Implementation;
    instructions?: string;
}

export interface Implementation {
    name: string;
    version: string;
}

export interface ClientCapabilities {
    roots?: { listChanged?: boolean };
    sampling?: Record<string, unknown>;
}

export interface ServerCapabilities {
    tools?: { listChanged?: boolean };
    resources?: { subscribe?: boolean; listChanged?: boolean };
    prompts?: { listChanged?: boolean };
    logging?: Record<string, unknown>;
}

// ============ MCP Tools ============

export interface McpTool {
    name: string;
    description: string;
    inputSchema: McpToolInputSchema;
}

export interface McpToolInputSchema {
    type: 'object';
    properties?: Record<string, McpPropertySchema>;
    required?: string[];
}

export interface McpPropertySchema {
    type: string;
    description?: string;
    enum?: string[];
    items?: McpPropertySchema;
    default?: unknown;
}

export interface McpToolCallParams {
    name: string;
    arguments?: Record<string, unknown>;
}

export interface McpToolCallResult {
    content: McpContent[];
    isError?: boolean;
}

export interface McpContent {
    type: 'text' | 'image' | 'resource';
    text?: string;
    mimeType?: string;
    data?: string;
    resource?: { uri: string; mimeType?: string; text?: string };
}

// ============ MCP Notifications ============

export interface McpNotificationParams {
    level?: string;
    logger?: string;
    data?: unknown;
}

// ============ 配置 ============

export interface McpV1Config {
    access_token?: string;
    tools_whitelist?: string[];
    tools_blacklist?: string[];
}

// ============ SSE 相关 ============

export interface SseClient {
    id: string;
    res: import('node:http').ServerResponse;
    initialized: boolean;
    write(event: string, data: string): void;
    close(): void;
}
