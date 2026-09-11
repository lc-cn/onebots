import type { GatewayIdentity } from "./contracts.js";
import {
    isGatewaySendMessage,
    isGatewaySendReply,
    type GatewaySendReply,
} from "./send-contracts.js";
import type { GatewaySendExecutor } from "./send-executor.js";
export function handleGatewaySendMessage(
    value: unknown,
    identity: GatewayIdentity | undefined,
    executor: GatewaySendExecutor | undefined,
    send: (reply: GatewaySendReply) => void,
): boolean {
    if (
        !value ||
        typeof value !== "object" ||
        (value as { type?: unknown }).type !== "gateway.send"
    )
        return false;
    if (
        !isGatewaySendMessage(value) ||
        !identity ||
        value.controlInstanceId !== identity.controlInstanceId ||
        value.gatewayInstanceId !== identity.gatewayInstanceId
    )
        return true;
    void (async () => {
        let outcome = executor
            ? await executor.send(value.request)
            : { outcome: "rejected" as const };
        const base = {
            type: "gateway.send.result" as const,
            protocolVersion: 1 as const,
            controlInstanceId: identity.controlInstanceId,
            gatewayInstanceId: identity.gatewayInstanceId,
            requestId: value.requestId,
            operationId: value.request.id,
            configVersion: value.request.expected.configVersion,
        };
        let reply: GatewaySendReply = { ...base, ...outcome };
        if (!isGatewaySendReply(reply)) reply = { ...base, outcome: "unknown" };
        send(reply);
    })().catch(() => {
        /* 断连不重放；不输出平台异常或消息内容。 */
    });
    return true;
}
