import * as fs from "node:fs";
import * as path from "node:path";
import { resolveDatabaseFilePath } from "@onebots/core";
import type { DoctorCheck } from "./doctor-endpoint.js";
import {
    inspectSensitiveDirectoryMutationPermissions,
    inspectSensitiveFilePermissions,
} from "./doctor-permissions.js";

export interface DoctorDatabaseInspection {
    path: string | null;
    checks: DoctorCheck[];
}

/** 解析并验证候选配置实际使用的 SQLite 文件，而不是只检查默认 data 目录。 */
export function inspectConfiguredDatabase(
    dataDirectory: string,
    config: Record<string, unknown> | null,
): DoctorDatabaseInspection {
    if (!config) return { path: null, checks: [] };
    const configured = config.database ?? "onebots.db";
    if (typeof configured !== "string" || configured.length === 0) {
        return {
            path: null,
            checks: [
                {
                    name: "database",
                    level: "error",
                    message: "数据库路径配置无效: database 必须是非空字符串",
                },
            ],
        };
    }
    const databasePath = resolveDatabaseFilePath(dataDirectory, configured);
    return { path: databasePath, checks: inspectDatabase(databasePath) };
}

/** 验证 SQLite 可用性，并在 POSIX 上独立证明文件与实际父目录的访问边界。 */
export function inspectDatabase(databasePath: string): DoctorCheck[] {
    const availability = inspectDatabaseFile(databasePath);
    if (availability.level === "error") return [availability];

    const checks = [availability];
    if (process.platform === "win32") return checks;

    const existingDatabase = fs.existsSync(databasePath);
    const permissionTarget = existingDatabase ? fs.realpathSync(databasePath) : databasePath;
    if (existingDatabase) {
        checks.push(
            inspectSensitiveFilePermissions(
                permissionTarget,
                "database-mode",
                "数据库文件",
                false,
                false,
            ),
        );
    }
    checks.push(
        inspectSensitiveDirectoryMutationPermissions(
            findExistingParent(path.dirname(permissionTarget)),
            "database-dir-mode",
            "数据库目录",
            "数据库路径",
        ),
    );
    return checks;
}

export function inspectDatabaseFile(databasePath: string): DoctorCheck {
    try {
        const stat = fs.statSync(databasePath);
        if (!stat.isFile()) {
            return databaseError(`数据库路径不是文件: ${databasePath}`);
        }
        fs.accessSync(databasePath, fs.constants.R_OK | fs.constants.W_OK);
        const parentError = inspectCreatableParent(path.dirname(databasePath));
        return (
            parentError ?? {
                name: "database",
                level: "ok",
                message: `数据库文件及其父目录可写: ${databasePath}`,
            }
        );
    } catch (error) {
        if (!isMissingPathError(error)) {
            return databaseError(`数据库文件不可用: ${formatFileSystemError(error)}`);
        }
        const parentError = inspectCreatableParent(path.dirname(databasePath));
        return (
            parentError ?? {
                name: "database",
                level: "ok",
                message: `数据库文件可创建: ${databasePath}`,
            }
        );
    }
}

function inspectCreatableParent(startPath: string): DoctorCheck | null {
    const currentPath = findExistingParent(startPath);
    try {
        const stat = fs.statSync(currentPath);
        if (!stat.isDirectory()) {
            return databaseError(`数据库父路径不是目录: ${currentPath}`);
        }
        fs.accessSync(currentPath, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
        return null;
    } catch (error) {
        return databaseError(`数据库父目录不可用: ${formatFileSystemError(error)}`);
    }
}

function findExistingParent(startPath: string): string {
    let currentPath = startPath;
    while (true) {
        try {
            fs.statSync(currentPath);
            return currentPath;
        } catch (error) {
            if (!isMissingPathError(error)) return currentPath;
            const parentPath = path.dirname(currentPath);
            if (parentPath === currentPath) return currentPath;
            currentPath = parentPath;
        }
    }
}

function databaseError(message: string): DoctorCheck {
    return { name: "database", level: "error", message };
}

function isMissingPathError(error: unknown): boolean {
    return (
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
    );
}

function formatFileSystemError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
