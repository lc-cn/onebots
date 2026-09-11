import type { GatewayIdentity } from "./contracts.js";
import type { GatewayMessageDebugStore } from "./message-debug-store.js";
import {
    isGatewayMessageDebugRequest,
    isGatewayMessageDebugReply,
    type GatewayMessageDebugReply,
} from "./message-debug-contracts.js";

export function handleGatewayMessageDebug(
    value: unknown,
    identity: GatewayIdentity | undefined,
    store: GatewayMessageDebugStore | undefined,
    send: (reply: GatewayMessageDebugReply) => void,
): boolean {
    if (!value || typeof value !== "object") return false;
    const type = Object.getOwnPropertyDescriptor(value, "type");
    if (!type || !("value" in type) || type.value !== "gateway.message-debug") return false;
    if (
        !isGatewayMessageDebugRequest(value) ||
        !identity ||
        identity.protocolVersion !== 1 ||
        value.controlInstanceId !== identity.controlInstanceId ||
        value.gatewayInstanceId !== identity.gatewayInstanceId
    )
        return true;
    const base = {
        type: "gateway.message-debug.result" as const,
        protocolVersion: 1 as const,
        controlInstanceId: identity.controlInstanceId,
        gatewayInstanceId: identity.gatewayInstanceId,
        requestId: value.requestId,
    };
    let reply: GatewayMessageDebugReply = { ...base, action: value.action, outcome: "rejected" };
    try {
        if (store) {
            reply =
                value.action === "history"
                    ? {
                          ...base,
                          action: "history",
                          outcome: "succeeded",
                          result: { entries: store.getHistory() },
                      }
                    : { ...base, action: "clear", outcome: "succeeded", result: store.clear() };
        }
        if (!isGatewayMessageDebugReply(reply)) {
            if (store && value.action === "clear") return true;
            reply = { ...base, action: value.action, outcome: "rejected" };
        }
    } catch {
        // 清理开始后的异常结果未知，不发拒绝回执，由父进程保留未知结果。
        if (store && value.action === "clear") return true;
        reply = { ...base, action: value.action, outcome: "rejected" };
    }
    try {
        send(reply);
    } catch {
        // 父进程断连后不重发，避免把失去确认的操作当作未执行。
    }
    return true;
}
