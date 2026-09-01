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
    const configuredDirectory = fs.realpathSync(path.dirname(configuredPath));
    const resolvedDirectory = path.dirname(resolvedConfigPath);
    const backupPath = `${resolvedConfigPath}.bak`;
    return [
        inspectSensitiveFilePermissions(resolvedConfigPath, "config-mode", "配置文件", fix),
        inspectSensitiveDirectoryMutationPermissions(resolvedDirectory),
        ...(configuredDirectory !== resolvedDirectory
            ? [
                  inspectSensitiveDirectoryMutationPermissions(
                      configuredDirectory,
                      "config-entry-dir-mode",
                      "配置入口目录",
                      "配置链接",
                  ),
              ]
            : []),
        ...(fs.existsSync(backupPath)
            ? [inspectSensitiveFilePermissions(backupPath, "config-backup-mode", "配置备份", fix)]
            : []),
    ];
}
