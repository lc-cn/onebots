import { types } from "node:util";
import type { ControlVerificationOperation } from "@onebots/core/control";
import { closedServiceObject } from "../service-operation-storage.js";
export class ControlVerificationError extends Error {
    constructor(public readonly httpStatus: number) {
        super("验证操作或私有存储不可用；请查询原操作，禁止自动重试");
    }
}
export interface VerificationRecord extends ControlVerificationOperation {
    schemaVersion: 1;
    ownerHash: string;
    requestDigest: string;
    accountHash: string;
}
export type VerificationOperation = ControlVerificationOperation;
export const verificationHash = (value: unknown): value is string =>
    typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
export const verificationId = (value: unknown): value is string =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function date(value: unknown): value is string {
    return (
        typeof value === "string" &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString() === value
    );
}
export function parseVerificationRecord(input: unknown): VerificationRecord {
    try {
        if (!input || typeof input !== "object" || types.isProxy(input)) throw new Error();
        const value = closedServiceObject(input, [
            "schemaVersion",
            "id",
            "ownerHash",
            "requestDigest",
            "accountHash",
            "challengeId",
            "gatewayInstanceId",
            "configVersion",
            "action",
            "status",
            "startedAt",
            ...(Object.hasOwn(input, "finishedAt") ? ["finishedAt"] : []),
            ...(Object.hasOwn(input, "resolution") ? ["resolution"] : []),
        ]);
        if (
            value.schemaVersion !== 1 ||
            !verificationId(value.id) ||
            !verificationId(value.challengeId) ||
            !verificationId(value.gatewayInstanceId) ||
            !verificationHash(value.ownerHash) ||
            !verificationHash(value.requestDigest) ||
            !verificationHash(value.accountHash) ||
            typeof value.configVersion !== "string" ||
            value.configVersion.length === 0 ||
            Buffer.byteLength(value.configVersion) > 256 ||
            /[\u0000-\u001f\u007f]/u.test(value.configVersion) ||
            typeof value.action !== "string" ||
            !["submit", "request-sms"].includes(value.action) ||
            typeof value.status !== "string" ||
            !["running", "succeeded", "rejected", "unknown"].includes(value.status) ||
            !date(value.startedAt)
        )
            throw new Error();
        if (
            value.status === "running"
                ? Object.hasOwn(value, "finishedAt")
                : !date(value.finishedAt) ||
                  Date.parse(value.finishedAt) < Date.parse(value.startedAt)
        )
            throw new Error();
        if (Object.hasOwn(value, "resolution")) {
            const resolution = closedServiceObject(value.resolution, ["outcome", "confirmedAt"]);
            if (
                value.status !== "unknown" ||
                (resolution.outcome !== "succeeded" && resolution.outcome !== "rejected") ||
                !date(resolution.confirmedAt) ||
                !date(value.finishedAt) ||
                Date.parse(resolution.confirmedAt) < Date.parse(value.finishedAt)
            )
                throw new Error();
        }
        return value as unknown as VerificationRecord;
    } catch {
        throw new ControlVerificationError(503);
    }
}
export function projectVerification(input: VerificationRecord): VerificationOperation {
    const {
        schemaVersion: _schema,
        ownerHash: _owner,
        requestDigest: _digest,
        accountHash: _account,
        ...operation
    } = parseVerificationRecord(input);
    return structuredClone(operation);
}
