import type { GatewayIdentity } from "./contracts.js";
export const MCP_FRAME_LIMIT = 64 * 1024;
export const MCP_ERRORS = [
    "MCP 请求无效",
    "MCP 网关不可用",
    "请明确选择 MCP 账号",
    "MCP 账号不可用",
    "MCP 会话不可用",
    "MCP 会话繁忙",
    "MCP 会话数量已达上限",
    "MCP 消息处理失败",
    "MCP 通知队列已满",
] as const;
export interface GatewayMcpRequest {
    action: "open" | "exchange" | "poll" | "close";
    sessionId: string;
    account?: string;
    message?: string;
}
export interface GatewayMcpResult {
    message?: string | null;
    events?: string[];
}
export interface GatewayMcpMessage extends GatewayIdentity {
    type: "gateway.mcp";
    requestId: string;
    request: GatewayMcpRequest;
}
export interface GatewayMcpReply extends GatewayIdentity {
    type: "gateway.mcp.result";
    requestId: string;
    ok: boolean;
    result?: GatewayMcpResult;
    error?: (typeof MCP_ERRORS)[number];
}
const uuid = (v: unknown): v is string =>
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function object(
    v: unknown,
    required: string[],
    optional: string[] = [],
): v is Record<string, unknown> {
    if (
        !v ||
        typeof v !== "object" ||
        Array.isArray(v) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(v))
    )
        return false;
    return (
        required.every(k => Object.hasOwn(v, k)) &&
        Reflect.ownKeys(v).every(
            k =>
                typeof k === "string" &&
                [...required, ...optional].includes(k) &&
                Boolean(Object.getOwnPropertyDescriptor(v, k)?.enumerable) &&
                "value" in Object.getOwnPropertyDescriptor(v, k)!,
        )
    );
}
export function mcpFrameFits(v: unknown): boolean {
    try {
        return Buffer.byteLength(JSON.stringify(v)) <= MCP_FRAME_LIMIT;
    } catch {
        return false;
    }
}
export function isGatewayMcpRequest(v: unknown): v is GatewayMcpRequest {
    if (!object(v, ["action", "sessionId"], ["account", "message"]) || !uuid(v.sessionId))
        return false;
    if (typeof v.action !== "string" || !["open", "exchange", "poll", "close"].includes(v.action))
        return false;
    if (
        Object.hasOwn(v, "account") &&
        (v.action !== "open" ||
            typeof v.account !== "string" ||
            v.account.length > 1024 ||
            v.account.indexOf("/") < 1 ||
            v.account.endsWith("/") ||
            /[\u0000-\u001f\u007f]/.test(v.account))
    )
        return false;
    if (v.action === "exchange" ? typeof v.message !== "string" : Object.hasOwn(v, "message"))
        return false;
    return mcpFrameFits(v);
}
export function isGatewayMcpResult(v: unknown): v is GatewayMcpResult {
    return (
        object(v, [], ["message", "events"]) &&
        (!Object.hasOwn(v, "message") || v.message === null || typeof v.message === "string") &&
        (!Object.hasOwn(v, "events") ||
            (Array.isArray(v.events) &&
                v.events.length <= 32 &&
                v.events.every(x => typeof x === "string"))) &&
        mcpFrameFits(v)
    );
}
function identity(v: Record<string, unknown>) {
    return (
        v.protocolVersion === 1 &&
        uuid(v.controlInstanceId) &&
        uuid(v.gatewayInstanceId) &&
        uuid(v.requestId)
    );
}
export function isGatewayMcpMessage(v: unknown): v is GatewayMcpMessage {
    return (
        object(v, [
            "type",
            "protocolVersion",
            "controlInstanceId",
            "gatewayInstanceId",
            "requestId",
            "request",
        ]) &&
        v.type === "gateway.mcp" &&
        identity(v) &&
        isGatewayMcpRequest(v.request) &&
        mcpFrameFits(v)
    );
}
export function isGatewayMcpReply(v: unknown): v is GatewayMcpReply {
    return (
        object(
            v,
            [
                "type",
                "protocolVersion",
                "controlInstanceId",
                "gatewayInstanceId",
                "requestId",
                "ok",
            ],
            ["result", "error"],
        ) &&
        v.type === "gateway.mcp.result" &&
        identity(v) &&
        (v.ok === true
            ? !Object.hasOwn(v, "error") && isGatewayMcpResult(v.result)
            : v.ok === false &&
              !Object.hasOwn(v, "result") &&
              MCP_ERRORS.includes(v.error as (typeof MCP_ERRORS)[number])) &&
        mcpFrameFits(v)
    );
}
