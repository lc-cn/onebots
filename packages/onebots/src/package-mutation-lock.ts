import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const LOCK_DIRECTORY_NAME = ".onebots-package-mutation.lock";
const OWNER_FILE_NAME = "owner.json";
const MAX_OWNER_FILE_BYTES = 4 * 1024;
const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;

export interface PackageMutationLockOwner {
    token: string;
    operationId: string;
    operation: "extension_install";
    extensionId: string;
    host: string;
    pid: number;
    startedAt: string;
}

export interface PackageMutationLock {
    release(): void;
}

interface PackageMutationLockOptions {
    now?: () => Date;
    hostname?: () => string;
    isProcessAlive?: (pid: number) => boolean;
    staleAfterMs?: number;
}

interface LockInspection {
    owner: PackageMutationLockOwner | null;
    updatedAtMs: number;
    error: string | null;
}

export class PackageMutationLockConflictError extends Error {}

/**
 * 在共享运行目录中原子取得包变更租约，避免多个 OneBots 实例交错修改依赖与锁文件。
 *
 * 已退出进程或超过完整安装与恢复上限的遗留租约会通过原子 rename 后回收；释放前再次
 * 验证私有 token，防止过期持有者删除后来操作的租约。
 */
export function acquirePackageMutationLock(
    runtimeRoot: string,
    input: Pick<PackageMutationLockOwner, "operationId" | "extensionId"> & {
        token: string;
    },
    options: PackageMutationLockOptions = {},
): PackageMutationLock {
    const lockPath = path.join(path.resolve(runtimeRoot), LOCK_DIRECTORY_NAME);
    const now = options.now ?? (() => new Date());
    const hostname = options.hostname ?? os.hostname;
    const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;

    for (let attempt = 0; attempt < 4; attempt++) {
        const acquiredAt = now();
        const owner: PackageMutationLockOwner = {
            ...input,
            operation: "extension_install",
            host: hostname(),
            pid: process.pid,
            startedAt: acquiredAt.toISOString(),
        };
        try {
            fs.mkdirSync(lockPath, { mode: 0o700 });
            try {
                writeOwner(lockPath, owner);
            } catch (error) {
                fs.rmSync(lockPath, { recursive: true, force: true });
                throw error;
            }
            return createLease(lockPath, owner);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }

        const inspection = inspectLock(lockPath);
        if (inspection === null) continue;
        const age = Math.max(0, acquiredAt.getTime() - inspection.updatedAtMs);
        const ownerAlive = inspection.owner
            ? inspection.owner.host !== hostname() || isProcessAlive(inspection.owner.pid)
            : true;
        if (age <= staleAfterMs && ownerAlive) {
            throw conflictError(lockPath, inspection);
        }
        if (!reclaimLock(lockPath, input.token)) continue;
    }

    throw new PackageMutationLockConflictError(
        `扩展运行目录的包变更租约持续发生竞争：${lockPath}。请等待其他 OneBots 操作完成后重试。`,
    );
}

function createLease(lockPath: string, owner: PackageMutationLockOwner): PackageMutationLock {
    let released = false;
    return {
        release() {
            if (released) return;
            assertOwner(lockPath, owner.token);
            const releasedPath = `${lockPath}.released-${owner.token}`;
            fs.renameSync(lockPath, releasedPath);
            released = true;
            fs.rmSync(releasedPath, { recursive: true, force: true });
        },
    };
}

function writeOwner(lockPath: string, owner: PackageMutationLockOwner): void {
    const ownerPath = path.join(lockPath, OWNER_FILE_NAME);
    const content = `${JSON.stringify(owner)}\n`;
    fs.writeFileSync(ownerPath, content, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
    });
}

function inspectLock(lockPath: string): LockInspection | null {
    let directoryStats: fs.Stats;
    try {
        directoryStats = fs.lstatSync(lockPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
        return {
            owner: null,
            updatedAtMs: directoryStats.mtimeMs,
            error: "租约路径不是常规目录",
        };
    }

    const ownerPath = path.join(lockPath, OWNER_FILE_NAME);
    try {
        const stats = fs.lstatSync(ownerPath);
        if (!stats.isFile() || stats.isSymbolicLink()) {
            return {
                owner: null,
                updatedAtMs: directoryStats.mtimeMs,
                error: "owner.json 不是常规文件",
            };
        }
        if (stats.size > MAX_OWNER_FILE_BYTES) {
            return { owner: null, updatedAtMs: stats.mtimeMs, error: "owner.json 超过大小上限" };
        }
        const parsed: unknown = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
        const owner = parseOwner(parsed);
        return owner
            ? { owner, updatedAtMs: Date.parse(owner.startedAt), error: null }
            : { owner: null, updatedAtMs: stats.mtimeMs, error: "owner.json 字段无效" };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return { owner: null, updatedAtMs: directoryStats.mtimeMs, error: "owner.json 缺失" };
        }
        return { owner: null, updatedAtMs: directoryStats.mtimeMs, error: "owner.json 无法读取" };
    }
}

function parseOwner(value: unknown): PackageMutationLockOwner | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const owner = value as Record<string, unknown>;
    if (
        typeof owner.token !== "string" ||
        !owner.token ||
        typeof owner.operationId !== "string" ||
        !owner.operationId ||
        owner.operation !== "extension_install" ||
        typeof owner.extensionId !== "string" ||
        !owner.extensionId ||
        typeof owner.host !== "string" ||
        !owner.host ||
        !Number.isSafeInteger(owner.pid) ||
        Number(owner.pid) <= 0 ||
        !isValidDate(owner.startedAt)
    ) {
        return null;
    }
    return owner as unknown as PackageMutationLockOwner;
}

function isValidDate(value: unknown): value is string {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function assertOwner(lockPath: string, token: string): void {
    const inspection = inspectLock(lockPath);
    if (inspection?.owner?.token === token) return;
    throw new Error(`包变更租约所有权已丢失：${lockPath}`);
}

function reclaimLock(lockPath: string, token: string): boolean {
    const stalePath = `${lockPath}.stale-${token}`;
    try {
        fs.renameSync(lockPath, stalePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
    fs.rmSync(stalePath, { recursive: true, force: true });
    return true;
}

function conflictError(
    lockPath: string,
    inspection: LockInspection,
): PackageMutationLockConflictError {
    if (!inspection.owner) {
        return new PackageMutationLockConflictError(
            `扩展运行目录存在无法验证的包变更租约（${inspection.error ?? "未知原因"}）：${lockPath}。若确认没有安装操作正在运行，请等待 30 分钟自动回收或人工检查该目录。`,
        );
    }
    return new PackageMutationLockConflictError(
        `扩展 ${inspection.owner.extensionId} 正由 ${inspection.owner.host} 的进程 ${inspection.owner.pid} 执行安装事务（操作 ${inspection.owner.operationId}，开始于 ${inspection.owner.startedAt}），请等待完成后重试。`,
    );
}

function defaultIsProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}
