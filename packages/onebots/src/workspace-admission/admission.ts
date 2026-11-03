import path from "node:path";
import { AuthorityRegistry, acquireAuthorityLock } from "./registry.js";
import {
    digest,
    exists,
    openPhysicalDirectory,
    readPrivate,
    sameIdentity,
    separatedPaths,
} from "./files.js";
import {
    BINDING_FILE,
    UUID,
    type AdmissionInspection,
    type AdmissionLease,
    type WorkspaceBinding,
    type PhysicalIdentity,
} from "./types.js";

export function readWorkspaceBinding(workspace: string): WorkspaceBinding | undefined {
    const file = readPrivate(path.join(workspace, ".control", BINDING_FILE));
    if (!file) return undefined;
    const value: unknown = JSON.parse(file.bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("来源引用损坏");
    const binding = value as WorkspaceBinding;
    if (
        Object.keys(value).sort().join() !==
            "authorityId,bindingRevision,operationId,schemaVersion,workspaceId" ||
        binding.schemaVersion !== 1 ||
        binding.bindingRevision !== 1 ||
        !UUID.test(binding.authorityId) ||
        !UUID.test(binding.workspaceId) ||
        !UUID.test(binding.operationId)
    )
        throw new Error("来源引用结构无效");
    return binding;
}
const inspection = (state: AdmissionInspection["state"], reason: string): AdmissionInspection => ({
    schemaVersion: 1,
    state,
    reason,
});
function inspectUnbound(authority: string, identity?: PhysicalIdentity): AdmissionInspection {
    if (!identity || !exists(path.join(authority, "authority.sqlite")))
        return inspection("unbound", "EXPLICIT_REGISTRATION_REQUIRED");
    const registry = AuthorityRegistry.open(authority);
    try {
        const record = registry.byPhysical(JSON.stringify(identity));
        if (!record) return inspection("unbound", "EXPLICIT_REGISTRATION_REQUIRED");
        return record.status === "prepared"
            ? inspection("registration-pending", "REGISTRATION_NOT_COMMITTED")
            : inspection("binding-mismatch", "COMMITTED_REFERENCE_MISSING");
    } finally {
        registry.close();
    }
}
function sameBinding(left: WorkspaceBinding, right: WorkspaceBinding): boolean {
    return (
        left.schemaVersion === right.schemaVersion &&
        left.authorityId === right.authorityId &&
        left.workspaceId === right.workspaceId &&
        left.bindingRevision === right.bindingRevision &&
        left.operationId === right.operationId
    );
}

/** 调用方先持卷内锁；成功时返回卷外运行锁和物理句柄，其生命周期覆盖全部受管进程。 */
export function acquireWorkspaceAdmission(
    workspace: string,
    authorityDirectory: string | undefined,
): AdmissionLease {
    let release: (() => void) | undefined;
    let opened: ReturnType<typeof openPhysicalDirectory> | undefined;
    let registry: AuthorityRegistry | undefined;
    const deny = (state: AdmissionInspection["state"], reason: string): AdmissionLease => {
        registry?.close();
        registry = undefined;
        release?.();
        release = undefined;
        opened?.close();
        opened = undefined;
        return { inspection: inspection(state, reason), release() {} };
    };
    try {
        if (!authorityDirectory) return deny("authority-unavailable", "AUTHORITY_NOT_CONFIGURED");
        separatedPaths(workspace, authorityDirectory);
        opened = openPhysicalDirectory(path.join(workspace, ".control"));
        const binding = readWorkspaceBinding(workspace);
        if (!binding) {
            const state = inspectUnbound(authorityDirectory, opened.identity);
            return deny(state.state, state.reason);
        }
        try {
            registry = AuthorityRegistry.open(authorityDirectory);
        } catch (error) {
            const code = error instanceof Error && "code" in error ? String(error.code) : "INVALID";
            return deny(
                "authority-unavailable",
                code === "ENOENT"
                    ? "AUTHORITY_MISSING"
                    : code === "EACCES" || code === "EPERM"
                      ? "AUTHORITY_PERMISSION"
                      : "AUTHORITY_INVALID",
            );
        }
        if (registry.authorityId !== binding.authorityId)
            return deny("binding-mismatch", "AUTHORITY_ID_MISMATCH");
        try {
            release = acquireAuthorityLock(authorityDirectory, binding.workspaceId);
        } catch {
            return deny("binding-mismatch", "IDENTITY_LOCK_UNAVAILABLE");
        }
        const record = registry.findById(binding.operationId);
        if (!record) return deny("binding-mismatch", "REGISTRATION_NOT_FOUND");
        if (record.status !== "committed")
            return deny("registration-pending", "REGISTRATION_NOT_COMMITTED");
        if (
            !sameBinding(record.binding, binding) ||
            !sameIdentity(record.identity, opened.identity)
        )
            return deny("binding-mismatch", "DIRECTORY_IDENTITY_MISMATCH");
        const current = openPhysicalDirectory(path.join(workspace, ".control"));
        try {
            if (!sameIdentity(opened.identity, current.identity))
                return deny("binding-mismatch", "DIRECTORY_REPLACED");
        } finally {
            current.close();
        }
        registry.close();
        registry = undefined;
        let closed = false;
        return {
            inspection: inspection("verified", "REGISTERED_LOCAL_OBJECT"),
            binding,
            ...(record.genesis?.["process-ownership.json"] && record.genesis["gateway.json"]
                ? {
                      initialProcessState: {
                          receiptDigest: digest(record.genesis["process-ownership.json"]),
                          gatewayDigest: digest(record.genesis["gateway.json"]),
                      },
                  }
                : {}),
            release() {
                if (closed) return;
                closed = true;
                try {
                    release?.();
                } finally {
                    opened?.close();
                }
            },
        };
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOTSUP")
            return deny("unsupported", "STORAGE_PROVIDER_UNSUPPORTED");
        return deny("binding-mismatch", "SOURCE_EVIDENCE_UNREADABLE");
    }
}

/** 只读检查不创建锁、登记簿、认证或业务状态。 */
export function inspectWorkspaceAdmission(
    workspace: string,
    authorityDirectory: string,
): AdmissionInspection {
    try {
        separatedPaths(workspace, authorityDirectory);
        const binding = readWorkspaceBinding(workspace);
        if (!binding) {
            const directory = path.join(workspace, ".control");
            const opened = exists(directory) ? openPhysicalDirectory(directory) : undefined;
            try {
                return inspectUnbound(authorityDirectory, opened?.identity);
            } finally {
                opened?.close();
            }
        }
        const current = openPhysicalDirectory(path.join(workspace, ".control"));
        try {
            const registry = AuthorityRegistry.open(authorityDirectory);
            try {
                const record = registry.findById(binding.operationId);
                if (
                    registry.authorityId !== binding.authorityId ||
                    !record ||
                    !sameBinding(record.binding, binding) ||
                    !sameIdentity(record.identity, current.identity)
                )
                    return inspection("binding-mismatch", "DIRECTORY_IDENTITY_MISMATCH");
                return record.status === "committed"
                    ? inspection("verified", "REGISTERED_LOCAL_OBJECT")
                    : inspection("registration-pending", "REGISTRATION_NOT_COMMITTED");
            } finally {
                registry.close();
            }
        } finally {
            current.close();
        }
    } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : "INVALID";
        return inspection(
            code === "ENOTSUP" ? "unsupported" : "authority-unavailable",
            code === "ENOENT"
                ? "EVIDENCE_MISSING"
                : code === "EACCES" || code === "EPERM"
                  ? "EVIDENCE_PERMISSION"
                  : code === "ENOTSUP"
                    ? "STORAGE_PROVIDER_UNSUPPORTED"
                    : "EVIDENCE_INVALID",
        );
    }
}
