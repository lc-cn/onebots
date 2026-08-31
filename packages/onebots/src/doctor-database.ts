import * as fs from "node:fs";
import * as path from "node:path";
import { resolveDatabaseFilePath } from "@onebots/core";
import type { DoctorCheck } from "./doctor-endpoint.js";

export interface DoctorDatabaseInspection {
    path: string | null;
    check: DoctorCheck | null;
}

/** 解析并验证候选配置实际使用的 SQLite 文件，而不是只检查默认 data 目录。 */
export function inspectConfiguredDatabase(
    dataDirectory: string,
    config: Record<string, unknown> | null,
): DoctorDatabaseInspection {
    if (!config) return { path: null, check: null };
    const configured = config.database ?? "onebots.db";
    if (typeof configured !== "string" || configured.length === 0) {
        return {
            path: null,
            check: {
                name: "database",
                level: "error",
                message: "数据库路径配置无效: database 必须是非空字符串",
            },
        };
    }
    const databasePath = resolveDatabaseFilePath(dataDirectory, configured);
    return { path: databasePath, check: inspectDatabaseFile(databasePath) };
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
    let currentPath = startPath;
    while (true) {
        try {
            const stat = fs.statSync(currentPath);
            if (!stat.isDirectory()) {
                return databaseError(`数据库父路径不是目录: ${currentPath}`);
            }
            fs.accessSync(currentPath, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
            return null;
        } catch (error) {
            if (!isMissingPathError(error)) {
                return databaseError(`数据库父目录不可用: ${formatFileSystemError(error)}`);
            }
            const parentPath = path.dirname(currentPath);
            if (parentPath === currentPath) {
                return databaseError(`无法找到可创建数据库的父目录: ${startPath}`);
            }
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
