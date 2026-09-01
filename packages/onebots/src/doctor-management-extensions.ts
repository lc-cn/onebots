import type { DoctorCheck, DoctorEndpointIdentity } from "./doctor-endpoint.js";
import type { ManagementFetch } from "./management-credential.js";
import { validateManagementExtensionInventory } from "./doctor-management-extension-contract.js";
import { readDoctorManagementJson } from "./doctor-management-response.js";
import {
    readManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
} from "./management-evidence-identity.js";
import packageMetadata from "../package.json" with { type: "json" };

interface RuntimeExtensionSummary {
    id?: unknown;
    installed?: unknown;
    installedVersion?: unknown;
    targetVersion?: unknown;
    versionAligned?: unknown;
    enabled?: unknown;
    loaded?: unknown;
    loadedVersion?: unknown;
    installing?: unknown;
    catalogError?: unknown;
    runtimeConfigError?: unknown;
    installedError?: unknown;
    configurationError?: unknown;
}

interface PackageMutationSummary {
    state?: unknown;
    available?: unknown;
    owner?: unknown;
    error?: unknown;
}

/** 验证在线进程实际加载版本与当前磁盘依赖已经收敛。 */
export async function probeAuthenticatedExtensions(
    base: string,
    token: string,
    fetcher: ManagementFetch,
    expectedIdentity?: DoctorEndpointIdentity,
): Promise<DoctorCheck> {
    try {
        const request = (path: string) =>
            fetcher(`${base}${path}`, {
                headers: { authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(2_000),
            });
        const [extensionsResponse, mutationResponse] = await Promise.all([
            request("/api/extensions"),
            request("/api/extensions/package-mutation"),
        ]);
        const [extensionsPayload, mutationPayload] = await Promise.all([
            readDoctorManagementJson(extensionsResponse),
            readDoctorManagementJson(mutationResponse),
        ]);
        if (!extensionsResponse.ok || !Array.isArray(extensionsPayload)) {
            return {
                name: "management-extensions",
                level: "error",
                message: `扩展运行证据响应无效: HTTP ${extensionsResponse.status}`,
            };
        }
        if (!mutationResponse.ok || !isRecord(mutationPayload)) {
            return {
                name: "management-extensions",
                level: "error",
                message: `包变更租约响应无效: HTTP ${mutationResponse.status}`,
            };
        }

        const inventoryIdentity = readManagementEvidenceIdentity(extensionsResponse.headers);
        const mutationIdentity = readManagementEvidenceIdentity(mutationResponse.headers);
        const identityIssue = inspectExtensionEvidenceIdentities(
            inventoryIdentity,
            mutationIdentity,
            expectedIdentity,
        );
        if (identityIssue) {
            return {
                name: "management-extensions",
                level: "error",
                message: identityIssue,
            };
        }

        const inventoryIssues = validateManagementExtensionInventory(extensionsPayload);
        if (inventoryIssues.length > 0) {
            return {
                name: "management-extensions",
                level: "error",
                message: `扩展目录证据契约无效: ${inventoryIssues.join("；")}`,
            };
        }

        const runtime = inspectRuntimeExtensions(extensionsPayload);
        if (runtime.level === "error") return runtime;
        const mutation = inspectPackageMutationStatus(mutationPayload);
        return mutation.level === "error" ? mutation : runtime;
    } catch (error) {
        return {
            name: "management-extensions",
            level: "error",
            message: `扩展运行证据探测失败: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

function inspectExtensionEvidenceIdentities(
    inventory: ReturnType<typeof readManagementEvidenceIdentity>,
    mutation: ReturnType<typeof readManagementEvidenceIdentity>,
    expected?: DoctorEndpointIdentity,
): string | null {
    if (!inventory || !mutation) return "扩展目录或包变更租约响应缺少完整实例身份";
    if (!sameManagementEvidenceIdentity(inventory, mutation)) {
        return `扩展目录与包变更租约来自不同实例：${identityLabel(inventory)}；${identityLabel(mutation)}`;
    }
    const target = expected ?? {
        application: packageMetadata.name,
        version: packageMetadata.version,
        instanceId: inventory.instanceId,
        ...(inventory.runtimeContractId ? { runtimeContractId: inventory.runtimeContractId } : {}),
    };
    if (!sameManagementEvidenceIdentity(inventory, target)) {
        return `扩展管理实例 ${identityLabel(inventory)} 与公开探针 ${identityLabel(target)} 不一致`;
    }
    return null;
}

function identityLabel(identity: DoctorEndpointIdentity): string {
    const contract = identity.runtimeContractId ? ` 契约 ${identity.runtimeContractId}` : "";
    return `${identity.application}@${identity.version} 实例 ${identity.instanceId}${contract}`;
}

export function inspectPackageMutationStatus(payload: PackageMutationSummary): DoctorCheck {
    const state = payload.state;
    if (
        !["idle", "active", "recoverable", "invalid"].includes(String(state)) ||
        typeof payload.available !== "boolean" ||
        !isNullableDiagnostic(payload.error) ||
        !(payload.owner === null || isPackageMutationOwner(payload.owner))
    ) {
        return {
            name: "management-extensions",
            level: "error",
            message: "包变更租约证据契约无效",
        };
    }
    if (state === "idle") {
        if (!payload.available || payload.owner !== null || payload.error !== null) {
            return invalidPackageMutationContract();
        }
        return {
            name: "management-extensions",
            level: "ok",
            message: "扩展运行证据与包变更租约均已验证，当前没有未完成事务",
        };
    }
    if (state === "active" && (!payload.owner || payload.available || payload.error !== null)) {
        return invalidPackageMutationContract();
    }
    if (state === "invalid" && (payload.owner !== null || payload.available || !payload.error)) {
        return invalidPackageMutationContract();
    }
    if (
        state === "recoverable" &&
        (!payload.available || (payload.owner === null ? !payload.error : payload.error !== null))
    ) {
        return invalidPackageMutationContract();
    }

    const owner = payload.owner as Record<string, unknown> | null;
    const operation =
        owner?.operation === "extension_install"
            ? `扩展 ${String(owner.extensionId)} 安装`
            : owner?.operation === "package_update"
              ? "OneBots 软件包更新"
              : "未知包变更";
    const detail = owner
        ? `${operation}（操作 ${String(owner.operationId)}，主机 ${String(owner.host)}，进程 ${String(owner.pid)}，开始于 ${String(owner.startedAt)}）`
        : String(payload.error);
    return {
        name: "management-extensions",
        level: "error",
        message:
            state === "active"
                ? `包变更事务尚未完成: ${detail}`
                : state === "recoverable"
                  ? `检测到可回收的包变更租约: ${detail}；下一次包变更会自动回收`
                  : `包变更租约无法验证: ${detail}`,
    };
}

function invalidPackageMutationContract(): DoctorCheck {
    return {
        name: "management-extensions",
        level: "error",
        message: "包变更租约证据契约无效",
    };
}

function isPackageMutationOwner(value: unknown): value is Record<string, unknown> {
    if (!isRecord(value)) return false;
    const operation = value.operation;
    return (
        !Object.hasOwn(value, "token") &&
        isSafeEvidenceText(value.operationId, 256) &&
        (operation === "extension_install" || operation === "package_update") &&
        ((operation === "extension_install" && isSafeEvidenceText(value.extensionId, 256)) ||
            (operation === "package_update" && value.extensionId === null)) &&
        isSafeEvidenceText(value.host, 256) &&
        Number.isSafeInteger(value.pid) &&
        Number(value.pid) > 0 &&
        isSafeEvidenceText(value.startedAt, 64) &&
        Number.isFinite(Date.parse(value.startedAt)) &&
        new Date(value.startedAt).toISOString() === value.startedAt
    );
}

function isSafeEvidenceText(value: unknown, maxLength: number): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= maxLength &&
        !/[\u0000-\u001f\u007f]/u.test(value)
    );
}

export function inspectRuntimeExtensions(payload: unknown[]): DoctorCheck {
    const contractIssues = new Set<string>();
    const convergenceIssues = new Set<string>();
    const ids = new Set<string>();
    let enabledCount = 0;
    let loadedCount = 0;
    for (const value of payload as RuntimeExtensionSummary[]) {
        if (!isRecord(value)) {
            contractIssues.add("扩展条目必须是对象");
            continue;
        }
        const id = runtimeLabel(value.id, "unknown");
        if (id === "unknown") contractIssues.add("扩展条目缺少 id");
        if (ids.has(id)) contractIssues.add(`扩展 id 重复: ${id}`);
        ids.add(id);

        const booleans = [
            "installed",
            "versionAligned",
            "enabled",
            "loaded",
            "installing",
        ] as const;
        for (const field of booleans) {
            if (typeof value[field] !== "boolean") {
                contractIssues.add(`${id} 的 ${field} 必须是布尔值`);
            }
        }
        const versionFields = ["targetVersion", "installedVersion", "loadedVersion"] as const;
        for (const field of versionFields) {
            if (!isNullableVersion(value[field])) {
                contractIssues.add(`${id} 的 ${field} 必须是非空版本字符串或 null`);
            }
        }
        const errorFields = [
            "catalogError",
            "runtimeConfigError",
            "installedError",
            "configurationError",
        ] as const;
        for (const field of errorFields) {
            if (!isNullableDiagnostic(value[field])) {
                contractIssues.add(`${id} 的 ${field} 必须是非空诊断字符串或 null`);
            }
        }
        if (contractIssues.size > 0 && id === "unknown") continue;

        const installed = value.installed === true;
        const enabled = value.enabled === true;
        const loaded = value.loaded === true;
        const installing = value.installing === true;
        const installedVersion = nullableString(value.installedVersion);
        const loadedVersion = nullableString(value.loadedVersion);
        const targetVersion = nullableString(value.targetVersion);
        if (installed !== (installedVersion !== null)) {
            contractIssues.add(`${id} 的 installed 与 installedVersion 相互矛盾`);
        }
        if (!loaded && loadedVersion !== null) {
            contractIssues.add(`${id} 未加载却声明 loadedVersion`);
        }
        if (
            value.versionAligned === true &&
            (!installed || !targetVersion || installedVersion !== targetVersion)
        ) {
            contractIssues.add(`${id} 声明版本对齐但缺少一致的安装与目标版本`);
        }
        if (enabled) enabledCount++;
        if (loaded) loadedCount++;

        for (const field of ["catalogError", "runtimeConfigError"] as const) {
            const diagnostic = nullableString(value[field]);
            if (diagnostic) convergenceIssues.add(diagnostic.slice(0, 500));
        }
        for (const field of ["installedError", "configurationError"] as const) {
            const diagnostic = nullableString(value[field]);
            if (diagnostic) convergenceIssues.add(`${id}: ${diagnostic.slice(0, 500)}`);
        }
        if (installing) convergenceIssues.add(`${id} 的安装事务尚未完成`);
        if (enabled && !installed) convergenceIssues.add(`${id} 已启用但磁盘依赖缺失`);
        if (enabled && !loaded) convergenceIssues.add(`${id} 已启用但当前进程未加载`);
        if (!loaded) continue;
        if (!installed) convergenceIssues.add(`${id} 已加载但磁盘依赖缺失`);
        if (value.versionAligned !== true) {
            convergenceIssues.add(
                `${id} 的磁盘版本 ${installedVersion ?? "未知"} 未对齐目标版本 ${targetVersion ?? "未知"}`,
            );
        }
        if (!installedVersion || !loadedVersion) {
            convergenceIssues.add(`${id} 缺少安装或加载版本，无法证明运行版本一致`);
        } else if (installedVersion !== loadedVersion) {
            convergenceIssues.add(
                `${id} 当前进程仍运行 ${loadedVersion}，磁盘已安装 ${installedVersion}；请重启`,
            );
        }
    }

    if (contractIssues.size > 0) {
        return {
            name: "management-extensions",
            level: "error",
            message: `扩展运行证据契约无效: ${[...contractIssues].join("；")}`,
        };
    }
    return {
        name: "management-extensions",
        level: convergenceIssues.size === 0 ? "ok" : "error",
        message:
            convergenceIssues.size === 0
                ? `扩展运行证据已验证: ${enabledCount} 个已启用，${loadedCount} 个已加载，版本均已收敛`
                : `扩展运行版本未收敛: ${[...convergenceIssues].join("；")}`,
    };
}

function isNullableVersion(value: unknown): boolean {
    return value === null || (typeof value === "string" && value.trim().length > 0);
}

function isNullableDiagnostic(value: unknown): boolean {
    return value === null || (typeof value === "string" && value.trim().length > 0);
}

function nullableString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function runtimeLabel(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
