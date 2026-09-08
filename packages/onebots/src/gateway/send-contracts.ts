import { isControlSendRequest, type ControlSendRequest } from "@onebots/core/control";
import type { GatewayIdentity } from "./contracts.js";
export interface GatewaySendResult {
    messageId: string | null;
}
export interface GatewaySendMessage extends GatewayIdentity {
    type: "gateway.send";
    requestId: string;
    request: ControlSendRequest;
}
export interface GatewaySendReply extends GatewayIdentity {
    type: "gateway.send.result";
    requestId: string;
    operationId: string;
    configVersion: string;
    outcome: "succeeded" | "rejected" | "unknown";
    result?: GatewaySendResult;
}
const uuid = (v: unknown) =>
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function closed(v: unknown, keys: string[]): v is Record<string, unknown> {
    return Boolean(
        v &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(v)) &&
        Reflect.ownKeys(v).length === keys.length &&
        keys.every(k => {
            const d = Object.getOwnPropertyDescriptor(v, k);
            return d?.enumerable && "value" in d;
        }),
    );
}
function frame(v: unknown) {
    try {
        return Buffer.byteLength(JSON.stringify(v)) <= 65536;
    } catch {
        return false;
    }
}
function identity(v: Record<string, unknown>) {
    return (
        v.protocolVersion === 1 &&
        uuid(v.controlInstanceId) &&
        uuid(v.gatewayInstanceId) &&
        uuid(v.requestId)
    );
}
export function isGatewaySendMessage(v: unknown): v is GatewaySendMessage {
    return (
        closed(v, [
            "type",
            "protocolVersion",
            "controlInstanceId",
            "gatewayInstanceId",
            "requestId",
            "request",
        ]) &&
        v.type === "gateway.send" &&
        identity(v) &&
        isControlSendRequest(v.request) &&
        v.request.expected.gatewayInstanceId === v.gatewayInstanceId &&
        frame(v)
    );
}
export function isGatewaySendReply(v: unknown): v is GatewaySendReply {
    if (!v || typeof v !== "object") return false;
    const result = Object.hasOwn(v, "result");
    if (
        !closed(v, [
            "type",
            "protocolVersion",
            "controlInstanceId",
            "gatewayInstanceId",
            "requestId",
            "operationId",
            "configVersion",
            "outcome",
            ...(result ? ["result"] : []),
        ]) ||
        v.type !== "gateway.send.result" ||
        !identity(v) ||
        !uuid(v.operationId) ||
        typeof v.configVersion !== "string" ||
        !/^[0-9a-f]{64}$/.test(v.configVersion)
    )
        return false;
    return (
        (v.outcome === "succeeded"
            ? result &&
              closed(v.result, ["messageId"]) &&
              (v.result.messageId === null || typeof v.result.messageId === "string")
            : !result && (v.outcome === "rejected" || v.outcome === "unknown")) && frame(v)
    );
}
