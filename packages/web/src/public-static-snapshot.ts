import {
    MANAGEMENT_EXPECTED_INSTANCE_HEADER,
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
    type ManagementEvidenceIdentity,
} from "./management-evidence-identity.js";

export const PUBLIC_STATIC_REVISION_HEADER = "X-OneBots-Public-Static-Revision";
export const EXPECTED_PUBLIC_STATIC_REVISION_HEADER = "X-OneBots-Expected-Public-Static-Revision";

export interface PublicStaticSnapshot {
    identity: ManagementEvidenceIdentity;
    revision: string;
    files: string[];
    root: string;
}

/** 原子采用静态文件列表、目录修订和处理实例，拒绝代理拼接的响应。 */
export function parsePublicStaticSnapshot(
    response: Pick<Response, "headers">,
    value: unknown,
): PublicStaticSnapshot {
    const identity = parseManagementEvidenceIdentity(response);
    const revision = response.headers.get(PUBLIC_STATIC_REVISION_HEADER)?.trim() ?? "";
    if (!isRevision(revision)) throw new Error("静态文件列表缺少有效目录修订号");
    if (
        !isRecord(value) ||
        value.success !== true ||
        value.application !== "onebots" ||
        value.instance_id !== identity.instanceId ||
        value.static_revision !== revision ||
        !Array.isArray(value.files) ||
        !value.files.every(isSafeDisplayName) ||
        new Set(value.files).size !== value.files.length ||
        typeof value.root !== "string" ||
        !value.root.trim()
    ) {
        throw new Error("静态文件列表响应契约无效");
    }
    return {
        identity,
        revision,
        files: value.files,
        root: value.root,
    };
}

/** 将静态文件写操作绑定到生成当前列表的实例和目录内容。 */
export function buildPublicStaticMutationHeaders(
    identity: ManagementEvidenceIdentity,
    revision: string,
): Record<string, string> {
    if (!isRevision(revision)) throw new Error("静态文件写入缺少有效目录修订号");
    return {
        [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: identity.instanceId,
        [EXPECTED_PUBLIC_STATIC_REVISION_HEADER]: revision,
    };
}

/** 写操作只有获得同一实例签发的新目录修订后才算完成。 */
export function assertPublicStaticMutationAcknowledgement(
    response: Pick<Response, "headers">,
    value: unknown,
    expectedIdentity: ManagementEvidenceIdentity,
): string {
    const identity = parseManagementEvidenceIdentity(response);
    if (!sameManagementEvidenceIdentity(identity, expectedIdentity)) {
        throw new Error(
            `静态文件写入回执实例不匹配：期望 ${expectedIdentity.instanceId}，实际 ${identity.instanceId}`,
        );
    }
    const revision = response.headers.get(PUBLIC_STATIC_REVISION_HEADER)?.trim() ?? "";
    if (
        !isRevision(revision) ||
        !isRecord(value) ||
        value.success !== true ||
        value.application !== "onebots" ||
        value.instance_id !== expectedIdentity.instanceId ||
        value.static_revision !== revision
    ) {
        throw new Error("静态文件写入回执缺少可信的新目录修订");
    }
    return revision;
}

function isRevision(value: string): boolean {
    return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeDisplayName(value: unknown): value is string {
    return (
        typeof value === "string" &&
        Boolean(value.trim()) &&
        !/[\\/\u0000-\u001f\u007f]/u.test(value)
    );
}
