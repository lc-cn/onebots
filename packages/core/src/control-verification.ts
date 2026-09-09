import type { Adapter } from "./adapter.js";
import type { ControlTransport } from "./control.js";
import { verificationJson, verificationRequest } from "./control-verification-json.js";

export interface ControlVerificationCommand {
    operationId: string;
    challengeId: string;
    expected: { gatewayInstanceId: string; configVersion: string };
    action: "submit" | "request-sms";
    data?: Record<string, string>;
}
export interface ControlVerificationChallenge {
    id: string;
    createdAt: number;
    expiresAt: number;
    request: Adapter.VerificationRequest;
}
export interface ControlVerificationSnapshot {
    gatewayInstanceId: string;
    configVersion: string;
    challenges: ControlVerificationChallenge[];
}
export interface ControlVerificationOperation {
    id: string;
    challengeId: string;
    gatewayInstanceId: string;
    configVersion: string;
    action: "submit" | "request-sms";
    status: "running" | "succeeded" | "rejected" | "unknown";
    startedAt: string;
    finishedAt?: string;
}
const uuid = (value: unknown): value is string =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const bytes = (value: string): number => new TextEncoder().encode(value).length;
const bounded = (value: unknown, max: number): value is string =>
    typeof value === "string" &&
    value.length > 0 &&
    bytes(value) <= max &&
    !/[\u0000-\u001f\u007f]/u.test(value);
function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, allowed: string[], required = allowed): boolean {
    return (
        Object.keys(value).every(key => allowed.includes(key)) &&
        required.every(key => Object.hasOwn(value, key))
    );
}
function date(value: unknown): value is string {
    return (
        typeof value === "string" &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString() === value
    );
}
/** 只校验有界 JSON，不调用输入访问器；网关仍负责最终权限与挑战检查。 */
export function isControlVerificationCommand(input: unknown): input is ControlVerificationCommand {
    try {
        const value = verificationJson(input, 131072);
        if (
            !object(value) ||
            !exact(
                value,
                ["operationId", "challengeId", "expected", "action", "data"],
                ["operationId", "challengeId", "expected", "action"],
            ) ||
            !uuid(value.operationId) ||
            !uuid(value.challengeId) ||
            !object(value.expected) ||
            !exact(value.expected, ["gatewayInstanceId", "configVersion"]) ||
            !uuid(value.expected.gatewayInstanceId) ||
            !bounded(value.expected.configVersion, 256) ||
            (value.action !== "submit" && value.action !== "request-sms")
        )
            return false;
        if (!Object.hasOwn(value, "data")) return true;
        if (!object(value.data) || Object.keys(value.data).length > 32) return false;
        let total = 0;
        for (const [key, field] of Object.entries(value.data)) {
            if (
                key === "__proto__" ||
                !bounded(key, 128) ||
                !bounded(field, 16384) ||
                !field.trim()
            )
                return false;
            total += bytes(key) + bytes(field);
        }
        return total <= 32768;
    } catch {
        return false; // 不可信数据只拒绝，不记录验证答案。
    }
}
export function isControlVerificationOperation(
    input: unknown,
): input is ControlVerificationOperation {
    try {
        const value = verificationJson(input, 4096);
        if (
            !object(value) ||
            !exact(
                value,
                [
                    "id",
                    "challengeId",
                    "gatewayInstanceId",
                    "configVersion",
                    "action",
                    "status",
                    "startedAt",
                    "finishedAt",
                ],
                [
                    "id",
                    "challengeId",
                    "gatewayInstanceId",
                    "configVersion",
                    "action",
                    "status",
                    "startedAt",
                ],
            ) ||
            !uuid(value.id) ||
            !uuid(value.challengeId) ||
            !uuid(value.gatewayInstanceId) ||
            !bounded(value.configVersion, 256) ||
            (value.action !== "submit" && value.action !== "request-sms") ||
            typeof value.status !== "string" ||
            !["running", "succeeded", "rejected", "unknown"].includes(value.status) ||
            !date(value.startedAt)
        )
            return false;
        return value.status === "running"
            ? !Object.hasOwn(value, "finishedAt")
            : date(value.finishedAt) && Date.parse(value.finishedAt) >= Date.parse(value.startedAt);
    } catch {
        return false; // 坏回执不能确认为已执行。
    }
}
export function isControlVerificationSnapshot(
    input: unknown,
): input is ControlVerificationSnapshot {
    try {
        const value = verificationJson(input, 20 * 1024 * 1024 + 8192, undefined, {
            nodes: 2_001_000,
            depth: 132,
        });
        if (
            !object(value) ||
            !exact(value, ["gatewayInstanceId", "configVersion", "challenges"]) ||
            !uuid(value.gatewayInstanceId) ||
            !bounded(value.configVersion, 256) ||
            !Array.isArray(value.challenges) ||
            value.challenges.length > 20
        )
            return false;
        const ids = new Set<string>();
        return value.challenges.every(challenge => {
            if (
                !object(challenge) ||
                !exact(challenge, ["id", "createdAt", "expiresAt", "request"]) ||
                !uuid(challenge.id) ||
                ids.has(challenge.id) ||
                typeof challenge.createdAt !== "number" ||
                !Number.isSafeInteger(challenge.createdAt) ||
                challenge.createdAt < 0 ||
                typeof challenge.expiresAt !== "number" ||
                !Number.isSafeInteger(challenge.expiresAt) ||
                challenge.expiresAt <= challenge.createdAt ||
                challenge.expiresAt - challenge.createdAt > 30 * 60 * 1000 ||
                !verificationRequest(verificationJson(challenge.request))
            )
                return false;
            ids.add(challenge.id);
            return true;
        });
    } catch {
        return false; // 不可信挑战不交给客户端展示或执行。
    }
}
const unconfirmed = (): Error =>
    new Error("验证结果未确认，请查询原操作回执，不要自动重新提交或发短信");
/** 所有请求只发一次；答案只在当前调用内存在，不保存或自动重放。 */
export class ControlVerificationClient {
    constructor(private readonly transport: ControlTransport) {}

    async pending(): Promise<ControlVerificationSnapshot> {
        const result: unknown = await this.transport.request(
            "GET",
            "/api/control/verification/pending",
        );
        if (!isControlVerificationSnapshot(result)) throw new Error("账号验证列表响应无效");
        return structuredClone(result);
    }

    async operation(id: string): Promise<ControlVerificationOperation> {
        if (!uuid(id)) throw new Error("验证操作标识无效");
        const result: unknown = await this.transport.request(
            "GET",
            `/api/control/verification/operations/${id}`,
        );
        if (!isControlVerificationOperation(result) || result.id !== id) throw unconfirmed();
        return structuredClone(result);
    }

    async execute(command: ControlVerificationCommand): Promise<ControlVerificationOperation> {
        if (!isControlVerificationCommand(command)) throw new Error("验证请求无效");
        const payload = structuredClone(command);
        // 固定调用前的绑定条件，传输实现不能修改回执核对依据。
        const { operationId, challengeId, action } = payload;
        const { gatewayInstanceId, configVersion } = payload.expected;
        const result: unknown = await this.transport.request(
            "POST",
            "/api/control/verification/execute",
            payload,
        );
        if (
            !isControlVerificationOperation(result) ||
            result.status === "running" ||
            result.id !== operationId ||
            result.challengeId !== challengeId ||
            result.gatewayInstanceId !== gatewayInstanceId ||
            result.configVersion !== configVersion ||
            result.action !== action
        )
            throw unconfirmed();
        return structuredClone(result);
    }
}
