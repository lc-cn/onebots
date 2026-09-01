import type { ManagementEvidenceIdentity } from "./management-evidence-identity.js";

/** 管理 SSE 每次连接都以正文事件声明身份，使后续事件可归属到确定的进程。 */
export function parseManagementStreamIdentity(
    payload: unknown,
    streamName: string,
): ManagementEvidenceIdentity | null {
    if (!isRecord(payload) || payload.event !== "identity") return null;
    const application = typeof payload.application === "string" ? payload.application.trim() : "";
    const version = typeof payload.version === "string" ? payload.version.trim() : "";
    const instanceId = typeof payload.instance_id === "string" ? payload.instance_id.trim() : "";
    const runtimeContractId =
        typeof payload.runtime_contract_id === "string" ? payload.runtime_contract_id.trim() : "";
    if (application !== "onebots" || !version || !instanceId) {
        throw new Error(`${streamName}缺少完整 OneBots 实例身份`);
    }
    return {
        application,
        version,
        instanceId,
        ...(runtimeContractId ? { runtimeContractId } : {}),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
