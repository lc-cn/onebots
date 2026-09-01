import * as fs from "node:fs";
import * as path from "node:path";
import packageMetadata from "../package.json" with { type: "json" };
import { inspectPackageManifest, type PackageManifest } from "./package-manifest.js";

export interface ExtensionRuntimeRootInspection {
    root: string;
    version: string | null;
    error: string | null;
}

export interface ExtensionRuntimeRootInspectionOptions {
    access?: (target: string, mode: number) => void;
}

/** 验证扩展安装目录确实由当前 OneBots 进程管理。 */
export function inspectExtensionRuntimeRoot(
    runtimeRoot: string,
    options: ExtensionRuntimeRootInspectionOptions = {},
): ExtensionRuntimeRootInspection {
    const root = path.resolve(runtimeRoot);
    const manifestPath = path.join(root, "package.json");
    if (!fs.existsSync(manifestPath)) {
        return invalid(
            root,
            `扩展运行目录缺少 package.json：${root}。请使用官方安装脚本部署，或设置 ONEBOTS_EXTENSION_ROOT。`,
        );
    }

    const manifestInspection = inspectPackageManifest(manifestPath);
    if ("error" in manifestInspection) {
        return invalid(root, `扩展运行目录清单无法验证：${manifestInspection.error}`);
    }
    const manifest = manifestInspection.manifest;

    if (manifest.name === packageMetadata.name) {
        if (manifest.version !== packageMetadata.version) {
            return invalid(
                root,
                `扩展运行目录声明 ${packageMetadata.name}@${String(manifest.version ?? "未声明")}，与当前进程 ${packageMetadata.name}@${packageMetadata.version} 不一致`,
            );
        }
        return inspectWritableDirectories(root, packageMetadata.version, options.access);
    }
    if (!declaresOnebotsDependency(manifest)) {
        return invalid(
            root,
            `扩展运行目录未声明 onebots 依赖：${root}。请将 ONEBOTS_EXTENSION_ROOT 指向当前 OneBots 项目。`,
        );
    }

    const installed = inspectInstalledOnebots(root);
    if (installed.error || !installed.version) {
        return invalid(
            root,
            `扩展运行目录无法验证 onebots 安装身份：${installed.error ?? "未安装"}。请先在该目录安装 OneBots。`,
        );
    }
    if (installed.version !== packageMetadata.version) {
        return invalid(
            root,
            `扩展运行目录中的 onebots@${installed.version} 与当前进程 onebots@${packageMetadata.version} 不一致。请从该目录启动 OneBots 后重试。`,
        );
    }
    return inspectWritableDirectories(root, installed.version, options.access);
}

function inspectWritableDirectories(
    root: string,
    version: string,
    access: (target: string, mode: number) => void = fs.accessSync,
): ExtensionRuntimeRootInspection {
    try {
        access(root, fs.constants.W_OK);
    } catch {
        return invalid(root, `扩展运行目录不可写：${root}。请调整目录属主或权限后重试。`);
    }

    const dependenciesRoot = path.join(root, "node_modules");
    if (fs.existsSync(dependenciesRoot)) {
        try {
            access(dependenciesRoot, fs.constants.W_OK);
        } catch {
            return invalid(
                root,
                `扩展依赖目录不可写：${dependenciesRoot}。请调整目录属主或权限后重试。`,
            );
        }
    }

    return { root, version, error: null };
}

function inspectInstalledOnebots(root: string): { version: string | null; error: string | null } {
    const manifestPath = path.join(root, "node_modules", packageMetadata.name, "package.json");
    if (!fs.existsSync(manifestPath)) {
        return { version: null, error: `${packageMetadata.name} 未安装` };
    }
    try {
        const manifestInspection = inspectPackageManifest(manifestPath);
        if ("error" in manifestInspection) {
            return { version: null, error: manifestInspection.error };
        }
        const manifest = manifestInspection.manifest;
        const actualName = typeof manifest.name === "string" ? manifest.name.trim() : "";
        if (actualName !== packageMetadata.name) {
            return {
                version: null,
                error: `${packageMetadata.name} 的 package.json 包名错配，实际为 ${actualName || "未声明"}`,
            };
        }
        const version =
            typeof manifest.version === "string" && manifest.version.trim()
                ? manifest.version.trim()
                : null;
        return version
            ? { version, error: null }
            : { version: null, error: `${packageMetadata.name} 的 package.json 未声明有效版本` };
    } catch {
        return { version: null, error: `${packageMetadata.name} 的 package.json 不是有效 JSON` };
    }
}

function declaresOnebotsDependency(manifest: PackageManifest): boolean {
    return [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies].some(
        dependencies =>
            typeof dependencies === "object" &&
            dependencies !== null &&
            Object.hasOwn(dependencies, packageMetadata.name),
    );
}

function invalid(root: string, error: string): ExtensionRuntimeRootInspection {
    return { root, version: null, error };
}
