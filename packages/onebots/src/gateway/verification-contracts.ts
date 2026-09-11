import { types } from "node:util";
import type { GatewayIdentity } from "./contracts.js";
import {
    isGatewayVerificationChallenge,
    type GatewayVerificationChallenge,
} from "./verification-store.js";
import {
    isGatewayVerificationCommand,
    type GatewayVerificationCommand,
    type GatewayVerificationQuery,
    type GatewayVerificationState,
} from "./verification-executor.js";

export type GatewayVerificationRequest = GatewayIdentity & {
    type: "gateway.verification";
    requestId: string;
    configVersion: string;
} & (
        | { action: "list" }
        | { action: "execute"; command: GatewayVerificationCommand }
        | ({ action: "query" } & GatewayVerificationQuery)
    );
export type GatewayVerificationReply = GatewayIdentity & {
    type: "gateway.verification.result";
    requestId: string;
    configVersion: string;
} & (
        | { action: "list"; outcome: "succeeded"; challenges: GatewayVerificationChallenge[] }
        | { action: "list"; outcome: "rejected" }
        | ({
              action: "query";
              outcome: "succeeded";
              state: GatewayVerificationState;
          } & GatewayVerificationQuery)
        | { action: "execute"; operationId: string; outcome: "succeeded" | "rejected" | "unknown" }
    );
const base = [
    "type",
    "protocolVersion",
    "controlInstanceId",
    "gatewayInstanceId",
    "requestId",
    "configVersion",
    "action",
];
const uuid = (v: unknown) =>
    typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
function object(v: unknown): v is Record<string, unknown> {
    if (
        !v ||
        typeof v !== "object" ||
        types.isProxy(v) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(v))
    )
        return false;
    return Reflect.ownKeys(v).every(key => {
        if (typeof key !== "string") return false;
        const d = Object.getOwnPropertyDescriptor(v, key);
        return d?.enumerable && "value" in d;
    });
}
function exact(v: Record<string, unknown>, fields: string[]): boolean {
    return (
        Reflect.ownKeys(v).length === fields.length && fields.every(key => Object.hasOwn(v, key))
    );
}
function identity(v: Record<string, unknown>): boolean {
    return (
        v.protocolVersion === 1 &&
        uuid(v.controlInstanceId) &&
        uuid(v.gatewayInstanceId) &&
        uuid(v.requestId) &&
        typeof v.configVersion === "string" &&
        v.configVersion.length > 0 &&
        v.configVersion.length <= 256
    );
}
function queryIdentity(v: Record<string, unknown>): boolean {
    return (
        uuid(v.operationId) &&
        uuid(v.challengeId) &&
        (v.verificationAction === "submit" || v.verificationAction === "request-sms")
    );
}
export function isGatewayVerificationRequest(v: unknown): v is GatewayVerificationRequest {
    try {
        if (!object(v) || !identity(v) || v.type !== "gateway.verification") return false;
        if (v.action === "list") return exact(v, base);
        if (v.action === "query")
            return (
                exact(v, [...base, "operationId", "challengeId", "verificationAction"]) &&
                queryIdentity(v)
            );
        return (
            v.action === "execute" &&
            exact(v, [...base, "command"]) &&
            isGatewayVerificationCommand(v.command) &&
            v.command.expected.gatewayInstanceId === v.gatewayInstanceId &&
            v.command.expected.configVersion === v.configVersion
        );
    } catch {
        return false; /* 无效帧不触发验证副作用。 */
    }
}
export function isGatewayVerificationReply(v: unknown): v is GatewayVerificationReply {
    try {
        if (!object(v) || !identity(v) || v.type !== "gateway.verification.result") return false;
        if (v.action === "query")
            return (
                exact(v, [
                    ...base,
                    "operationId",
                    "challengeId",
                    "verificationAction",
                    "outcome",
                    "state",
                ]) &&
                queryIdentity(v) &&
                v.outcome === "succeeded" &&
                typeof v.state === "string" &&
                ["missing", "running", "succeeded", "rejected", "unknown"].includes(v.state)
            );
        if (v.action === "execute")
            return (
                exact(v, [...base, "operationId", "outcome"]) &&
                uuid(v.operationId) &&
                typeof v.outcome === "string" &&
                ["succeeded", "rejected", "unknown"].includes(v.outcome)
            );
        if (v.action !== "list") return false;
        if (v.outcome === "rejected") return exact(v, [...base, "outcome"]);
        if (v.outcome !== "succeeded" || !exact(v, [...base, "outcome", "challenges"]))
            return false;
        const list = v.challenges;
        if (
            !Array.isArray(list) ||
            types.isProxy(list) ||
            Object.getPrototypeOf(list) !== Array.prototype ||
            list.length > 20 ||
            Reflect.ownKeys(list).length !== list.length + 1
        )
            return false;
        const ids = new Set<string>();
        for (let i = 0; i < list.length; i++) {
            const d = Object.getOwnPropertyDescriptor(list, String(i));
            if (
                !d?.enumerable ||
                !("value" in d) ||
                !isGatewayVerificationChallenge(d.value) ||
                ids.has(d.value.id)
            )
                return false;
            ids.add(d.value.id);
        }
        // 在逐项无副作用校验之后限制整个列表帧，而不只限制单张二维码。
        return Buffer.byteLength(JSON.stringify(v)) <= 20 * 1024 * 1024 + 8192;
    } catch {
        return false; /* 坏响应不能被当作成功收据。 */
    }
}
