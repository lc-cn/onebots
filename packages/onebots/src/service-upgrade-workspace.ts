import fs from "node:fs";
import path from "node:path";
import { acquireControlWorkspace } from "./control/workspace.js";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { readServiceMigrationPending } from "./service-migration-workspace.js";
import { verifyServiceMigrationProcessesWhileLocked } from "./service-migration-processes.js";

const MARKER = "manager-upgrade-pending.json";
export interface ManagerUpgradePending {
    schemaVersion: 1;
    operationId: string;
    candidateDigest: string;
    phase?: "releasing" | "released";
    managerId?: string;
    completion?: "offline";
}
const failure = () => new Error("管理程序升级维护状态无法确认，请在本机对账");
function parse(input: unknown): ManagerUpgradePending {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw failure();
    const value = input as Record<string, unknown>;
    if (
        ![
            "candidateDigest,operationId,schemaVersion",
            "candidateDigest,managerId,operationId,phase,schemaVersion",
            "candidateDigest,completion,operationId,phase,schemaVersion",
        ].includes(Object.keys(value).sort().join()) ||
        value.schemaVersion !== 1 ||
        typeof value.operationId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(value.operationId) ||
        typeof value.candidateDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.candidateDigest)
    )
        throw failure();
    const offline = value.completion === "offline" && value.phase === "released" &&
        !Object.hasOwn(value, "managerId");
    if (Object.hasOwn(value, "completion") && !offline) throw failure();
    if (value.phase !== undefined && !offline &&
        ((value.phase !== "releasing" && value.phase !== "released") ||
            typeof value.managerId !== "string" || !/^[a-f0-9-]{36}$/.test(value.managerId)))
        throw failure();
    return {
        ...(value.phase
            ? {
                  phase: value.phase as "releasing" | "released",
                  ...(offline ? { completion: "offline" as const } : { managerId: value.managerId as string }),
              }
            : {}),
        schemaVersion: 1,
        operationId: value.operationId,
        candidateDigest: value.candidateDigest,
    };
}
export function readManagerUpgradePending(workspace: string): ManagerUpgradePending | null {
    return readUpgradeFile(path.join(workspace, ".control", MARKER));
}
function readUpgradeFile(file: string): ManagerUpgradePending | null {
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw failure();
    }
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > 1024 ||
        (stat.mode & 0o7777) !== 0o600 ||
        (process.getuid && stat.uid !== process.getuid())
    )
        throw failure();
    return parse(JSON.parse(new ConfigurationFile(file).readRaw().bytes.toString("utf8")));
}
export function managerUpgradeStatus(workspace: string) {
    try {
        const marker = readManagerUpgradePending(workspace);
        return {
            pending: Boolean(marker && marker.phase !== "released"),
            recoveryRequired: marker?.phase === "releasing",
        };
    } catch {
        return { pending: true, recoveryRequired: true };
    }
}

/**
 * OS 事务须先保持服务静止且持服务锁；此函数取得工作区锁并核验全部历史进程退出。
 * 仅增加升级标记，不覆盖配置、认证或gateway期望状态。释放须由后续升级事务确认，
 * 不能调用首次迁移release或删除文件绕过验收。
 */
export async function prepareManagerUpgradeWorkspace(
    workspace: string,
    input: ManagerUpgradePending,
): Promise<void> {
    const pending = parse(input);
    if (pending.phase) throw failure();
    if (
        process.platform === "win32" ||
        !path.isAbsolute(workspace) ||
        fs.realpathSync(workspace) !== workspace
    )
        throw failure();
    const directory = path.join(workspace, ".control");
    const stat = fs.lstatSync(directory);
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o7777) !== 0o700 ||
        (process.getuid && stat.uid !== process.getuid())
    )
        throw failure();
    const release = acquireControlWorkspace(workspace);
    try {
        const previous = readManagerUpgradePending(workspace);
        if (
            readServiceMigrationPending(workspace) ||
            (previous && previous.phase !== "released") ||
            !(await verifyServiceMigrationProcessesWhileLocked(workspace))
        )
            throw failure();
        if (
            previous?.operationId === pending.operationId ||
            readManagerUpgradeHistory(workspace, pending.operationId)
        )
            throw failure();
        if (previous) {
            const file = new ConfigurationFile(path.join(directory, MARKER));
            const snapshot = file.readRaw();
            if (
                JSON.stringify(parse(JSON.parse(snapshot.bytes.toString("utf8")))) !==
                JSON.stringify(previous)
            )
                throw failure();
            archiveCompleted(workspace, previous, snapshot.bytes);
            file.replaceRaw(snapshot.revision, Buffer.from(JSON.stringify(pending)));
            return;
        }
        // 排他创建：写入中断也留下可见的封锁证据，不能留下“无标记”的部分升级。
        const descriptor = fs.openSync(path.join(directory, MARKER), "wx", 0o600);
        try {
            fs.writeFileSync(descriptor, JSON.stringify(pending));
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        const directoryDescriptor = fs.openSync(directory, "r");
        try {
            fs.fsyncSync(directoryDescriptor);
        } finally {
            fs.closeSync(directoryDescriptor);
        }
    } finally {
        release();
    }
}

/** 仅常驻host持工作区锁与生命周期队列时使用；CAS之前不派发外部动作。 */
export function advanceManagerUpgrade(
    workspace: string,
    expected: ManagerUpgradePending,
    phase: "releasing" | "released",
    managerId: string,
): void {
    if (
        (phase === "releasing" && expected.phase) ||
        (phase === "released" &&
            (expected.phase !== "releasing" || expected.managerId !== managerId))
    )
        throw failure();
    expected = parse(expected);
    const file = new ConfigurationFile(path.join(workspace, ".control", MARKER));
    const current = readManagerUpgradePending(workspace);
    const snapshot = file.readRaw();
    if (
        JSON.stringify(current) !== JSON.stringify(expected) ||
        JSON.stringify(parse(JSON.parse(snapshot.bytes.toString("utf8")))) !==
            JSON.stringify(expected)
    )
        throw failure();
    const next = parse({ ...expected, phase, managerId });
    file.replaceRaw(snapshot.revision, Buffer.from(JSON.stringify(next)));
}

/** 仅 OS 升级事务持工作区锁并完成离线核验后调用，不向远程提供此入口。 */
export function completeStoppedManagerUpgradeWhileLocked(
    workspace: string,
    expected: ManagerUpgradePending,
): void {
    expected = parse(expected);
    if (expected.phase) throw failure();
    const file = new ConfigurationFile(path.join(workspace, ".control", MARKER));
    const snapshot = file.readRaw();
    if (JSON.stringify(readManagerUpgradePending(workspace)) !== JSON.stringify(expected) ||
        JSON.stringify(parse(JSON.parse(snapshot.bytes.toString("utf8")))) !== JSON.stringify(expected))
        throw failure();
    const next = parse({ ...expected, phase: "released", completion: "offline" });
    file.replaceRaw(snapshot.revision, Buffer.from(JSON.stringify(next)));
}

/** 普通托管入口不能把未结束升级当成一次独立启停或卸载。 */
export function assertNoPendingManagerUpgrade(workspace: string): void {
    const status = managerUpgradeStatus(workspace);
    if (status.pending || status.recoveryRequired)
        throw new Error("管理程序升级尚待确认或对账，禁止其他系统服务操作");
}

/** 已完成记录只读查询；不能将缺失、损坏记录视为新操作授权。 */
export function readManagerUpgradeHistory(
    workspace: string,
    operationId: string,
): ManagerUpgradePending | null {
    if (typeof operationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(operationId))
        throw failure();
    const directory = path.join(workspace, ".control/manager-upgrade-history");
    if (!historyDirectory(directory)) return null;
    const record = readUpgradeFile(path.join(directory, `${operationId}.json`));
    if (record && (record.operationId !== operationId || record.phase !== "released"))
        throw failure();
    return record;
}
function historyDirectory(directory: string): boolean {
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(directory);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw failure();
    }
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o7777) !== 0o700 ||
        (process.getuid && stat.uid !== process.getuid())
    )
        throw failure();
    return true;
}
function archiveCompleted(workspace: string, previous: ManagerUpgradePending, bytes: Buffer): void {
    const directory = path.join(workspace, ".control/manager-upgrade-history");
    if (!historyDirectory(directory)) fs.mkdirSync(directory, { mode: 0o700 });
    const file = path.join(directory, `${previous.operationId}.json`);
    const existing = readManagerUpgradeHistory(workspace, previous.operationId);
    if (existing) {
        if (!new ConfigurationFile(file).readRaw().bytes.equals(bytes)) throw failure();
    } else {
        const descriptor = fs.openSync(file, "wx", 0o600);
        try {
            fs.writeFileSync(descriptor, bytes);
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
    }
    // 归档持久成功后才CAS替换当前标记；中断不删除任何已完成证据。
    for (const target of [file, directory, path.dirname(directory)]) {
        const descriptor = fs.openSync(target, "r");
        try {
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
    }
}
