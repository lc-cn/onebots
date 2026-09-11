import { ConfigurationFile } from "./configuration/configuration-file.js";
import {
    inspectServiceMigrationRollbackWorkspace,
    readServiceMigrationPending,
} from "./service-migration-workspace.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { acquireControlWorkspace, gatewayProcessExists } from "./control/workspace.js";
import { readDownloadOwner } from "./installation/generation-download-state.js";
import { readConfigurationVerificationOwner } from "./configuration/configuration-verify-ownership.js";

interface Receipt {
    schemaVersion: 1;
    hostname: string;
    phase: "never-started" | "active" | "closed";
    managerId: string | null;
    pid: number | null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const revisions = new WeakMap<object, string>();
const isLock = (name: string) => /^manager-lock\.sqlite(?:-journal|-wal|-shm)?$/.test(name);
const fail = () => new Error("管理进程所有权证据不可确认");
function directory(file: string): void {
    const stat = fs.lstatSync(file);
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        stat.mode & 0o077 ||
        (process.getuid && stat.uid !== process.getuid())
    )
        throw fail();
}
function exists(file: string): boolean {
    try {
        fs.lstatSync(file);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw fail();
    }
}
function json(file: string, limit = 1_048_576): Record<string, unknown> {
    const stat = fs.lstatSync(file);
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > limit ||
        stat.mode & 0o077 ||
        (process.getuid && stat.uid !== process.getuid())
    )
        throw fail();
    const snapshot = new ConfigurationFile(file).readRaw();
    if (snapshot.bytes.length > limit) throw fail();
    const value: unknown = JSON.parse(snapshot.bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw fail();
    revisions.set(value, snapshot.revision);
    return value as Record<string, unknown>;
}
function root(workspace: string): string {
    if (
        process.platform === "win32" ||
        !path.isAbsolute(workspace) ||
        fs.realpathSync(workspace) !== workspace
    )
        throw fail();
    const result = path.join(workspace, ".control");
    directory(result);
    return result;
}
function readReceipt(control: string): Receipt {
    const value = json(path.join(control, "process-ownership.json"), 4096);
    if (
        Object.keys(value).sort().join() !== "hostname,managerId,phase,pid,schemaVersion" ||
        value.schemaVersion !== 1 ||
        value.hostname !== os.hostname() ||
        !["never-started", "active", "closed"].includes(String(value.phase))
    )
        throw fail();
    if (value.phase === "never-started") {
        if (value.managerId !== null || value.pid !== null) throw fail();
    } else if (
        typeof value.managerId !== "string" ||
        !UUID.test(value.managerId) ||
        !Number.isSafeInteger(value.pid) ||
        Number(value.pid) < 1 ||
        Number(value.pid) > 0x7fffffff
    )
        throw fail();
    return value as unknown as Receipt;
}
function writeReceipt(control: string, value: Receipt, previous?: Receipt): void {
    const file = path.join(control, "process-ownership.json");
    if (previous) {
        const revision = revisions.get(previous);
        if (!revision) throw fail();
        new ConfigurationFile(file).replaceRaw(revision, Buffer.from(JSON.stringify(value)));
        return;
    }
    const temporary = path.join(control, `.process-ownership-${randomUUID()}`);
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
        fs.writeFileSync(descriptor, JSON.stringify(value));
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
    try {
        fs.linkSync(temporary, file);
        fs.unlinkSync(temporary);
        const parent = fs.openSync(control, "r");
        try {
            fs.fsyncSync(parent);
        } finally {
            fs.closeSync(parent);
        }
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}
function gone(pid: number): boolean {
    return !gatewayProcessExists(pid);
}
function gatewayQuiet(control: string, allowRecoverableState = false): boolean {
    const state = json(path.join(control, "gateway.json"));
    if (
        state.schemaVersion !== 1 ||
        !["running", "stopped"].includes(String(state.desired)) ||
        (state.recoveryRequired !== false &&
            (!allowRecoverableState || state.recoveryRequired !== true)) ||
        !["running", "stopped", "failed"].includes(String(state.actual)) ||
        !Array.isArray(state.operations) ||
        state.operations.some(
            operation =>
                !operation ||
                typeof operation !== "object" ||
                !["succeeded", "failed"].includes(String(operation.status)),
        )
    )
        return false;
    // 历史实例身份明确且进程/进程组均已消失时，新 manager 可先接管；host 随后必须先持久化
    // reconcile 操作才能启动新网关。缺少实例身份仍属于未知结果，不允许自动恢复。
    if (state.recoveryRequired === true && state.instance === undefined) return false;
    if (state.instance !== undefined) {
        const instance = state.instance as Record<string, unknown>;
        if (
            !instance ||
            typeof instance !== "object" ||
            typeof instance.id !== "string" ||
            !UUID.test(instance.id) ||
            !Number.isSafeInteger(instance.pid)
        )
            return false;
        return gone(Number(instance.pid));
    }
    return state.actual !== "running";
}
async function workersQuiet(control: string): Promise<boolean> {
    for (const [relative, download] of [
        ["downloads", true],
        ["generation-verifications", false],
        ["configuration/verification-workers", false],
        ["configuration/schema-workers", false],
    ] as const) {
        const container = path.join(control, relative);
        // Check intermediate configuration directory too, including dangling links.
        if (relative.includes("/") && exists(path.dirname(container)))
            directory(path.dirname(container));
        if (!exists(container)) continue;
        directory(container);
        const entries = fs.readdirSync(container);
        if (entries.length > 10000) return false;
        for (const id of entries) {
            if (!UUID.test(id)) return false;
            const location = path.join(container, id);
            const owner = download
                ? await readDownloadOwner(location)
                : readConfigurationVerificationOwner(location);
            if (
                "downloaderPid" in owner &&
                ((owner.phase === "allocated" &&
                    (owner.workerPid !== null || owner.downloaderPid !== null)) ||
                    (owner.phase === "idle" &&
                        (owner.workerPid === null || owner.downloaderPid !== null)) ||
                    (owner.phase === "downloading" &&
                        (owner.workerPid === null || owner.downloaderPid === null)))
            )
                return false;
            if (owner.phase === "spawning" || !gone(owner.parentPid)) return false;
            if (owner.workerPid !== null && !gone(owner.workerPid)) return false;
            if (
                "downloaderPid" in owner &&
                owner.downloaderPid !== null &&
                !gone(owner.downloaderPid)
            )
                return false;
        }
    }
    return true;
}
async function quiet(
    control: string,
    neverStarted = false,
    allowRecoverableGateway = false,
): Promise<boolean> {
    if (neverStarted) {
        const state = json(path.join(control, "gateway.json"));
        if (
            state.actual !== "stopped" ||
            state.instance !== undefined ||
            !Array.isArray(state.operations) ||
            state.operations.length !== 0
        )
            return false;
    }
    return gatewayQuiet(control, allowRecoverableGateway) && (await workersQuiet(control));
}

function neverStartedQuiet(control: string): boolean {
    const allowed = new Set([
        "gateway.json",
        "migration-pending.json",
        "migration-blocked.json",
        "process-ownership.json",
    ]);
    const before = fs.readdirSync(control).sort();
    if (!before.every(name => isLock(name) || allowed.has(name))) return false;
    const state = json(path.join(control, "gateway.json"));
    if (
        Object.keys(state).sort().join() !==
            "actual,desired,operations,recoveryRequired,schemaVersion" ||
        state.schemaVersion !== 1 ||
        !["running", "stopped"].includes(String(state.desired)) ||
        state.actual !== "stopped" ||
        state.recoveryRequired !== false ||
        !Array.isArray(state.operations) ||
        state.operations.length !== 0
    )
        return false;
    return before.join("\n") === fs.readdirSync(control).sort().join("\n");
}

/** 调用前 OS 驱动已确认主服务静止。这里只读探测历史 PID/PGID，不删除 owner 或杀进程。 */
export async function verifyServiceMigrationProcesses(workspace: string): Promise<boolean> {
    let release: (() => void) | undefined;
    try {
        root(workspace); // 保留加锁前只读边界检查，不替未知目录初始化管理状态。
        release = acquireControlWorkspace(workspace);
        return await verifyServiceMigrationProcessesWhileLocked(workspace);
    } catch {
        return false;
    } finally {
        release?.();
    }
}

/**
 * 调用方必须已持workspace锁，并在后续文件删除/恢复完成前继续持有。
 * 不自行加锁或释放；全部私有凭据、PID/进程组及worker证据与普通入口一致。
 */
export async function verifyServiceMigrationProcessesWhileLocked(
    workspace: string,
): Promise<boolean> {
    try {
        const control = root(workspace);
        const receipt = readReceipt(control);
        if (receipt.pid !== null && !gone(receipt.pid)) return false;
        return await quiet(control, receipt.phase === "never-started");
    } catch {
        return false;
    }
}

/**
 * 调用方持workspace锁；只接受迁移写目标时创建、且从未被manager认领的进程种子。
 * active/closed都表示目标管理程序可能执行过业务动作，不能用于冷回退证明。
 */
export async function verifyNeverStartedServiceMigrationProcessesWhileLocked(
    workspace: string,
    operationId: string,
    expectedDesired: "running" | "stopped" = "running",
): Promise<boolean> {
    try {
        const workspaceState = inspectServiceMigrationRollbackWorkspace(
            workspace,
            operationId,
            expectedDesired,
        );
        const control = root(workspace);
        const receipt = readReceipt(control);
        if (receipt.phase !== "never-started" || !neverStartedQuiet(control)) return false;
        return (
            readReceipt(control).phase === "never-started" &&
            inspectServiceMigrationRollbackWorkspace(workspace, operationId, expectedDesired) ===
                workspaceState
        );
    } catch {
        return false;
    }
}

/** 仅迁移 port 持工作区锁且已确认 neverStarted 的新 seed 可调用；不能用于补写旧管理目录。 */
export function prepareServiceProcessOwnershipSeed(workspace: string): void {
    const control = root(workspace);
    const allowed = fs
        .readdirSync(control)
        .every(name => isLock(name) || ["gateway.json", "migration-pending.json"].includes(name));
    const pending = readServiceMigrationPending(workspace);
    const gateway = json(path.join(control, "gateway.json"));
    if (
        !allowed ||
        !pending ||
        Object.keys(gateway).sort().join() !==
            "actual,desired,operations,recoveryRequired,schemaVersion" ||
        gateway.schemaVersion !== 1 ||
        gateway.desired !== pending.desired ||
        gateway.actual !== "stopped" ||
        gateway.recoveryRequired !== false ||
        !Array.isArray(gateway.operations) ||
        gateway.operations.length !== 0
    )
        throw fail();
    writeReceipt(control, {
        schemaVersion: 1,
        hostname: os.hostname(),
        phase: "never-started",
        managerId: null,
        pid: null,
    });
}

/** host 在工作区锁内、任何 fork 前调用；fresh 必须来自加锁前目录不存在且加锁后仅有锁文件。 */
export async function claimServiceProcessOwnership(
    workspace: string,
    managerId: string,
    fresh: boolean,
): Promise<boolean> {
    try {
        const control = root(workspace);
        if (!UUID.test(managerId)) return false;
        let previous: Receipt | undefined;
        if (fresh && fs.readdirSync(control).every(isLock)) {
            // acquireControlWorkspace has created this new directory while holding its lock.
        } else {
            previous = readReceipt(control);
            if (previous.phase === "active" && previous.pid !== null && !gone(previous.pid))
                return false;
            if (
                previous.phase === "closed" &&
                previous.pid !== process.pid &&
                previous.pid !== null &&
                !gone(previous.pid)
            )
                return false;
            if (
                !(await quiet(
                    control,
                    previous.phase === "never-started",
                    previous.phase !== "never-started",
                ))
            )
                return false;
        }
        writeReceipt(
            control,
            {
                schemaVersion: 1,
                hostname: os.hostname(),
                phase: "active",
                managerId,
                pid: process.pid,
            },
            previous,
        );
        return true;
    } catch {
        return false;
    }
}

/** 只有本次宿主完成生命周期关闭且各已登记进程均静止后，才允许标记 closed。 */
export async function closeServiceProcessOwnership(
    workspace: string,
    managerId: string,
): Promise<void> {
    const control = root(workspace),
        receipt = readReceipt(control);
    if (
        receipt.phase !== "active" ||
        receipt.managerId !== managerId ||
        receipt.pid !== process.pid ||
        !(await quiet(control))
    )
        throw fail();
    writeReceipt(control, { ...receipt, phase: "closed" }, receipt);
}
