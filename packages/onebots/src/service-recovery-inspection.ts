import fs from "node:fs";
import path from "node:path";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { parseManagerServiceRecord } from "./manager-service-journal.js";
import { parseServiceMigrationRecord } from "./service-migration-journal.js";

const ID = "[A-Za-z0-9_-]{1,128}";
function fail(): never {
    throw new Error("系统操作恢复状态无法读取");
}
function stat(file: string, mode: number, directory = false): fs.Stats {
    const result = fs.lstatSync(file);
    if (
        (directory ? !result.isDirectory() : !result.isFile() || result.nlink !== 1) ||
        result.isSymbolicLink() ||
        (result.mode & 0o7777) !== mode ||
        (process.getuid && result.uid !== process.getuid())
    )
        fail();
    return result;
}
function entries(directory: string): { names: string[]; identity: string } | null {
    // 不沿祖先链接把其他位置或悬空链接解释为“没有记录”。
    for (let current = path.dirname(directory); ; current = path.dirname(current)) {
        try {
            const item = fs.lstatSync(current);
            if (!item.isDirectory() || item.isSymbolicLink()) fail();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (path.dirname(current) === current) break;
    }
    let before: fs.Stats;
    try {
        before = fs.lstatSync(directory);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
    stat(directory, 0o700, true);
    const names = fs.readdirSync(directory).sort();
    if (names.length > 10000) fail();
    return {
        names,
        identity: [before.dev, before.ino, before.mode, before.mtimeMs, before.ctimeMs].join(":"),
    };
}
function read(file: string, maximum: number): unknown {
    const before = stat(file, 0o600);
    if (before.size > maximum) fail();
    const raw = new ConfigurationFile(file).readRaw();
    const after = stat(file, 0o600);
    if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        raw.bytes.length > maximum
    )
        fail();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw.bytes));
}
function inspect(directory: string, migration: boolean): boolean {
    const before = entries(directory);
    if (!before) return false;
    let pending = false;
    const referenced = new Set<string>();
    const backups: string[] = [];
    for (const name of before.names) {
        if (migration && /^[a-f0-9]{64}\.backup\.json$/.test(name)) {
            // 只验证备份文件的存在/类型/权限；status绝不打开或解析私有备份正文。
            if (stat(path.join(directory, name), 0o400).size > 8 * 1024 * 1024) fail();
            backups.push(name);
            continue;
        }
        const match = new RegExp(
            "^(" + ID + ")" + (migration ? "\\.journal" : "") + "\\.json$",
        ).exec(name);
        if (!match) fail();
        const raw = read(path.join(directory, name), migration ? 16384 : 32768);
        if (migration) {
            const record = parseServiceMigrationRecord(raw);
            if (record.id !== match[1]) fail();
            referenced.add(record.backupDigest + ".backup.json");
            pending ||=
                record.recoveryRequired ||
                record.phase !== "completed" ||
                !(
                    record.status === "succeeded" ||
                    (record.status === "failed" && record.rolledBack)
                );
        } else {
            const record = parseManagerServiceRecord(raw);
            if (record.id !== match[1]) fail();
            pending ||=
                record.recoveryRequired ||
                record.phase !== "completed" ||
                !["succeeded", "failed"].includes(record.status);
        }
    }
    if (
        migration &&
        (backups.some(name => !referenced.has(name)) ||
            [...referenced].some(name => !backups.includes(name)))
    )
        fail();
    const after = entries(directory);
    if (
        !after ||
        after.identity !== before.identity ||
        after.names.join("\n") !== before.names.join("\n")
    )
        fail();
    return pending;
}
/** 纯只读摘要，不实例化会mkdir/chmod/coldmark的journal；未知痕迹保守要求对账。 */
export function inspectServiceRecovery(stateDirectory: string): {
    serviceRecoveryRequired: boolean;
} {
    try {
        if (!path.isAbsolute(stateDirectory) || /[\u0000-\u001f\u007f]/.test(stateDirectory))
            fail();
        const manager = inspect(path.join(stateDirectory, "manager-operations"), false);
        const migration = inspect(path.join(stateDirectory, "migrations"), true);
        return { serviceRecoveryRequired: manager || migration };
    } catch {
        return { serviceRecoveryRequired: true };
    }
}
