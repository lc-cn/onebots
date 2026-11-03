import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { acquireExclusiveFileLock } from "../exclusive-file-lock.js";
import { exists, physicalIdentity, syncDirectory } from "./files.js";
import {
    createWindowsPrivateDirectory,
    inspectWindowsPrivateFile,
    replaceWindowsPrivateFile,
} from "../windows-private-file.js";
import { UUID, type RegistrationRecord } from "./types.js";

const registryFile = (directory: string) => path.join(directory, "authority.sqlite");
function secureFile(file: string): void {
    const stat = fs.lstatSync(file);
    if (process.platform === "win32") inspectWindowsPrivateFile(file);
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        (process.platform !== "win32" &&
            ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())))
    )
        throw new Error("authority 登记簿边界或权限无效");
    physicalIdentity(path.dirname(file));
}

export class AuthorityRegistry {
    private constructor(
        private readonly database: DatabaseSync,
        readonly authorityId: string,
    ) {}

    static open(directory: string, initializationId?: string): AuthorityRegistry {
        if (initializationId !== undefined && !UUID.test(initializationId))
            throw new Error("authority 身份无效");
        if (!exists(directory)) {
            if (!initializationId)
                throw Object.assign(new Error("authority 目录缺失"), { code: "ENOENT" });
            // 只创建最后一层；父目录属于可信部署配置，不递归接管任何已有数据。
            if (process.platform === "win32") createWindowsPrivateDirectory(directory);
            else fs.mkdirSync(directory, { mode: 0o700 });
            if (process.platform !== "win32") syncDirectory(path.dirname(directory));
        }
        physicalIdentity(directory);
        const file = registryFile(directory);
        let created = false;
        if (!exists(file)) {
            if (!initializationId)
                throw Object.assign(new Error("authority 登记簿缺失"), { code: "ENOENT" });
            if (process.platform === "win32")
                replaceWindowsPrivateFile({
                    directory,
                    fileName: path.basename(file),
                    expectedDigest: null,
                    bytes: Buffer.alloc(0),
                });
            else {
                const descriptor = fs.openSync(file, "wx", 0o600);
                try {
                    fs.fsyncSync(descriptor);
                } finally {
                    fs.closeSync(descriptor);
                }
            }
            created = true;
        }
        secureFile(file);
        const database = new DatabaseSync(file, { readOnly: initializationId === undefined });
        try {
            database.exec("PRAGMA busy_timeout = 0");
            if (initializationId !== undefined) database.exec("PRAGMA synchronous = FULL");
            if (created) {
                database.exec("BEGIN IMMEDIATE");
                try {
                    database.exec(
                        "CREATE TABLE authority (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL, id TEXT NOT NULL); CREATE TABLE registrations (id TEXT PRIMARY KEY, workspace_id TEXT UNIQUE NOT NULL, physical TEXT UNIQUE NOT NULL, status TEXT NOT NULL, record TEXT NOT NULL)",
                    );
                    database
                        .prepare("INSERT INTO authority VALUES (1, 1, ?)")
                        .run(initializationId!);
                    database.exec("COMMIT");
                    if (process.platform !== "win32") syncDirectory(directory);
                } catch (error) {
                    database.exec("ROLLBACK");
                    throw error;
                }
            }
            const authority = database
                .prepare("SELECT version, id FROM authority WHERE singleton=1")
                .get();
            if (
                !authority ||
                authority.version !== 1 ||
                typeof authority.id !== "string" ||
                !UUID.test(authority.id)
            )
                throw new Error("authority 登记簿版本或身份无效");
            if (initializationId !== undefined && authority.id !== initializationId)
                throw new Error("authority 已变化，计划过期");
            database
                .prepare(
                    "SELECT id, workspace_id, physical, status, record FROM registrations LIMIT 0",
                )
                .all();
            const check = database.prepare("PRAGMA quick_check").get();
            if (!check || Object.values(check)[0] !== "ok") throw new Error("authority 登记簿损坏");
            return new AuthorityRegistry(database, authority.id);
        } catch (error) {
            database.close();
            throw error;
        }
    }

    findById(id: string): RegistrationRecord | undefined {
        if (!UUID.test(id)) throw new Error("登记请求无效");
        const row = this.database
            .prepare("SELECT status, record FROM registrations WHERE id=?")
            .get(id);
        if (!row) return undefined;
        if (typeof row.record !== "string") throw new Error("登记记录损坏");
        let value: unknown;
        try {
            value = JSON.parse(row.record);
        } catch {
            throw new Error("登记记录损坏");
        }
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("登记记录损坏");
        const record = value as RegistrationRecord;
        if (
            record.schemaVersion !== 1 ||
            record.status !== row.status ||
            !["prepared", "committed"].includes(record.status) ||
            record.plan?.requestId !== id ||
            record.binding?.operationId !== id ||
            record.binding.schemaVersion !== 1 ||
            record.binding.authorityId !== this.authorityId ||
            !UUID.test(record.binding.workspaceId) ||
            record.binding.bindingRevision !== 1 ||
            record.plan.workspaceId !== record.binding.workspaceId ||
            !record.identity ||
            !["posix", "windows"].includes(record.identity.provider) ||
            typeof record.identity.volume !== "string" ||
            typeof record.identity.object !== "string"
        )
            throw new Error("登记记录结构无效");
        return record;
    }

    byPhysical(identity: string): RegistrationRecord | undefined {
        const row = this.database
            .prepare("SELECT id FROM registrations WHERE physical=?")
            .get(identity);
        return typeof row?.id === "string" ? this.findById(row.id) : undefined;
    }
    prepare(record: RegistrationRecord): void {
        this.database
            .prepare("INSERT INTO registrations VALUES (?, ?, ?, 'prepared', ?)")
            .run(
                record.plan.requestId,
                record.binding.workspaceId,
                JSON.stringify(record.identity),
                JSON.stringify(record),
            );
    }
    commit(record: RegistrationRecord): void {
        const committed: RegistrationRecord = { ...record, status: "committed" };
        const result = this.database
            .prepare(
                "UPDATE registrations SET status='committed', record=? WHERE id=? AND status='prepared' AND record=?",
            )
            .run(JSON.stringify(committed), record.plan.requestId, JSON.stringify(record));
        if (result.changes !== 1) throw new Error("登记提交结果未知");
    }
    close(): void {
        this.database.close();
    }
}

export function acquireAuthorityLock(directory: string, workspaceId: string): () => void {
    if (!UUID.test(workspaceId)) throw new Error("工作区身份无效");
    physicalIdentity(directory);
    const filename = path.join(directory, `${workspaceId}.sqlite`);
    if (process.platform === "win32" && !exists(filename))
        replaceWindowsPrivateFile({
            directory,
            fileName: path.basename(filename),
            expectedDigest: null,
            bytes: Buffer.alloc(0),
        });
    return acquireExclusiveFileLock(filename, {
        busyMessage: "同一工作区身份已有运行者或登记者",
        invalidMessage: "authority 运行锁边界或权限无效",
        unavailableMessage: "authority 运行锁不可用",
        prepareSecurity:
            process.platform === "win32" ? file => inspectWindowsPrivateFile(file) : undefined,
    });
}
