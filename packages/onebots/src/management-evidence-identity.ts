export const MANAGEMENT_EVIDENCE_HEADERS = Object.freeze({
    application: "X-OneBots-Application",
    version: "X-OneBots-Version",
    instanceId: "X-OneBots-Instance-Id",
    runtimeContractId: "X-OneBots-Runtime-Contract-Id",
});

export interface ManagementEvidenceIdentity {
    application: string;
    version: string;
    instanceId: string;
    runtimeContractId?: string;
}

export function buildManagementEvidenceHeaders(
    identity: ManagementEvidenceIdentity,
): Record<string, string> {
    return {
        [MANAGEMENT_EVIDENCE_HEADERS.application]: identity.application,
        [MANAGEMENT_EVIDENCE_HEADERS.version]: identity.version,
        [MANAGEMENT_EVIDENCE_HEADERS.instanceId]: identity.instanceId,
        ...(identity.runtimeContractId
            ? { [MANAGEMENT_EVIDENCE_HEADERS.runtimeContractId]: identity.runtimeContractId }
            : {}),
        "Cache-Control": "no-store",
    };
}

export function readManagementEvidenceIdentity(
    headers: Headers,
): ManagementEvidenceIdentity | null {
    const application = headers.get(MANAGEMENT_EVIDENCE_HEADERS.application)?.trim() ?? "";
    const version = headers.get(MANAGEMENT_EVIDENCE_HEADERS.version)?.trim() ?? "";
    const instanceId = headers.get(MANAGEMENT_EVIDENCE_HEADERS.instanceId)?.trim() ?? "";
    const runtimeContractId =
        headers.get(MANAGEMENT_EVIDENCE_HEADERS.runtimeContractId)?.trim() ?? "";
    return application && version && instanceId
        ? {
              application,
              version,
              instanceId,
              ...(runtimeContractId ? { runtimeContractId } : {}),
          }
        : null;
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

interface ManagementEvidenceSource {
    info: {
        application_name: string;
        application_version: string;
        instance_id: string;
    };
    runtimeContractId?: string;
}

interface ManagementEvidenceContext {
    set(name: string, value: string): void;
}

/** 为需要原子采用的管理 GET 响应发布同一份不可缓存实例身份。 */
export function setManagementEvidenceIdentity(
    source: ManagementEvidenceSource,
    context: ManagementEvidenceContext,
): void {
    const headers = buildManagementEvidenceHeaders({
        application: source.info.application_name,
        version: source.info.application_version,
        instanceId: source.info.instance_id,
        ...(source.runtimeContractId ? { runtimeContractId: source.runtimeContractId } : {}),
    });
    for (const [name, value] of Object.entries(headers)) context.set(name, value);
}
