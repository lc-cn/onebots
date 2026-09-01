import {
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "./management-evidence-identity.js";
import { readManagementJsonResponse } from "./management-response.js";

/** 从受保护系统端点采用终端即将连接的目标实例。 */
export async function readTerminalTargetIdentity(
    response: Response,
): Promise<ManagementEvidenceIdentity> {
    const identity = parseManagementEvidenceIdentity(response);
    const payload = await readManagementJsonResponse(response);
    if (!response.ok) throw new Error(`终端目标探测失败（HTTP ${response.status}）`);
    if (!isRecord(payload)) throw new Error("终端目标探测正文必须是对象");
    const bodyIdentity = parseBodyIdentity(payload);
    if (!bodyIdentity || !sameManagementEvidenceIdentity(identity, bodyIdentity)) {
        throw new Error("终端目标探测正文与响应实例身份不一致");
    }
    return identity;
}

/** 解析终端 WebSocket 的首帧实例身份。 */
export function parseTerminalInstanceIdentity(payload: unknown): ManagementEvidenceIdentity | null {
    if (!isRecord(payload) || payload.type !== "identity") return null;
    const application = nonEmptyString(payload.application);
    const version = nonEmptyString(payload.version);
    const instanceId = nonEmptyString(payload.instance_id);
    const runtimeContractId = nonEmptyString(payload.runtime_contract_id);
    if (application !== "onebots" || !version || !instanceId || !runtimeContractId) {
        throw new Error("终端 WebSocket 缺少完整 OneBots 实例身份");
    }
    return { application, version, instanceId, runtimeContractId };
}

export function assertTerminalInstanceMatches(
    expected: ManagementEvidenceIdentity,
    actual: ManagementEvidenceIdentity,
): void {
    if (!sameManagementEvidenceIdentity(expected, actual)) {
        throw new Error(
            `终端实例不匹配：页面期望 ${expected.instanceId}，WebSocket 连接到 ${actual.instanceId}`,
        );
    }
}

function parseBodyIdentity(value: Record<string, unknown>): ManagementEvidenceIdentity | null {
    const application = nonEmptyString(value.application_name);
    const version = nonEmptyString(value.application_version);
    const instanceId = nonEmptyString(value.instance_id);
    const runtimeContractId = nonEmptyString(value.runtime_contract_id);
    return application && version && instanceId && runtimeContractId
        ? { application, version, instanceId, runtimeContractId }
        : null;
}

function nonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
