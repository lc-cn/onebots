export interface ManagementEvidenceIdentity {
    application: string;
    version: string;
    instanceId: string;
    runtimeContractId?: string;
}

/** 读取管理响应头中的 OneBots 进程身份，拒绝通用服务或不可定位的响应。 */
export function parseManagementEvidenceIdentity(
    response: Pick<Response, "headers">,
): ManagementEvidenceIdentity {
    const application = response.headers.get("X-OneBots-Application")?.trim() ?? "";
    const version = response.headers.get("X-OneBots-Version")?.trim() ?? "";
    const instanceId = response.headers.get("X-OneBots-Instance-Id")?.trim() ?? "";
    const runtimeContractId = response.headers.get("X-OneBots-Runtime-Contract-Id")?.trim() ?? "";
    if (application !== "onebots" || !version || !instanceId) {
        throw new Error("管理响应缺少完整 OneBots 实例身份");
    }
    return {
        application,
        version,
        instanceId,
        ...(runtimeContractId ? { runtimeContractId } : {}),
    };
}

export function sameManagementEvidenceIdentity(
    left: ManagementEvidenceIdentity,
    right: ManagementEvidenceIdentity,
): boolean {
    return (
        left.application === right.application &&
        left.version === right.version &&
        left.instanceId === right.instanceId &&
        left.runtimeContractId === right.runtimeContractId
    );
}
