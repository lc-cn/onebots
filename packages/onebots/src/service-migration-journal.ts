import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parseLegacyServiceSpec } from "./service-metadata.js";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import { parseRetainedLegacyRuntime } from "./service-migration-retained-runtime.js";
import type { RetainedLegacyRuntime } from "./service-migration-retained-runtime.js";
import type {
    ServiceMigrationBackup,
    ServiceMigrationRecord,
    ServiceMigrationJournal,
} from "./service-migration-types.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const LIMIT = 8 * 1024 * 1024;
const phases = [
    "prepared",
    "capturing-runtime",
    "preparing-manager",
    "stopping-old",
    "writing-target",
    "starting-manager",
    "verifying",
    "releasing-target",
    "stopping-target",
    "restoring",
    "restarting-old",
    "cancelled",
    "completed",
];
const invalid = () => new Error("服务迁移私有记录无效或需要恢复，禁止继续迁移");

/** 调用方必须持有 service 级协调锁；此模块不以 workspace 锁代替服务互斥。 */
export class FileServiceMigrationJournal implements ServiceMigrationJournal {
    private readonly directory: string;
    private readonly identity: { dev: number; ino: number };
    private blocked = false;
    constructor(directory: string) {
        try {
            fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
            const stat = fs.lstatSync(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalid();
            this.directory = fs.realpathSync(directory);
            this.identity = { dev: stat.dev, ino: stat.ino };
            fs.chmodSync(this.directory, 0o700);
            syncDirectory(path.dirname(this.directory));
            for (const name of fs.readdirSync(this.directory)) {
                if (!name.endsWith(".journal.json")) continue;
                try {
                    const record = this.read(name.slice(0, -13));
                    if (record.status === "running") {
                        record.status = "interrupted";
                        record.recoveryRequired = true;
                        this.save(record);
                    }
                } catch {
                    this.blocked = true; /* 损坏记录保留，绝不视为全新安装。 */
                }
            }
        } catch {
            throw invalid();
        }
    }
    /** 调用方持服务锁；不以新metadata或新的操作ID绕过旧迁移的恢复门禁。 */
    health(): { recoveryRequired: boolean } {
        try {
            this.checkDirectory();
            return {
                recoveryRequired:
                    this.blocked ||
                    fs
                        .readdirSync(this.directory)
                        .some(
                            name =>
                                name.endsWith(".journal.json") &&
                                !finished(this.read(name.slice(0, -13))),
                        ),
            };
        } catch {
            return { recoveryRequired: true };
        }
    }
    prepare(id: string, backup: ServiceMigrationBackup): ServiceMigrationRecord {
        try {
            this.checkDirectory();
            const file = this.file(id);
            if (this.blocked || exists(file)) throw invalid();
            for (const name of fs.readdirSync(this.directory)) {
                if (name.endsWith(".journal.json") && !finished(this.read(name.slice(0, -13))))
                    throw invalid();
            }
            const clean = parseBackup(backup);
            const content = canonical(clean);
            const backupDigest = hash(content);
            const backupFile = this.backupFile(backupDigest);
            if (!exists(backupFile)) atomic(backupFile, content, 0o400);
            const record: ServiceMigrationRecord = {
                schemaVersion: 1,
                id,
                backupDigest,
                phase: "prepared",
                status: "running",
                recoveryRequired: false,
                rolledBack: false,
            };
            this.backup(record);
            atomic(file, canonical(record), 0o600);
            return this.read(id);
        } catch {
            throw invalid();
        }
    }
    read(id: string): ServiceMigrationRecord {
        try {
            this.checkDirectory();
            const record = parseServiceMigrationRecord(
                JSON.parse(readPrivate(this.file(id), 0o600, 16_384)),
            );
            if (record.id !== id) throw invalid();
            this.backup(record);
            return record;
        } catch {
            throw invalid();
        }
    }
    /** 捕获意图已落盘后，只绑定工件，不修改原始文件备份；未知写入禁止继续停机。 */
    bindRuntime(
        record: ServiceMigrationRecord,
        retained: RetainedLegacyRuntime,
    ): ServiceMigrationRecord {
        try {
            this.checkDirectory();
            const previous = this.read(record.id);
            if (
                canonical(previous) !== canonical(record) ||
                previous.phase !== "capturing-runtime" ||
                previous.status !== "running" ||
                previous.recoveryRequired
            )
                throw invalid();
            const original = this.backup(previous);
            if (original.retainedRuntime) throw invalid();
            const metadata = original.files.find(file => file.role === "metadata");
            const retainedRuntime = parseRetainedLegacyRuntime(retained);
            if (
                !metadata ||
                !isDeepStrictEqual(
                    parseLegacyServiceSpec(
                        JSON.parse(Buffer.from(metadata.contentBase64, "base64").toString("utf8")),
                    ),
                    retainedRuntime.original,
                )
            )
                throw invalid();
            const backup = parseBackup({
                ...original,
                retainedRuntime,
            });
            const content = canonical(backup);
            const backupDigest = hash(content);
            const file = this.backupFile(backupDigest);
            if (!exists(file)) atomic(file, content, 0o400);
            const next: ServiceMigrationRecord = { ...previous, backupDigest, phase: "prepared" };
            this.backup(next);
            if (canonical(this.read(record.id)) !== canonical(previous)) throw invalid();
            atomic(this.file(record.id), canonical(next), 0o600);
            return this.read(record.id);
        } catch {
            throw invalid();
        }
    }
    backup(record: ServiceMigrationRecord): ServiceMigrationBackup {
        try {
            this.checkDirectory();
            const clean = parseServiceMigrationRecord(record);
            const content = readPrivate(this.backupFile(clean.backupDigest), 0o400, LIMIT);
            const backup = parseBackup(JSON.parse(content));
            if (hash(canonical(backup)) !== clean.backupDigest || content !== canonical(backup))
                throw invalid();
            return backup;
        } catch {
            throw invalid();
        }
    }
    bindManagerCandidate(
        record: ServiceMigrationRecord,
        input: ManagerServiceSpec,
        digest: string,
    ): ServiceMigrationRecord {
        try {
            this.checkDirectory();
            const previous = this.read(record.id);
            if (
                canonical(previous) !== canonical(record) ||
                previous.phase !== "preparing-manager" ||
                previous.status !== "running" ||
                previous.recoveryRequired ||
                !HASH.test(digest)
            )
                throw invalid();
            const original = this.backup(previous);
            if (!original.retainedRuntime || original.targetCandidateDigest) throw invalid();
            const target = parseManagerServiceSpec(input);
            if (
                !isDeepStrictEqual(target, {
                    ...original.target,
                    binPath: target.binPath,
                    workingDirectory: target.workingDirectory,
                })
            )
                throw invalid();
            const backup = parseBackup({ ...original, target, targetCandidateDigest: digest });
            const content = canonical(backup);
            const backupDigest = hash(content);
            const file = this.backupFile(backupDigest);
            if (!exists(file)) atomic(file, content, 0o400);
            const next: ServiceMigrationRecord = { ...previous, backupDigest, phase: "prepared" };
            this.backup(next);
            if (canonical(this.read(record.id)) !== canonical(previous)) throw invalid();
            atomic(this.file(record.id), canonical(next), 0o600);
            return this.read(record.id);
        } catch {
            throw invalid();
        }
    }
    save(record: ServiceMigrationRecord): void {
        try {
            this.checkDirectory();
            const clean = parseServiceMigrationRecord(record);
            const previous = this.read(clean.id);
            if (previous.backupDigest !== clean.backupDigest) throw invalid();
            if (
                clean.phase === "cancelled" &&
                previous.phase !== "cancelled" &&
                (previous.status !== "interrupted" ||
                    !previous.recoveryRequired ||
                    !["prepared", "capturing-runtime", "preparing-manager"].includes(
                        previous.phase,
                    ))
            )
                throw invalid();
            if (
                finished(previous) &&
                canonical(previous) !== canonical(clean) &&
                !(
                    clean.status === "interrupted" &&
                    clean.recoveryRequired &&
                    !clean.rolledBack &&
                    clean.phase === previous.phase
                )
            )
                throw invalid();
            if (previous.status === "interrupted" && clean.status === "running") throw invalid();
            this.backup(clean);
            atomic(this.file(clean.id), canonical(clean), 0o600);
        } catch {
            throw invalid();
        }
    }
    private file(id: string): string {
        if (typeof id !== "string" || !ID.test(id)) throw invalid();
        return path.join(this.directory, `${id}.journal.json`);
    }
    private backupFile(digest: string): string {
        if (!HASH.test(digest)) throw invalid();
        return path.join(this.directory, `${digest}.backup.json`);
    }
    private checkDirectory(): void {
        const stat = fs.lstatSync(this.directory);
        if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            stat.dev !== this.identity.dev ||
            stat.ino !== this.identity.ino ||
            (process.platform !== "win32" && (stat.mode & 0o777) !== 0o700)
        )
            throw invalid();
    }
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
        throw invalid();
    const own = Reflect.ownKeys(value);
    if (
        own.length !== keys.length ||
        own.some(key => typeof key !== "string" || !keys.includes(key))
    )
        throw invalid();
    const output: Record<string, unknown> = {};
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) throw invalid();
        output[key] = descriptor.value;
    }
    return output;
}
function parseBackup(input: unknown): ServiceMigrationBackup {
    const value = object(input, [
        "schemaVersion",
        "target",
        "previousRunning",
        "previousEnabled",
        "files",
        ...(input && typeof input === "object" && Object.hasOwn(input, "retainedRuntime")
            ? ["retainedRuntime"]
            : []),
        ...(input && typeof input === "object" && Object.hasOwn(input, "targetCandidateDigest")
            ? ["targetCandidateDigest"]
            : []),
    ]);
    if (
        value.schemaVersion !== 1 ||
        typeof value.previousRunning !== "boolean" ||
        typeof value.previousEnabled !== "boolean" ||
        !Array.isArray(value.files) ||
        Reflect.ownKeys(value.files).length !== value.files.length + 1 ||
        value.files.length < 3 ||
        value.files.length > 4
    )
        throw invalid();
    const target = parseManagerServiceSpec(value.target);
    if (
        Object.hasOwn(value, "targetCandidateDigest") &&
        (typeof value.targetCandidateDigest !== "string" ||
            !HASH.test(value.targetCandidateDigest) ||
            !Object.hasOwn(value, "retainedRuntime"))
    )
        throw invalid();
    const roles = new Set<string>();
    const paths = new Set<string>();
    const files = Array.from({ length: value.files.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value.files, String(index));
        if (!descriptor || !("value" in descriptor)) throw invalid();
        const file = object(descriptor.value, ["role", "path", "mode", "contentBase64"]);
        if (
            typeof file.role !== "string" ||
            !["definition", "metadata", "configuration", "runner"].includes(file.role) ||
            roles.has(file.role) ||
            typeof file.path !== "string" ||
            file.path.length > 4096 ||
            !path.isAbsolute(file.path) ||
            /[\u0000\r\n]/.test(file.path) ||
            paths.has(path.resolve(file.path)) ||
            typeof file.mode !== "number" ||
            !Number.isInteger(file.mode) ||
            file.mode < 0 ||
            file.mode > 0o777 ||
            typeof file.contentBase64 !== "string" ||
            file.contentBase64.length > 2 * 1024 * 1024 ||
            Buffer.from(file.contentBase64, "base64").toString("base64") !== file.contentBase64
        )
            throw invalid();
        roles.add(file.role);
        paths.add(path.resolve(file.path));
        return file as unknown as ServiceMigrationBackup["files"][number];
    });
    if (!["definition", "metadata", "configuration"].every(role => roles.has(role)))
        throw invalid();
    const backup = {
        schemaVersion: 1 as const,
        target,
        previousRunning: value.previousRunning,
        previousEnabled: value.previousEnabled,
        files,
        ...(Object.hasOwn(value, "retainedRuntime")
            ? { retainedRuntime: parseRetainedLegacyRuntime(value.retainedRuntime) }
            : {}),
        ...(typeof value.targetCandidateDigest === "string"
            ? { targetCandidateDigest: value.targetCandidateDigest }
            : {}),
    };
    if (Buffer.byteLength(canonical(backup)) > LIMIT) throw invalid();
    return backup;
}
export function parseServiceMigrationRecord(input: unknown): ServiceMigrationRecord {
    const value = object(input, [
        "schemaVersion",
        "id",
        "backupDigest",
        "phase",
        "status",
        "recoveryRequired",
        "rolledBack",
    ]);
    if (
        value.schemaVersion !== 1 ||
        typeof value.id !== "string" ||
        !ID.test(value.id) ||
        typeof value.backupDigest !== "string" ||
        !HASH.test(value.backupDigest) ||
        typeof value.phase !== "string" ||
        !phases.includes(value.phase) ||
        typeof value.status !== "string" ||
        !["running", "succeeded", "failed", "interrupted"].includes(value.status) ||
        typeof value.recoveryRequired !== "boolean" ||
        typeof value.rolledBack !== "boolean"
    )
        throw invalid();
    if (
        value.status === "succeeded" &&
        (value.phase !== "completed" || value.recoveryRequired || value.rolledBack)
    )
        throw invalid();
    if (value.status === "interrupted" && !value.recoveryRequired) throw invalid();
    if (
        value.phase === "cancelled" &&
        (value.status !== "failed" || value.recoveryRequired || value.rolledBack)
    )
        throw invalid();
    return value as unknown as ServiceMigrationRecord;
}
function finished(record: ServiceMigrationRecord): boolean {
    return (
        !record.recoveryRequired &&
        (record.status === "succeeded" ||
            (record.status === "failed" && (record.rolledBack || record.phase === "cancelled")))
    );
}
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.keys(value)
            .sort()
            .map(
                key =>
                    `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
            )
            .join(",")}}`;
    return JSON.stringify(value);
}
function hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}
function readPrivate(file: string, mode: number, limit: number): string {
    const stat = fs.lstatSync(file);
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > limit ||
        (process.platform !== "win32" && (stat.mode & 0o777) !== mode)
    )
        throw invalid();
    return fs.readFileSync(file, "utf8");
}
function syncDirectory(directory: string): void {
    if (process.platform === "win32") return;
    const descriptor = fs.openSync(directory, "r");
    try {
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
}
function atomic(file: string, content: string, mode: number): void {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        const descriptor = fs.openSync(temporary, "wx", 0o600);
        try {
            fs.writeFileSync(descriptor, content);
            fs.fchmodSync(descriptor, mode);
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        fs.renameSync(temporary, file);
        syncDirectory(path.dirname(file));
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}

function exists(file: string): boolean {
    try {
        fs.lstatSync(file);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw invalid();
    }
}
