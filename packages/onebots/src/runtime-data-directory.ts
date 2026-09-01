import * as fs from "node:fs";

export type RuntimeDataDirectoryInspection =
    | { status: "ready" }
    | { status: "missing" }
    | { status: "invalid"; error: string };

/** 检查运行时数据路径的目录类型与当前进程访问能力，不产生文件系统变更。 */
export function inspectRuntimeDataDirectory(dataDirectory: string): RuntimeDataDirectoryInspection {
    try {
        const stat = fs.statSync(dataDirectory);
        if (!stat.isDirectory()) {
            return {
                status: "invalid",
                error: `数据存储路径不是目录: ${dataDirectory}`,
            };
        }
        fs.accessSync(dataDirectory, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
        return { status: "ready" };
    } catch (error) {
        if (isFileSystemError(error, "ENOENT")) return { status: "missing" };
        return {
            status: "invalid",
            error: `数据目录不可用: ${formatFileSystemError(error)}`,
        };
    }
}

/** 确保数据目录真实可用；既有冲突路径与权限问题不会被覆盖或修改。 */
export function ensureRuntimeDataDirectory(dataDirectory: string): { created: boolean } {
    const inspection = inspectRuntimeDataDirectory(dataDirectory);
    if (inspection.status === "ready") return { created: false };
    if (inspection.status === "invalid") throw new Error(inspection.error);

    try {
        fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    } catch (error) {
        throw new Error(`无法创建可用的数据目录: ${formatFileSystemError(error)}`, {
            cause: error,
        });
    }
    const created = inspectRuntimeDataDirectory(dataDirectory);
    if (created.status !== "ready") {
        throw new Error(
            created.status === "invalid"
                ? created.error
                : `数据目录创建后仍不存在: ${dataDirectory}`,
        );
    }
    return { created: true };
}

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === code;
}

function formatFileSystemError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
