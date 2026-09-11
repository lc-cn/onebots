import type { GatewayIdentity } from "./contracts.js";
import {
    isGatewayMcpMessage,
    isGatewayMcpReply,
    MCP_ERRORS,
    type GatewayMcpReply,
} from "./mcp-contracts.js";
import type { GatewayMcpSessions } from "./mcp-sessions.js";
/** 私有握手身份不符时无响应；不允许陌生请求触及实际账号。 */
export function handleGatewayMcpMessage(
    value: unknown,
    identity: GatewayIdentity | undefined,
    sessions: GatewayMcpSessions | undefined,
    send: (reply: GatewayMcpReply) => void,
): boolean {
    if (!value || typeof value !== "object" || (value as { type?: unknown }).type !== "gateway.mcp")
        return false;
    if (
        !isGatewayMcpMessage(value) ||
        !identity ||
        value.controlInstanceId !== identity.controlInstanceId ||
        value.gatewayInstanceId !== identity.gatewayInstanceId
    )
        return true;
    const base = {
        type: "gateway.mcp.result" as const,
        protocolVersion: 1 as const,
        controlInstanceId: identity.controlInstanceId,
        gatewayInstanceId: identity.gatewayInstanceId,
        requestId: value.requestId,
    };
    void (async () => {
        let reply: GatewayMcpReply;
        try {
            if (!sessions) throw new Error(MCP_ERRORS[1]);
            const result = await sessions.request(value.request);
            reply = { ...base, ok: true, result };
            if (!isGatewayMcpReply(reply)) throw new Error(MCP_ERRORS[7]);
        } catch (error) {
            const known =
                error instanceof Error &&
                MCP_ERRORS.includes(error.message as (typeof MCP_ERRORS)[number]);
            reply = {
                ...base,
                ok: false,
                error: known
                    ? ((error as Error).message as (typeof MCP_ERRORS)[number])
                    : MCP_ERRORS[7],
            };
        }
        send(reply);
    })().catch(() => {
        /* IPC 已断连时不打印消息内容。 */
    });
    return true;
}
