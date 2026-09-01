export const EXTENSION_EVIDENCE_HEADERS = Object.freeze({
    application: "X-OneBots-Application",
    version: "X-OneBots-Version",
    instanceId: "X-OneBots-Instance-Id",
    runtimeContractId: "X-OneBots-Runtime-Contract-Id",
});

export interface ExtensionEvidenceIdentity {
    application: string;
    version: string;
    instanceId: string;
    runtimeContractId?: string;
}

export function buildExtensionEvidenceHeaders(
    identity: ExtensionEvidenceIdentity,
): Record<string, string> {
    return {
        [EXTENSION_EVIDENCE_HEADERS.application]: identity.application,
        [EXTENSION_EVIDENCE_HEADERS.version]: identity.version,
        [EXTENSION_EVIDENCE_HEADERS.instanceId]: identity.instanceId,
        ...(identity.runtimeContractId
            ? { [EXTENSION_EVIDENCE_HEADERS.runtimeContractId]: identity.runtimeContractId }
            : {}),
        "Cache-Control": "no-store",
    };
}

export function readExtensionEvidenceIdentity(headers: Headers): ExtensionEvidenceIdentity | null {
    const application = headers.get(EXTENSION_EVIDENCE_HEADERS.application)?.trim() ?? "";
    const version = headers.get(EXTENSION_EVIDENCE_HEADERS.version)?.trim() ?? "";
    const instanceId = headers.get(EXTENSION_EVIDENCE_HEADERS.instanceId)?.trim() ?? "";
    const runtimeContractId =
        headers.get(EXTENSION_EVIDENCE_HEADERS.runtimeContractId)?.trim() ?? "";
    return application && version && instanceId
        ? {
              application,
              version,
              instanceId,
              ...(runtimeContractId ? { runtimeContractId } : {}),
          }
        : null;
}
