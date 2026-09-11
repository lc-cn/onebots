import { createHash } from "node:crypto";
import {
    isControlSendRequest,
    isControlSendOperation,
    type ControlSendRequest,
    type ControlSendOperation,
} from "@onebots/core/control";
import { canonicalServiceJson, closedServiceObject } from "../service-operation-storage.js";
export class ControlSendError extends Error {
    constructor(public readonly httpStatus: number) {
        super("发送请求或操作状态不可用；请查询原操作，禁止自动重发");
    }
}
export interface SendRecord extends ControlSendOperation {
    schemaVersion: 1;
    ownerHash: string;
    requestDigest: string;
}
export const sendHash = (value: unknown): value is string =>
    typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
export const sendId = (value: unknown): value is string =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export function parseSendRequest(value: unknown): ControlSendRequest {
    try {
        if (!isControlSendRequest(value)) throw new Error();
        return structuredClone(value);
    } catch {
        throw new ControlSendError(400);
    }
}
export function sendDigest(value: ControlSendRequest): string {
    return createHash("sha256").update(canonicalServiceJson(value)).digest("hex");
}
export function projectSend(record: SendRecord): ControlSendOperation {
    const {
        schemaVersion: _version,
        ownerHash: _owner,
        requestDigest: _digest,
        ...operation
    } = record;
    return structuredClone(operation);
}
export function parseSendRecord(input: unknown): SendRecord {
    try {
        const extra =
            input && typeof input === "object"
                ? ["finishedAt", "messageId"].filter(key => Object.hasOwn(input, key))
                : [];
        const value = closedServiceObject(input, [
            "schemaVersion",
            "ownerHash",
            "requestDigest",
            "id",
            "gatewayInstanceId",
            "configVersion",
            "status",
            "startedAt",
            ...extra,
        ]);
        if (
            value.schemaVersion !== 1 ||
            !sendId(value.id) ||
            !sendHash(value.ownerHash) ||
            !sendHash(value.requestDigest)
        )
            throw new Error();
        const { schemaVersion, ownerHash, requestDigest, ...operation } = value;
        if (!isControlSendOperation(operation)) throw new Error();
        return value as unknown as SendRecord;
    } catch {
        throw new ControlSendError(503);
    }
}
