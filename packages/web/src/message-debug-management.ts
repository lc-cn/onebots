import {
    MANAGEMENT_EXPECTED_INSTANCE_HEADER,
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "./management-evidence-identity.js";
import { readManagementJsonResponse } from "./management-response.js";

export interface MessageDebugEntry {
    seq: number;
    time: number;
    direction: "inbound" | "outbound";
    platform: string;
    account_id: string;
    protocol?: string;
    version?: string;
    payload: unknown;
}

export interface MessageDebugSnapshot {
    identity: ManagementEvidenceIdentity;
    entries: MessageDebugEntry[];
}

export interface MessageDebugClearReceipt {
    clearedCount: number;
    clearedThroughSeq: number;
}

export async function readMessageDebugSnapshot(response: Response): Promise<MessageDebugSnapshot> {
    const identity = parseManagementEvidenceIdentity(response);
    const payload = await readManagementJsonResponse(response);
    if (!response.ok) throw new Error(`消息调试历史请求失败（HTTP ${response.status}）`);
    if (!Array.isArray(payload) || !payload.every(isMessageDebugEntry)) {
        throw new Error("消息调试历史包含无效记录");
    }
    return { identity, entries: payload };
}

export function parseMessageDebugStreamIdentity(
    payload: unknown,
): ManagementEvidenceIdentity | null {
    if (!isRecord(payload) || payload.event !== "identity") return null;
    const application = typeof payload.application === "string" ? payload.application.trim() : "";
    const version = typeof payload.version === "string" ? payload.version.trim() : "";
    const instanceId = typeof payload.instance_id === "string" ? payload.instance_id.trim() : "";
    const runtimeContractId =
        typeof payload.runtime_contract_id === "string" ? payload.runtime_contract_id.trim() : "";
    if (application !== "onebots" || !version || !instanceId) {
        throw new Error("消息调试事件流缺少完整 OneBots 实例身份");
    }
    return {
        application,
        version,
        instanceId,
        ...(runtimeContractId ? { runtimeContractId } : {}),
    };
}

export function messageDebugClearHeaders(identity: ManagementEvidenceIdentity): Headers {
    return new Headers({ [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: identity.instanceId });
}

export async function readMessageDebugClearReceipt(
    response: Response,
    expected: ManagementEvidenceIdentity,
): Promise<MessageDebugClearReceipt> {
    const actual = parseManagementEvidenceIdentity(response);
    if (!sameManagementEvidenceIdentity(actual, expected)) {
        throw new Error(
            `消息调试清理响应实例不匹配：期望 ${expected.instanceId}，实际 ${actual.instanceId}`,
        );
    }
    const payload = await readManagementJsonResponse(response);
    if (
        !response.ok ||
        !isRecord(payload) ||
        payload.success !== true ||
        payload.application !== expected.application ||
        payload.instance_id !== expected.instanceId ||
        !isNonNegativeSafeInteger(payload.cleared_count) ||
        !isNonNegativeSafeInteger(payload.cleared_through_seq)
    ) {
        const message =
            isRecord(payload) && typeof payload.message === "string" ? payload.message.trim() : "";
        throw new Error(message || `清空消息调试记录失败（HTTP ${response.status}）`);
    }
    return {
        clearedCount: payload.cleared_count,
        clearedThroughSeq: payload.cleared_through_seq,
    };
}

export function isMessageDebugEntry(value: unknown): value is MessageDebugEntry {
    return (
        isRecord(value) &&
        Number.isSafeInteger(value.seq) &&
        (value.seq as number) > 0 &&
        Number.isSafeInteger(value.time) &&
        (value.time as number) >= 0 &&
        (value.direction === "inbound" || value.direction === "outbound") &&
        typeof value.platform === "string" &&
        !!value.platform.trim() &&
        typeof value.account_id === "string" &&
        (value.protocol === undefined || typeof value.protocol === "string") &&
        (value.version === undefined || typeof value.version === "string") &&
        "payload" in value
    );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
