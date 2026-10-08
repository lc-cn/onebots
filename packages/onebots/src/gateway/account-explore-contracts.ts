import {
    isControlAccountExploreRequest,
    isControlAccountExploreResult,
    type ControlAccountExploreRequest,
    type ControlAccountExploreResult,
} from "@onebots/core/control";
import type { GatewayIdentity } from "./contracts.js";
import {
    isAccountExploreErrorCode,
    type AccountExploreErrorCode,
} from "./account-explore-errors.js";

export interface GatewayAccountExploreRequest extends GatewayIdentity {
    type: "gateway.account-explore";
    requestId: string;
    request: ControlAccountExploreRequest;
}
export interface GatewayAccountExploreReply extends GatewayIdentity {
    type: "gateway.account-explore.result";
    requestId: string;
    outcome: "succeeded" | "rejected";
    result?: ControlAccountExploreResult;
    code?: AccountExploreErrorCode;
}
const uuid = (value: unknown): value is string =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function identity(value: Record<string, unknown>): boolean {
    return (
        value.protocolVersion === 1 &&
        uuid(value.controlInstanceId) &&
        uuid(value.gatewayInstanceId) &&
        uuid(value.requestId)
    );
}
function closed(value: unknown, keys: string[]): value is Record<string, unknown> {
    return (
        !!value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === keys.length &&
        keys.every(key => Object.hasOwn(value, key))
    );
}
export function isGatewayAccountExploreRequest(
    value: unknown,
): value is GatewayAccountExploreRequest {
    if (
        !closed(value, [
            "type",
            "protocolVersion",
            "controlInstanceId",
            "gatewayInstanceId",
            "requestId",
            "request",
        ])
    )
        return false;
    return (
        value.type === "gateway.account-explore" &&
        identity(value) &&
        isControlAccountExploreRequest(value.request) &&
        value.request.expected.gatewayInstanceId === value.gatewayInstanceId
    );
}
export function isGatewayAccountExploreReply(value: unknown): value is GatewayAccountExploreReply {
    if (!value || typeof value !== "object") return false;
    const hasResult = Object.hasOwn(value, "result");
    const hasCode = Object.hasOwn(value, "code");
    if (
        !closed(value, [
            "type",
            "protocolVersion",
            "controlInstanceId",
            "gatewayInstanceId",
            "requestId",
            "outcome",
            ...(hasResult ? ["result"] : []),
            ...(hasCode ? ["code"] : []),
        ])
    )
        return false;
    return (
        value.type === "gateway.account-explore.result" &&
        identity(value) &&
        (value.outcome === "succeeded"
            ? !hasCode && hasResult && isControlAccountExploreResult(value.result)
            : value.outcome === "rejected" &&
              !hasResult &&
              (!hasCode || isAccountExploreErrorCode(value.code)))
    );
}
