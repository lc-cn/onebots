import * as fs from "node:fs";
import * as path from "node:path";
import type { DoctorCheck } from "./doctor-endpoint.js";
import packageMetadata from "../package.json" with { type: "json" };

export interface DoctorServiceEntryInspection {
    valid: boolean;
    check: DoctorCheck;
}

interface PackageManifest {
    name?: unknown;
    version?: unknown;
    bin?: unknown;
}

/** 证明服务入口来自当前 OneBots 包，而不是只确认 binPath 处存在一个文件。 */
export function inspectServiceEntry(
    binPath: string,
    expectedVersion = packageMetadata.version,
): DoctorServiceEntryInspection {
    const requestedPath = path.resolve(binPath);
    let entryPath: string;
    try {
        if (!fs.statSync(requestedPath).isFile()) {
            return invalid(`服务入口不是文件: ${requestedPath}`);
        }
        entryPath = fs.realpathSync(requestedPath);
    } catch {
        return invalid(`服务入口不可读取: ${requestedPath}`);
    }

    const manifestPath = findNearestManifest(path.dirname(entryPath));
    if (!manifestPath) return invalid(`服务入口不属于可识别的 npm 包: ${entryPath}`);

    let manifest: PackageManifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PackageManifest;
    } catch {
        return invalid(`服务入口所属 package.json 无法读取或不是有效 JSON: ${manifestPath}`);
    }
    if (manifest.name !== packageMetadata.name) {
        return invalid(
            `服务入口包名错配，期望 ${packageMetadata.name}，实际 ${formatManifestValue(manifest.name)}: ${manifestPath}`,
        );
    }
    if (manifest.version !== expectedVersion) {
        return invalid(
            `服务入口版本错配，期望 ${packageMetadata.name}@${expectedVersion}，实际 ${packageMetadata.name}@${formatManifestValue(manifest.version)}: ${manifestPath}`,
        );
    }

    const declaredEntry = readOnebotsBin(manifest.bin);
    if (!declaredEntry) {
        return invalid(`服务入口包未声明 bin.onebots: ${manifestPath}`);
    }
    const packageRoot = path.dirname(manifestPath);
    const declaredPath = path.resolve(packageRoot, declaredEntry);
    let declaredRealPath: string;
    try {
        declaredRealPath = fs.realpathSync(declaredPath);
    } catch {
        return invalid(`服务入口包声明的 bin.onebots 不存在: ${declaredPath}`);
    }
    if (declaredRealPath !== entryPath) {
        return invalid(`服务入口与 bin.onebots 声明不一致: ${entryPath}`);
    }

    return {
        valid: true,
        check: {
            name: "service-entry",
            level: "ok",
            message: `服务入口 ${packageMetadata.name}@${expectedVersion}: ${entryPath}`,
        },
    };
}

function findNearestManifest(startPath: string): string | null {
    let currentPath = startPath;
    while (true) {
        const candidate = path.join(currentPath, "package.json");
        if (fs.existsSync(candidate)) return candidate;
        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) return null;
        currentPath = parentPath;
    }
}

function readOnebotsBin(bin: unknown): string | null {
    if (typeof bin === "string" && bin.trim()) return bin;
    if (typeof bin !== "object" || bin === null || Array.isArray(bin)) return null;
    const value = (bin as Record<string, unknown>)[packageMetadata.name];
    return typeof value === "string" && value.trim() ? value : null;
}

function formatManifestValue(value: unknown): string {
    return typeof value === "string" && value.trim() ? value : "未声明";
}

function invalid(message: string): DoctorServiceEntryInspection {
    return { valid: false, check: { name: "service-entry", level: "error", message } };
}
