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
}
const failure = () => new Error("管理程序升级维护状态无法确认，请在本机对账");
function parse(input: unknown): ManagerUpgradePending {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw failure();
    const value = input as Record<string, unknown>;
    if (
        Object.keys(value).sort().join() !== "candidateDigest,operationId,schemaVersion" ||
        value.schemaVersion !== 1 ||
        typeof value.operationId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(value.operationId) ||
        typeof value.candidateDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.candidateDigest)
    )
        throw failure();
    return {
        schemaVersion: 1,
        operationId: value.operationId,
        candidateDigest: value.candidateDigest,
    };
}
export function readManagerUpgradePending(workspace: string): ManagerUpgradePending | null {
    const file = path.join(workspace, ".control", MARKER);
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
        return { pending: Boolean(readManagerUpgradePending(workspace)), recoveryRequired: false };
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
        if (
            readServiceMigrationPending(workspace) ||
            readManagerUpgradePending(workspace) ||
            !(await verifyServiceMigrationProcessesWhileLocked(workspace))
        )
            throw failure();
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
