import { types } from "node:util";
import type { GatewayIdentity } from "./contracts.js";

export interface GatewayConfigurationInput {
    id: string;
    expected: { gatewayInstanceId: string; configVersion: string };
    nextConfigVersion: string;
    configPath: string;
}
export interface GatewayConfigurationResult {
    status: "applied" | "rolled_back" | "recovery_required" | "rejected";
    configVersion: string;
}
export interface GatewayConfigurationRequest extends GatewayIdentity {
    type: "gateway.configuration";
    requestId: string;
    action: "apply" | "query";
    operationId: string;
    expectedConfigVersion: string;
    nextConfigVersion?: string;
    configPath?: string;
}
export interface GatewayConfigurationReply extends GatewayIdentity {
    type: "gateway.configuration.result";
    requestId: string;
    operationId: string;
    outcome: "succeeded" | "rejected" | "unknown";
    result?: GatewayConfigurationResult;
}
const hash = (value: unknown): value is string =>
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
/** 不执行访问器或 Proxy；IPC 仅允许闭合的普通数据对象。 */
function data(value: unknown): value is Record<string, unknown> {
    if (
        !value ||
        typeof value !== "object" ||
        types.isProxy(value) ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
        return false;
    return Reflect.ownKeys(value).every(
        key =>
            typeof key === "string" &&
            Object.getOwnPropertyDescriptor(value, key)?.enumerable &&
            "value" in Object.getOwnPropertyDescriptor(value, key)!,
    );
}
function identity(value: Record<string, unknown>): boolean {
    return (
        value.protocolVersion === 1 &&
        id(value.controlInstanceId) &&
        id(value.gatewayInstanceId) &&
        id(value.requestId) &&
        id(value.operationId)
    );
}
export function isGatewayConfigurationRequest(
    value: unknown,
): value is GatewayConfigurationRequest {
    if (
        !data(value) ||
        value.type !== "gateway.configuration" ||
        !identity(value) ||
        !hash(value.expectedConfigVersion)
    )
        return false;
    const base = [
        "type",
        "protocolVersion",
        "controlInstanceId",
        "gatewayInstanceId",
        "requestId",
        "operationId",
        "action",
        "expectedConfigVersion",
    ];
    if (value.action === "apply") base.push("nextConfigVersion", "configPath");
    else if (value.action !== "query") return false;
    return (
        Object.keys(value).length === base.length &&
        Object.keys(value).every(key => base.includes(key)) &&
        (value.action === "query" ||
            (hash(value.nextConfigVersion) &&
                typeof value.configPath === "string" &&
                value.configPath.length <= 4096))
    );
}
export function isGatewayConfigurationReply(value: unknown): value is GatewayConfigurationReply {
    if (
        !data(value) ||
        value.type !== "gateway.configuration.result" ||
        !identity(value) ||
        typeof value.outcome !== "string" ||
        !["succeeded", "rejected", "unknown"].includes(value.outcome)
    )
        return false;
    const keys = [
        "type",
        "protocolVersion",
        "controlInstanceId",
        "gatewayInstanceId",
        "requestId",
        "operationId",
        "outcome",
    ];
    if (value.outcome === "succeeded") {
        keys.push("result");
        if (
            !data(value.result) ||
            Object.keys(value.result).sort().join(",") !== "configVersion,status" ||
            !hash(value.result.configVersion) ||
            typeof value.result.status !== "string" ||
            !["applied", "rolled_back", "recovery_required", "rejected"].includes(
                value.result.status,
            )
        )
            return false;
    }
    return (
        Object.keys(value).length === keys.length &&
        Object.keys(value).every(key => keys.includes(key))
    );
}
