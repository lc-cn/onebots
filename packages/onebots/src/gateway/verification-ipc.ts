import { types } from "node:util";
import type { GatewayStartMessage } from "./contracts.js";
import type { GatewayVerificationStore } from "./verification-store.js";
import type { GatewayVerificationExecutor } from "./verification-executor.js";
import {
    isGatewayVerificationRequest,
    isGatewayVerificationReply,
    type GatewayVerificationReply,
} from "./verification-contracts.js";

export function handleGatewayVerification(
    value: unknown,
    identity: GatewayStartMessage | undefined,
    store: GatewayVerificationStore | undefined,
    executor: GatewayVerificationExecutor | undefined,
    send: (reply: GatewayVerificationReply) => void,
): boolean {
    if (!value || typeof value !== "object" || types.isProxy(value)) return false;
    const kind = Object.getOwnPropertyDescriptor(value, "type");
    if (!kind || !("value" in kind) || kind.value !== "gateway.verification") return false;
    if (
        !isGatewayVerificationRequest(value) ||
        !identity ||
        value.controlInstanceId !== identity.controlInstanceId ||
        value.gatewayInstanceId !== identity.gatewayInstanceId ||
        value.configVersion !== identity.configVersion
    )
        return true;
    const base = {
        type: "gateway.verification.result" as const,
        protocolVersion: 1 as const,
        controlInstanceId: identity.controlInstanceId,
        gatewayInstanceId: identity.gatewayInstanceId,
        configVersion: identity.configVersion,
        requestId: value.requestId,
    };
    const deliver = (reply: GatewayVerificationReply) => {
        try {
            if (isGatewayVerificationReply(reply)) send(reply);
        } catch {
            /* 断连后不重发；管理端保留结果未知。 */
        }
    };
    if (value.action === "list") {
        try {
            const reply: GatewayVerificationReply = store
                ? { ...base, action: "list", outcome: "succeeded", challenges: store.list() }
                : { ...base, action: "list", outcome: "rejected" };
            deliver(
                isGatewayVerificationReply(reply)
                    ? reply
                    : { ...base, action: "list", outcome: "rejected" },
            );
        } catch {
            deliver({ ...base, action: "list", outcome: "rejected" });
        }
    } else if (value.action === "query") {
        deliver({
            ...base,
            action: "query",
            operationId: value.operationId,
            challengeId: value.challengeId,
            verificationAction: value.verificationAction,
            outcome: "succeeded",
            state: executor ? executor.query(value).state : "unknown",
        });
    } else {
        const reply = {
            ...base,
            action: "execute" as const,
            operationId: value.command.operationId,
        };
        if (!executor) deliver({ ...reply, outcome: "rejected" });
        else
            void executor.execute(value.command).then(
                result => deliver({ ...reply, outcome: result.outcome }),
                () => deliver({ ...reply, outcome: "unknown" }),
            );
    }
    return true;
}
