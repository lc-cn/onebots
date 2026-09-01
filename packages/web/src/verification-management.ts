import type { VerificationRequest } from "./types.js";
import {
    MANAGEMENT_EXPECTED_INSTANCE_HEADER,
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "./management-evidence-identity.js";
import { readManagementJsonResponse } from "./management-response.js";

export interface VerificationSnapshot {
    identity: ManagementEvidenceIdentity;
    items: VerificationRequest[];
}

export interface VerificationMutationResult {
    success: boolean;
    message?: string;
}

/** 待处理验证列表与产生它的 OneBots 进程身份必须原子采用。 */
export async function readVerificationSnapshot(response: Response): Promise<VerificationSnapshot> {
    const identity = parseManagementEvidenceIdentity(response);
    const payload = await readManagementJsonResponse(response);
    if (!response.ok) throw new Error(`待处理验证请求失败（HTTP ${response.status}）`);
    if (!Array.isArray(payload)) throw new Error("待处理验证响应不是数组");
    if (!payload.every(isVerificationRequest)) {
        throw new Error("待处理验证响应包含无效请求");
    }
    return { identity, items: payload };
}

export function isVerificationRequest(value: unknown): value is VerificationRequest {
    return (
        isRecord(value) &&
        typeof value.platform === "string" &&
        !!value.platform.trim() &&
        typeof value.account_id === "string" &&
        !!value.account_id.trim() &&
        typeof value.type === "string" &&
        !!value.type.trim() &&
        typeof value.hint === "string"
    );
}

/** SSE 每次连接先发布身份事件，后续事件才能归属于确定的运行实例。 */
export function parseVerificationStreamIdentity(
    payload: unknown,
): ManagementEvidenceIdentity | null {
    if (!isRecord(payload) || payload.event !== "identity") return null;
    const application = typeof payload.application === "string" ? payload.application.trim() : "";
    const version = typeof payload.version === "string" ? payload.version.trim() : "";
    const instanceId = typeof payload.instance_id === "string" ? payload.instance_id.trim() : "";
    const runtimeContractId =
        typeof payload.runtime_contract_id === "string" ? payload.runtime_contract_id.trim() : "";
    if (application !== "onebots" || !version || !instanceId) {
        throw new Error("验证事件流缺少完整 OneBots 实例身份");
    }
    return {
        application,
        version,
        instanceId,
        ...(runtimeContractId ? { runtimeContractId } : {}),
    };
}

export function verificationMutationHeaders(identity: ManagementEvidenceIdentity): Headers {
    return new Headers({
        "Content-Type": "application/json",
        [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: identity.instanceId,
    });
}

/** 写操作只有在响应头和正文都闭合到请求实例时才可更新验证面板。 */
export async function readVerificationMutationResult(
    response: Response,
    expected: ManagementEvidenceIdentity,
): Promise<VerificationMutationResult> {
    const actual = parseManagementEvidenceIdentity(response);
    if (!sameManagementEvidenceIdentity(actual, expected)) {
        throw new Error(
            `验证响应实例不匹配：期望 ${expected.instanceId}，实际 ${actual.instanceId}`,
        );
    }
    const payload = await readManagementJsonResponse(response);
    if (
        !isRecord(payload) ||
        typeof payload.success !== "boolean" ||
        payload.application !== expected.application ||
        payload.instance_id !== expected.instanceId
    ) {
        throw new Error("验证端点未返回与请求实例一致的结果回执");
    }
    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    if (response.ok && payload.success) return { success: true };
    return {
        success: false,
        message: message || `验证请求失败（HTTP ${response.status}）`,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
