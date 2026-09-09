import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

export interface ExclusiveFileLockOptions {
    busyMessage: string;
    invalidMessage: string;
    unavailableMessage: string;
    /** 仅兼容已有工作区锁权限；新服务状态锁应拒绝不安全权限。 */
    repairPermissions?: boolean;
    /** Windows 由原生 ACL 证明替代无意义的 POSIX mode 位；既有文件只允许只读核验。 */
    prepareSecurity?: (filename: string, created: boolean) => void;
}
/** 单一SQLite写事务持锁；仅用于可靠本地卷。不得删除/替换锁文件解除占用。 */
export function acquireExclusiveFileLock(
    filename: string,
    options: ExclusiveFileLockOptions,
): () => void {
    let created = false;
    try {
        const descriptor = fs.openSync(filename, "wx", 0o600);
        fs.closeSync(descriptor);
        created = true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stat = fs.lstatSync(filename);
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        (process.getuid && stat.uid !== process.getuid()) ||
        (!options.prepareSecurity && !options.repairPermissions && (stat.mode & 0o077) !== 0)
    )
        throw new Error(options.invalidMessage);
    options.prepareSecurity?.(filename, created);
    if (options.repairPermissions) fs.chmodSync(filename, 0o600);
    let database: DatabaseSync | undefined;
    try {
        database = new DatabaseSync(filename);
        database.exec("PRAGMA busy_timeout = 0");
        // 无需建表。DDL与BEGIN分属两个事务会在新数据库并发初始化时造成全败。
        database.exec("BEGIN IMMEDIATE");
    } catch (error) {
        database?.close();
        if (
            error instanceof Error &&
            "errcode" in error &&
            (error.errcode === 5 || error.errcode === 6)
        )
            throw new Error(options.busyMessage);
        throw new Error(options.unavailableMessage, { cause: error });
    }
    const held = database;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        try {
            held.exec("ROLLBACK");
        } finally {
            held.close();
        }
    };
}
