import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { WeComKfError } from "./errors.js";

/** 读取并严格校验按客服账号分区的 sync_msg 游标。 */
export async function loadKfCursors(path?: string): Promise<Map<string, string>> {
    if (!path) return new Map();

    let source: string;
    try {
        source = await readFile(path, "utf8");
    } catch (error) {
        if (isMissingFile(error)) return new Map();
        throw new WeComKfError(`读取微信客服同步游标失败：${path}`, {
            code: "WECOM_KF_CURSOR_READ_ERROR",
            path,
            cause: error,
        });
    }

    try {
        const value: unknown = JSON.parse(source);
        if (!isStringRecord(value)) throw new Error("游标文件必须是字符串键值对象");
        return new Map(Object.entries(value));
    } catch (error) {
        throw new WeComKfError(`微信客服同步游标文件格式无效：${path}`, {
            code: "WECOM_KF_CURSOR_INVALID",
            path,
            cause: error,
        });
    }
}

/** 使用同目录临时文件和原子替换持久化游标，避免进程中断留下半份 JSON。 */
export async function persistKfCursors(
    path: string | undefined,
    cursors: ReadonlyMap<string, string>,
): Promise<void> {
    if (!path) return;

    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(
            temporaryPath,
            `${JSON.stringify(Object.fromEntries(cursors), null, 2)}\n`,
            "utf8",
        );
        await rename(temporaryPath, path);
    } catch (error) {
        // 原始写入错误优先；清理失败不应覆盖真正的持久化失败原因。
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw new WeComKfError(`写入微信客服同步游标失败：${path}`, {
            code: "WECOM_KF_CURSOR_WRITE_ERROR",
            path,
            cause: error,
        });
    }
}

function isMissingFile(error: unknown): boolean {
    return (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
    );
}

function isStringRecord(value: unknown): value is Record<string, string> {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        Object.values(value).every(item => typeof item === "string")
    );
}
