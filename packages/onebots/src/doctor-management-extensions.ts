import type { DoctorCheck } from "./doctor-endpoint.js";
import type { ManagementFetch } from "./management-credential.js";
import { readDoctorManagementJson } from "./doctor-management-response.js";

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

/** 验证在线进程实际加载版本与当前磁盘依赖已经收敛。 */
export async function probeAuthenticatedExtensions(
    base: string,
    token: string,
    fetcher: ManagementFetch,
): Promise<DoctorCheck> {
    try {
        const response = await fetcher(`${base}/api/extensions`, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(2_000),
        });
        const payload = await readDoctorManagementJson(response);
        if (!response.ok || !Array.isArray(payload)) {
            return {
                name: "management-extensions",
                level: "error",
                message: `扩展运行证据响应无效: HTTP ${response.status}`,
            };
        }

        return inspectRuntimeExtensions(payload);
    } catch (error) {
        return {
            name: "management-extensions",
            level: "error",
            message: `扩展运行证据探测失败: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
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
