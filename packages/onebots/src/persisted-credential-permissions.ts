import * as fs from "node:fs";
import * as path from "node:path";
import type { DoctorCheck } from "./doctor-endpoint.js";
import {
    inspectSensitiveDirectoryMutationPermissions,
    inspectSensitiveFilePermissions,
} from "./doctor-permissions.js";

/** 生成配置、备份与父目录对持久化管理凭据的完整 POSIX 权限证据。 */
export function inspectPersistedCredentialPermissions(configPath: string): DoctorCheck[] {
    if (process.platform === "win32") return [];
    const resolvedConfigPath = fs.realpathSync(configPath);
    const backupPath = `${resolvedConfigPath}.bak`;
    return [
        inspectSensitiveFilePermissions(resolvedConfigPath, "config-mode", "配置文件"),
        inspectSensitiveDirectoryMutationPermissions(path.dirname(resolvedConfigPath)),
        ...(fs.existsSync(backupPath)
            ? [inspectSensitiveFilePermissions(backupPath, "config-backup-mode", "配置备份")]
            : []),
    ];
}
