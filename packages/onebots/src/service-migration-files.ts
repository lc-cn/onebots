import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { parseManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceMigrationBackup } from "./service-migration-types.js";

export interface ServiceMigrationTargetFile {
    path: string;
    bytes: Buffer;
    mode: number;
}
interface Snapshot {
    bytes: Buffer;
    mode: number;
}
interface Entry {
    file: string;
    parent: { path: string; dev: number; ino: number };
    original: Snapshot | null;
    target: Snapshot | null;
    restored: Snapshot | null;
}
const LIMIT = 1_048_576;
const failure = () => new Error("服务迁移文件已变化或不可用，禁止覆盖");

/**
 * 可信服务协调器须持有服务级锁，并在调用前持久化迁移意图及备份。
 * 多文件变更不是整体原子事务；部分完成可通过 canRestore/restore 对账。
 * 同用户恶意进程可在最后核验与 rename/unlink 间竞争，不属于进程隔离承诺。
 */
export class ServiceMigrationFiles {
    private readonly entries: Entry[];
    constructor(
        backup: ServiceMigrationBackup,
        targets: ServiceMigrationTargetFile[],
        /** 从持久化旧工件契约派生，不能使用临时客户端路径。省略时恢复原文件。 */
        rollback: ServiceMigrationTargetFile[] = [],
    ) {
        try {
            const value = plain(backup, [
                "schemaVersion",
                "target",
                "previousRunning",
                "previousEnabled",
                "files",
            ]);
            parseManagerServiceSpec(value.target);
            if (
                value.schemaVersion !== 1 ||
                typeof value.previousRunning !== "boolean" ||
                typeof value.previousEnabled !== "boolean"
            )
                throw failure();
            const originals = array(value.files, 4);
            if (originals.length < 3) throw failure();
            const entries = new Map<string, Entry>();
            const roles = new Set<string>();
            const runtimeDefinitions = new Set<string>();
            for (const item of originals) {
                const file = plain(item, ["role", "path", "mode", "contentBase64"]);
                if (
                    typeof file.role !== "string" ||
                    !["definition", "metadata", "configuration", "runner"].includes(file.role) ||
                    roles.has(file.role) ||
                    typeof file.contentBase64 !== "string" ||
                    file.contentBase64.length > Math.ceil(LIMIT / 3) * 4
                )
                    throw failure();
                roles.add(file.role);
                const bytes = Buffer.from(file.contentBase64, "base64");
                if (bytes.length > LIMIT || bytes.toString("base64") !== file.contentBase64)
                    throw failure();
                const entry = location(file.path);
                if (entries.has(entry.file)) throw failure();
                if (file.role === "definition" || file.role === "metadata")
                    runtimeDefinitions.add(entry.file);
                entries.set(entry.file, {
                    ...entry,
                    original: snapshot(bytes, file.mode),
                    target: null,
                    restored: snapshot(bytes, file.mode),
                });
            }
            if (!["definition", "metadata", "configuration"].every(role => roles.has(role)))
                throw failure();
            const selected = new Set<string>();
            for (const item of array(targets, 8)) {
                const file = plain(item, ["path", "bytes", "mode"]);
                if (!Buffer.isBuffer(file.bytes)) throw failure();
                const entry = location(file.path);
                if (selected.has(entry.file)) throw failure();
                selected.add(entry.file);
                const target = snapshot(file.bytes, file.mode);
                const previous = entries.get(entry.file);
                if (previous) previous.target = target;
                else entries.set(entry.file, { ...entry, original: null, target, restored: null });
            }
            const restored = new Set<string>();
            for (const item of array(rollback, 4)) {
                const file = plain(item, ["path", "bytes", "mode"]);
                if (!Buffer.isBuffer(file.bytes)) throw failure();
                const locationEntry = location(file.path);
                const entry = entries.get(locationEntry.file);
                // 回退只能改变已备份文件，不能凭恢复计划增加任意写入目标。
                if (
                    !entry?.original ||
                    !runtimeDefinitions.has(entry.file) ||
                    restored.has(entry.file)
                )
                    throw failure();
                restored.add(entry.file);
                entry.restored = snapshot(file.bytes, file.mode);
            }
            this.entries = [...entries.values()];
        } catch {
            throw failure();
        }
    }
    matchesOriginal(): boolean {
        try {
            return this.entries.every(entry => equal(read(entry), entry.original));
        } catch {
            return false;
        }
    }
    matchesTarget(): boolean {
        try {
            return this.entries.every(entry => equal(read(entry), entry.target ?? entry.original));
        } catch {
            return false;
        }
    }
    matchesRestored(): boolean {
        try {
            return this.entries.every(entry => equal(read(entry), entry.restored));
        } catch {
            return false;
        }
    }
    apply(): void {
        try {
            if (!this.matchesOriginal()) throw failure();
            for (const entry of this.entries) {
                if (entry.target && !equal(entry.target, entry.original))
                    write(entry, entry.original, entry.target);
            }
            if (!this.matchesTarget()) throw failure();
        } catch {
            throw failure();
        }
    }
    canRestore(): boolean {
        try {
            this.restorable();
            return true;
        } catch {
            return false;
        }
    }
    restore(): void {
        try {
            const observed = this.restorable();
            for (let index = 0; index < this.entries.length; index++) {
                const entry = this.entries[index];
                const current = observed[index];
                if (equal(current, entry.restored)) continue;
                if (entry.restored) write(entry, current, entry.restored);
                else {
                    if (!equal(read(entry), current)) throw failure();
                    fs.unlinkSync(entry.file);
                    sync(entry.parent.path);
                }
            }
            if (!this.matchesRestored()) throw failure();
        } catch {
            throw failure();
        }
    }
    private restorable(): Array<Snapshot | null> {
        return this.entries.map(entry => {
            const current = read(entry);
            if (
                !equal(current, entry.original) &&
                !(entry.target && equal(current, entry.target)) &&
                !equal(current, entry.restored)
            )
                throw failure();
            return current;
        });
    }
}
function snapshot(bytes: Buffer, mode: unknown): Snapshot {
    if (
        bytes.length > LIMIT ||
        typeof mode !== "number" ||
        !Number.isInteger(mode) ||
        mode < 0 ||
        mode > 0o777
    )
        throw failure();
    return { bytes: Buffer.from(bytes), mode };
}
function location(input: unknown): Pick<Entry, "file" | "parent"> {
    if (
        typeof input !== "string" ||
        input.length > 4096 ||
        !path.isAbsolute(input) ||
        /[\u0000\r\n]/.test(input) ||
        path.normalize(input) !== input ||
        path.basename(input) === "."
    )
        throw failure();
    const parent = fs.realpathSync(path.dirname(input));
    const stat = fs.lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure();
    return {
        file: path.join(parent, path.basename(input)),
        parent: { path: parent, dev: stat.dev, ino: stat.ino },
    };
}
function checkParent(entry: Entry): void {
    const stat = fs.lstatSync(entry.parent.path);
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        stat.dev !== entry.parent.dev ||
        stat.ino !== entry.parent.ino
    )
        throw failure();
}
function read(entry: Entry): Snapshot | null {
    checkParent(entry);
    let before: fs.Stats;
    try {
        before = fs.lstatSync(entry.file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw failure();
    }
    if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1 ||
        before.size > LIMIT ||
        (before.mode & 0o7000) !== 0
    )
        throw failure();
    const { bytes } = new ConfigurationFile(entry.file).readRaw();
    const after = fs.lstatSync(entry.file);
    if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.mode !== after.mode ||
        before.ctimeMs !== after.ctimeMs ||
        before.mtimeMs !== after.mtimeMs
    )
        throw failure();
    return { bytes, mode: after.mode & 0o777 };
}
function equal(left: Snapshot | null, right: Snapshot | null): boolean {
    return left === null || right === null
        ? left === right
        : left.mode === right.mode && left.bytes.equals(right.bytes);
}
function write(entry: Entry, expected: Snapshot | null, target: Snapshot): void {
    if (!equal(read(entry), expected)) throw failure();
    const staging = path.join(entry.parent.path, `.onebots-migration-${randomUUID()}`);
    fs.mkdirSync(staging, { mode: 0o700 });
    const temporary = path.join(staging, "content");
    try {
        const descriptor = fs.openSync(temporary, "wx", 0o600);
        try {
            fs.writeFileSync(descriptor, target.bytes);
            fs.fchmodSync(descriptor, target.mode);
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        if (!equal(read(entry), expected)) throw failure();
        if (expected === null) {
            // link 是不覆盖创建：悬空链接及其他已存在入口都必须失败。
            fs.linkSync(temporary, entry.file);
            fs.unlinkSync(temporary);
        } else fs.renameSync(temporary, entry.file);
        sync(entry.parent.path);
    } finally {
        fs.rmSync(temporary, { force: true });
        fs.rmdirSync(staging);
    }
}
function sync(directory: string): void {
    if (process.platform === "win32") return;
    const descriptor = fs.openSync(directory, "r");
    try {
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
}
function plain(value: unknown, keys: string[]): Record<string, unknown> {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
        throw failure();
    const own = Reflect.ownKeys(value);
    if (
        own.length !== keys.length ||
        own.some(key => typeof key !== "string" || !keys.includes(key))
    )
        throw failure();
    const result: Record<string, unknown> = {};
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) throw failure();
        result[key] = descriptor.value;
    }
    return result;
}
function array(value: unknown, limit: number): unknown[] {
    if (
        !Array.isArray(value) ||
        value.length > limit ||
        Reflect.ownKeys(value).length !== value.length + 1
    )
        throw failure();
    return Array.from({ length: value.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) throw failure();
        return descriptor.value;
    });
}
