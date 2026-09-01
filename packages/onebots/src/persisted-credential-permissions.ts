import * as fs from "node:fs";
import * as path from "node:path";
import type { DoctorCheck } from "./doctor-endpoint.js";
import {
    inspectSensitiveDirectoryMutationPermissions,
    inspectSensitiveFilePermissions,
} from "./doctor-permissions.js";

/** 生成配置、备份与父目录对持久化管理凭据的完整 POSIX 权限证据。 */
export function inspectPersistedCredentialPermissions(
    configPath: string,
    fix = false,
): DoctorCheck[] {
    if (process.platform === "win32") return [];
    const configuredPath = path.resolve(configPath);
    const resolvedConfigPath = fs.realpathSync(configPath);
    const resolvedDirectory = path.dirname(resolvedConfigPath);
    const backupPath = `${resolvedConfigPath}.bak`;
    return [
        inspectSensitiveFilePermissions(resolvedConfigPath, "config-mode", "配置文件", fix),
        inspectSensitiveDirectoryMutationPermissions(resolvedDirectory),
        ...inspectConfigSymlinkEntryPermissions(configuredPath),
        ...(fs.existsSync(backupPath)
            ? [inspectSensitiveFilePermissions(backupPath, "config-backup-mode", "配置备份", fix)]
            : []),
    ];
}

/** 检查配置路径中每个符号链接组件的所在目录，只发布需要运维关注的聚合证据。 */
function inspectConfigSymlinkEntryPermissions(configuredPath: string): DoctorCheck[] {
    try {
        const root = path.parse(configuredPath).root;
        const components = configuredPath.slice(root.length).split(path.sep).filter(Boolean);
        const entryDirectories = new Set<string>();
        let current = root;
        for (const component of components) {
            current = path.join(current, component);
            if (fs.lstatSync(current).isSymbolicLink()) {
                entryDirectories.add(fs.realpathSync(path.dirname(current)));
            }
        }
        const riskyChecks = [...entryDirectories]
            .map(directory =>
                inspectSensitiveDirectoryMutationPermissions(
                    directory,
                    "config-entry-dir-mode",
                    "配置链接入口目录",
                    "配置路径组件",
                ),
            )
            .filter(check => check.level !== "ok");
        if (riskyChecks.length === 0) return [];
        return [
            {
                name: "config-entry-dir-mode",
                level: riskyChecks.some(check => check.level === "error") ? "error" : "warning",
                message: `配置路径包含需要关注的符号链接入口：${riskyChecks.map(check => check.message).join("；")}`,
            },
        ];
    } catch (error) {
        const code =
            error instanceof Error && "code" in error && typeof error.code === "string"
                ? error.code
                : "UNKNOWN";
        return [
            {
                name: "config-entry-dir-mode",
                level: "error",
                message: `配置符号链接入口权限无法验证: ${configuredPath} (${code})`,
            },
        ];
    }
}
