import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { inspectPackageManifest, type PackageManifest } from "./package-manifest.js";
import type { PluginInspection, PluginType, ReadyPluginInspection } from "./plugin-loader-types.js";

/** 所有 CLI 路径共享同一组插件包名候选，避免运行、doctor 与服务预检规则漂移。 */
export function pluginCandidates(type: PluginType, name: string): string[] {
    const prefix =
        type === "adapter" ? "adapter" : type === "protocol" ? "protocol" : "application";
    return [`@onebots/${prefix}-${name}`, `onebots-${prefix}-${name}`, name];
}

/** 区分插件未安装与 workspace 包存在但构建入口缺失。 */
export function inspectPlugin(
    candidates: string[],
    runtimeRequire: NodeJS.Require,
): PluginInspection {
    for (const candidate of candidates) {
        let requireEntry: string | undefined;
        try {
            requireEntry = runtimeRequire.resolve(candidate);
        } catch {
            // 纯 ESM 包可能只暴露 exports.import，继续从 package.json 解析。
        }

        const packageJsonPath = resolvePackageJson(candidate, runtimeRequire, requireEntry);
        if (packageJsonPath) {
            const manifestInspection = inspectPackageManifest(packageJsonPath);
            if ("error" in manifestInspection) {
                return {
                    status: "broken",
                    candidate,
                    reason: manifestInspection.error,
                };
            }
            const manifest = manifestInspection.manifest;
            const expectedPackageName = parsePackageName(candidate);
            if (expectedPackageName && manifest.name !== expectedPackageName) {
                const actualPackageName =
                    typeof manifest.name === "string" && manifest.name.trim()
                        ? manifest.name.trim()
                        : "未声明";
                return {
                    status: "broken",
                    candidate,
                    reason: `package.json 包名错配，期望 ${expectedPackageName}，实际 ${actualPackageName}`,
                };
            }
            const entryPath = resolvePackageEntry(candidate, packageJsonPath, manifest);
            if (!entryPath) {
                return {
                    status: "broken",
                    candidate,
                    reason: "package.json 未提供可导入的插件入口",
                    buildCommand: candidate.startsWith("@onebots/")
                        ? `pnpm --filter ${candidate} build`
                        : undefined,
                };
            }
            if (fs.existsSync(entryPath)) {
                const boundaryError = inspectPackageEntryBoundary(packageJsonPath, entryPath);
                if (boundaryError) {
                    return {
                        status: "broken",
                        candidate,
                        reason: boundaryError,
                    };
                }
                return readyInspection(candidate, entryPath, manifest);
            }
            return {
                status: "broken",
                candidate,
                reason: `构建产物不存在: ${entryPath}`,
                buildCommand: candidate.startsWith("@onebots/")
                    ? `pnpm --filter ${candidate} build`
                    : undefined,
            };
        }

        if (requireEntry) return readyInspection(candidate, requireEntry);
    }
    return { status: "missing", candidates };
}

function readyInspection(
    candidate: string,
    entryPath: string,
    manifest?: PackageManifest,
): ReadyPluginInspection {
    return {
        status: "ready",
        candidate,
        entryPath,
        packageName:
            typeof manifest?.name === "string" && manifest.name.trim()
                ? manifest.name.trim()
                : (parsePackageName(candidate) ?? candidate),
        version:
            typeof manifest?.version === "string" && manifest.version.trim()
                ? manifest.version.trim()
                : null,
    };
}

interface ExtensionRuntimeMismatch {
    packageName: "onebots" | "@onebots/core";
    pluginPackageJson: string;
    hostPackageJson: string;
}

/** 阻止插件绑定到另一套静态 Registry；这类插件即使完成初始化也不会注册到当前网关。 */
export function findExtensionRuntimeMismatch(
    entryPath: string,
): ExtensionRuntimeMismatch | undefined {
    const pluginRequire = createRequire(entryPath);
    const hostRequire = createRequire(import.meta.url);
    const hostPackages: ReadonlyArray<readonly [ExtensionRuntimeMismatch["packageName"], string?]> =
        [
            ["onebots", fileURLToPath(new URL("../package.json", import.meta.url))],
            ["@onebots/core", resolvePackageJson("@onebots/core", hostRequire)],
        ];

    for (const [packageName, hostPackageJson] of hostPackages) {
        if (!hostPackageJson) continue;
        const pluginPackageJson = resolvePackageJson(packageName, pluginRequire);
        if (!pluginPackageJson) continue;
        if (realPath(pluginPackageJson) !== realPath(hostPackageJson)) {
            return {
                packageName,
                pluginPackageJson,
                hostPackageJson,
            };
        }
    }
    return undefined;
}

export function realPath(file: string): string {
    try {
        return fs.realpathSync(file);
    } catch {
        return path.resolve(file);
    }
}

function resolvePackageJson(
    candidate: string,
    runtimeRequire: NodeJS.Require,
    requireEntry?: string,
): string | undefined {
    const packageName = parsePackageName(candidate);
    if (!packageName) return undefined;

    for (const searchPath of runtimeRequire.resolve.paths(packageName) ?? []) {
        const packageJsonPath = path.join(searchPath, packageName, "package.json");
        if (fs.existsSync(packageJsonPath)) return packageJsonPath;
    }

    if (requireEntry) {
        let directory = path.dirname(requireEntry);
        while (directory !== path.dirname(directory)) {
            const packageJsonPath = path.join(directory, "package.json");
            if (fs.existsSync(packageJsonPath)) {
                const inspection = inspectPackageManifest(packageJsonPath);
                if (inspection.valid && inspection.manifest.name === packageName) {
                    return packageJsonPath;
                }
            }
            directory = path.dirname(directory);
        }
    }
    return undefined;
}

/** 允许整个包目录由 workspace/pnpm 软链接提供，但包内 manifest 与入口必须留在实际包根。 */
function inspectPackageEntryBoundary(
    packageJsonPath: string,
    entryPath: string,
): string | undefined {
    try {
        const packageRoot = fs.realpathSync(path.dirname(packageJsonPath));
        const manifestPath = fs.realpathSync(packageJsonPath);
        if (path.dirname(manifestPath) !== packageRoot) {
            return `package.json 解析到实际包目录外: ${manifestPath}`;
        }
        const resolvedEntry = fs.realpathSync(entryPath);
        const relative = path.relative(packageRoot, resolvedEntry);
        if (
            relative === ".." ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative)
        ) {
            return `插件入口解析到实际包目录外: ${resolvedEntry}`;
        }
        if (!fs.statSync(resolvedEntry).isFile()) {
            return `插件入口不是常规文件: ${resolvedEntry}`;
        }
        return undefined;
    } catch (error) {
        return `无法确认插件入口的实际归属: ${error instanceof Error ? error.message : String(error)}`;
    }
}

function resolvePackageEntry(
    candidate: string,
    packageJsonPath: string,
    manifest: PackageManifest,
): string | undefined {
    const packageName = parsePackageName(candidate);
    if (!packageName) return undefined;
    const subpath = candidate === packageName ? "." : `.${candidate.slice(packageName.length)}`;
    const exported = resolveExportTarget(manifest.exports, subpath);
    const usesExports = manifest.exports !== undefined;
    const target =
        exported ??
        (!usesExports && typeof manifest.module === "string" ? manifest.module : undefined) ??
        (!usesExports && typeof manifest.main === "string" ? manifest.main : undefined) ??
        (!usesExports ? "index.js" : undefined);
    if (!target || (usesExports && !target.startsWith("./")) || path.isAbsolute(target)) {
        return undefined;
    }

    const packageDirectory = path.dirname(packageJsonPath);
    const entryPath = path.resolve(packageDirectory, target);
    const relative = path.relative(packageDirectory, entryPath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return undefined;
    }
    return entryPath;
}

function resolveExportTarget(exportsValue: unknown, subpath: string): string | undefined {
    if (typeof exportsValue === "string") return subpath === "." ? exportsValue : undefined;
    if (Array.isArray(exportsValue)) {
        for (const option of exportsValue) {
            const target = resolveExportTarget(option, subpath);
            if (target) return target;
        }
        return undefined;
    }
    if (!exportsValue || typeof exportsValue !== "object") return undefined;

    const exportsMap = exportsValue as Record<string, unknown>;
    const hasSubpaths = Object.keys(exportsMap).some(key => key.startsWith("."));
    if (hasSubpaths) return resolveExportTarget(exportsMap[subpath], ".");
    if (subpath !== ".") return undefined;
    for (const condition of ["import", "node", "default", "require"] as const) {
        const target = resolveExportTarget(exportsMap[condition], ".");
        if (target) return target;
    }
    return undefined;
}

function parsePackageName(candidate: string): string | undefined {
    if (candidate.startsWith(".") || candidate.startsWith("/") || candidate.startsWith("file:")) {
        return undefined;
    }
    const parts = candidate.split("/");
    if (candidate.startsWith("@")) {
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
    }
    return parts[0] || undefined;
}
