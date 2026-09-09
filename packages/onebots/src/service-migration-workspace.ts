import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { acquireControlWorkspace } from "./control/workspace.js";

export interface ServiceMigrationWorkspaceSeed {
    schemaVersion: 1;
    operationId: string;
    desired: "running" | "stopped";
}
const MARKER = "migration-pending.json";
const BLOCKED = "migration-blocked.json";
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const failure = () => new Error("迁移工作区已存在、被占用或状态未确认，禁止自动接管");

/** 仅首次迁移使用；已有.control（包括空目录或中断痕迹）绝不认领或清理。 */
export function prepareServiceMigrationWorkspace(
    workspace: string,
    operationId: string,
    desired: "running" | "stopped",
): ServiceMigrationWorkspaceSeed {
    let unlock: (() => void) | undefined;
    try {
        const seed = parse({ schemaVersion: 1, operationId, desired });
        const root = workspaceRoot(workspace);
        fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        const canonical = fs.realpathSync(root);
        const directory = path.join(canonical, ".control");
        fs.mkdirSync(directory, { mode: 0o700 }); // 排他创建，EEXIST也不认领。
        sync(canonical);
        unlock = acquireControlWorkspace(canonical);
        checkDirectory(directory);
        if (
            fs
                .readdirSync(directory)
                .some(name => !/^manager-lock\.sqlite(?:-journal|-wal|-shm)?$/.test(name))
        )
            throw failure();
        // 标记先于种子：任一中断留下的管理目录都阻止再次自动初始化。
        exclusive(path.join(directory, MARKER), JSON.stringify(seed));
        exclusive(
            path.join(directory, "gateway.json"),
            JSON.stringify({
                schemaVersion: 1,
                desired,
                actual: "stopped",
                recoveryRequired: false,
                operations: [],
            }),
        );
        const confirmed = readServiceMigrationPending(canonical);
        if (!confirmed || confirmed.operationId !== operationId || confirmed.desired !== desired)
            throw failure();
        return confirmed;
    } catch {
        throw failure();
    } finally {
        if (unlock) {
            try {
                unlock();
            } catch {
                throw failure();
            }
        }
    }
}

/** 只读，不创建目录或锁；损坏标记与缺失标记严格区分。 */
export function readServiceMigrationPending(
    workspace: string,
): ServiceMigrationWorkspaceSeed | null {
    try {
        const directory = path.join(workspaceRoot(workspace), ".control");
        if (!exists(directory)) return null;
        checkDirectory(directory);
        if (exists(path.join(directory, BLOCKED))) throw failure();
        const file = path.join(directory, MARKER);
        if (!exists(file)) return null;
        return readMarker(file).seed;
    } catch {
        throw failure();
    }
}

/**
 * 调用方必须已持有workspace锁，且已经完成本次manager验收或明确回退。
 * host可在其常驻锁内调用；旧stopped流程须由服务驱动先取得同一workspace锁。
 * 只删除精确匹配标记，不删除认证、gateway种子、锁数据库或整个.control。
 */
export function releaseServiceMigrationPending(workspace: string, operationId: string): void {
    try {
        if (typeof operationId !== "string" || !ID.test(operationId)) throw failure();
        const directory = path.join(workspaceRoot(workspace), ".control");
        checkDirectory(directory);
        if (exists(path.join(directory, BLOCKED))) throw failure();
        const file = path.join(directory, MARKER);
        const before = readMarker(file);
        if (before.seed.operationId !== operationId) throw failure();
        const current = readMarker(file);
        if (current.identity !== before.identity || current.content !== before.content)
            throw failure();
        fs.unlinkSync(file);
        sync(directory);
    } catch {
        throw failure();
    }
}
/**
 * 调用方持workspace锁且已确认目标进程全部退出；恢复旧服务文件之前持久封锁。
 * 封锁痕迹不提供自动清除入口，后续手动serve也不能重新启用迁移种子。
 */
export function blockServiceMigrationWorkspace(workspace: string, operationId: string): void {
    try {
        if (typeof operationId !== "string" || !ID.test(operationId)) throw failure();
        const directory = path.join(workspaceRoot(workspace), ".control");
        checkDirectory(directory);
        const file = path.join(directory, BLOCKED);
        if (exists(file)) throw failure();
        const marker = path.join(directory, MARKER);
        const before = readMarker(marker);
        if (before.seed.operationId !== operationId) throw failure();
        const current = readMarker(marker);
        if (current.identity !== before.identity || current.content !== before.content)
            throw failure();
        exclusive(file, JSON.stringify({ schemaVersion: 1, operationId }));
    } catch {
        throw failure();
    }
}

/** 调用方持workspace锁；只读识别标记状态，不构成恢复或重启授权。 */
export function inspectServiceMigrationRollbackWorkspace(
    workspace: string,
    operationId: string,
): "pending" | "blocked" {
    try {
        if (typeof operationId !== "string" || !ID.test(operationId)) throw failure();
        const directory = path.join(workspaceRoot(workspace), ".control");
        checkDirectory(directory);
        const pending = readMarker(path.join(directory, MARKER));
        if (pending.seed.operationId !== operationId || pending.seed.desired !== "running")
            throw failure();
        const blocked = path.join(directory, BLOCKED);
        if (!exists(blocked)) {
            const current = readMarker(path.join(directory, MARKER));
            if (current.identity !== pending.identity || current.content !== pending.content)
                throw failure();
            return "pending";
        }
        const value = readBlocked(blocked);
        if (value.operationId !== operationId) throw failure();
        const current = readMarker(path.join(directory, MARKER));
        const currentBlocked = readBlocked(blocked);
        if (current.identity !== pending.identity || current.content !== pending.content)
            throw failure();
        if (currentBlocked.identity !== value.identity || currentBlocked.content !== value.content)
            throw failure();
        return "blocked";
    } catch {
        throw failure();
    }
}

function workspaceRoot(workspace: string): string {
    if (
        typeof workspace !== "string" ||
        !path.isAbsolute(workspace) ||
        workspace.length > 4096 ||
        /[\u0000\r\n]/.test(workspace)
    )
        throw failure();
    return path.resolve(workspace);
}
function parse(value: unknown): ServiceMigrationWorkspaceSeed {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
        throw failure();
    const keys = Reflect.ownKeys(value);
    if (
        keys.length !== 3 ||
        keys.some(key => !["schemaVersion", "operationId", "desired"].includes(String(key)))
    )
        throw failure();
    const data: Record<string, unknown> = {};
    for (const key of ["schemaVersion", "operationId", "desired"]) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) throw failure();
        data[key] = descriptor.value;
    }
    if (
        data.schemaVersion !== 1 ||
        typeof data.operationId !== "string" ||
        !ID.test(data.operationId) ||
        (data.desired !== "running" && data.desired !== "stopped")
    )
        throw failure();
    return { schemaVersion: 1, operationId: data.operationId, desired: data.desired };
}
function checkDirectory(directory: string): void {
    const stat = fs.lstatSync(directory);
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (process.getuid && stat.uid !== process.getuid()) ||
        (process.platform !== "win32" && (stat.mode & 0o7777) !== 0o700)
    )
        throw failure();
}
function readMarker(file: string) {
    const snapshot = readPrivateFile(file);
    return {
        seed: parse(JSON.parse(snapshot.content)),
        content: snapshot.content,
        identity: snapshot.identity,
    };
}
function readBlocked(file: string): { operationId: string; content: string; identity: string } {
    const snapshot = readPrivateFile(file);
    const value: unknown = JSON.parse(snapshot.content);
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Reflect.ownKeys(value).length !== 2 ||
        !Object.hasOwn(value, "schemaVersion") ||
        !Object.hasOwn(value, "operationId")
    )
        throw failure();
    const record = value as Record<string, unknown>;
    if (
        record.schemaVersion !== 1 ||
        typeof record.operationId !== "string" ||
        !ID.test(record.operationId)
    )
        throw failure();
    return { operationId: record.operationId, ...snapshot };
}
function readPrivateFile(file: string): { content: string; identity: string } {
    const stat = fs.lstatSync(file);
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > 1024 ||
        (process.getuid && stat.uid !== process.getuid()) ||
        (process.platform !== "win32" && (stat.mode & 0o7777) !== 0o600)
    )
        throw failure();
    const descriptor = fs.openSync(
        file,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0),
    );
    try {
        const opened = fs.fstatSync(descriptor);
        if (
            opened.dev !== stat.dev ||
            opened.ino !== stat.ino ||
            opened.size !== stat.size ||
            opened.mode !== stat.mode
        )
            throw failure();
        const buffer = Buffer.alloc(1025);
        const count = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
        const after = fs.fstatSync(descriptor);
        const current = fs.lstatSync(file);
        if (
            count !== stat.size ||
            count > 1024 ||
            after.ctimeMs !== stat.ctimeMs ||
            after.mtimeMs !== stat.mtimeMs ||
            current.dev !== stat.dev ||
            current.ino !== stat.ino ||
            current.mode !== stat.mode ||
            current.nlink !== 1
        )
            throw failure();
        const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count));
        return { content, identity: `${stat.dev}:${stat.ino}:${stat.ctimeMs}` };
    } finally {
        fs.closeSync(descriptor);
    }
}
function exists(file: string): boolean {
    try {
        fs.lstatSync(file);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw failure();
    }
}
function exclusive(file: string, content: string): void {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        const descriptor = fs.openSync(temporary, "wx", 0o600);
        try {
            fs.writeFileSync(descriptor, content);
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        fs.linkSync(temporary, file);
        fs.unlinkSync(temporary);
        sync(path.dirname(file));
    } finally {
        fs.rmSync(temporary, { force: true });
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
