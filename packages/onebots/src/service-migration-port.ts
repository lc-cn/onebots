import { isDeepStrictEqual } from "node:util";
import fs from "node:fs";
import path from "node:path";
import {
    prepareServiceProcessOwnershipSeed,
    verifyServiceMigrationProcesses,
} from "./service-migration-processes.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";
import { ServiceMigrationFiles } from "./service-migration-files.js";
import { createServiceMigrationFilePlan } from "./service-migration-file-plan.js";
import {
    retainedRollbackFiles,
    verifyRetainedLegacyRuntime,
} from "./service-migration-retained-runtime.js";
import {
    prepareServiceMigrationWorkspace,
    readServiceMigrationPending,
    releaseServiceMigrationPending,
    blockServiceMigrationWorkspace,
} from "./service-migration-workspace.js";
import { inspectMigrationManager, releaseMigrationManager } from "./service-migration-manager.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";
import type { ServiceMigrationBackup, ServiceMigrationPort } from "./service-migration-types.js";

/**
 * 热迁移端口，只能由持有服务锁的协调器调用。冷恢复不能重建本对象后重放。
 * confirmStopped必须检查持久进程归属及工作区排他锁；平台主PID退出并不足够。
 */
export function createServiceMigrationPort(options: {
    backup: ServiceMigrationBackup;
    host: ServiceHost;
    platform: ServicePlatform;
    operationId: string;
    originalState: ServicePlatformState;
    readinessTimeoutMs?: number;
    now?(): number;
    sleep?(milliseconds: number): Promise<void>;
    confirmStopped?(workspace: string): Promise<boolean>;
    manager?: {
        inspect: typeof inspectMigrationManager;
        release: typeof releaseMigrationManager;
    };
}): ServiceMigrationPort {
    const backup = structuredClone(options.backup);
    const original = structuredClone(options.originalState);
    const plan = createServiceMigrationFilePlan(backup, options.host);
    const files = new ServiceMigrationFiles(
        backup,
        plan.files,
        retainedRollbackFiles(backup, options.host),
    );
    const workspace = backup.target.workspace;
    const platform = options.platform;
    const manager = options.manager ?? {
        inspect: inspectMigrationManager,
        release: releaseMigrationManager,
    };
    let workspacePrepared = false;
    let workspaceConfirmed = false;
    let startRequested = false;
    let managerId: string | null = null;
    let targetProcess: { pid: number; identity: string } | null = null;
    const now = options.now ?? Date.now;
    const sleep =
        options.sleep ??
        (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    const timeout = options.readinessTimeoutMs ?? 120_000;
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120_000)
        throw new Error("服务就绪等待期限无效");
    const fail = () => new Error("系统服务迁移状态无法核实，请在本机对账");
    function bound(input: ServiceMigrationBackup) {
        if (!isDeepStrictEqual(input, backup)) throw fail();
    }
    function ownsWorkspace() {
        return readServiceMigrationPending(workspace)?.operationId === options.operationId;
    }
    async function quiet() {
        const state = await platform.inspect();
        if (!state.quiescent || state.running) return false;
        // 只有捕获时明确没有管理工作区的旧入口可接受目录不存在。
        if (!workspacePrepared) {
            try {
                fs.lstatSync(path.join(workspace, ".control"));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT")
                    return options.confirmStopped ? options.confirmStopped(workspace) : true;
                throw error;
            }
        }
        return (options.confirmStopped ?? verifyServiceMigrationProcesses)(workspace);
    }
    async function originalMatches() {
        const state = await platform.inspect();
        return files.matchesOriginal() && isDeepStrictEqual(state, original);
    }
    async function retainedValid() {
        if (backup.retainedRuntime) await verifyRetainedLegacyRuntime(backup.retainedRuntime);
    }
    function targetValid() {
        if (backup.targetCandidateDigest)
            verifyManagerServiceCandidate(backup.target, backup.targetCandidateDigest);
    }
    async function ready(check: () => Promise<boolean>) {
        const deadline = now() + timeout;
        do {
            try {
                if (await check()) return true;
            } catch {
                /* 只重新观测正在启动的服务，绝不重发启动动作。 */
            }
            if (now() >= deadline) return false;
            await sleep(Math.min(250, deadline - now()));
        } while (now() < deadline);
        return false;
    }
    const port: ServiceMigrationPort = {
        async verifyOriginal(input) {
            bound(input);
            targetValid();
            await retainedValid();
            return (
                original.state === (backup.previousRunning ? "running" : "stopped") &&
                original.enabled === backup.previousEnabled &&
                (await originalMatches())
            );
        },
        async stopOriginal(input) {
            bound(input);
            targetValid();
            await retainedValid();
            if (!(await originalMatches())) throw fail();
            await platform.quiesce();
        },
        verifyQuiescent: quiet,
        async writeTarget(input) {
            bound(input);
            targetValid();
            if (!(await quiet()) || !files.matchesOriginal()) throw fail();
            workspacePrepared = true;
            prepareServiceMigrationWorkspace(
                workspace,
                options.operationId,
                backup.previousRunning ? "running" : "stopped",
            );
            const release = acquireControlWorkspace(workspace);
            try {
                prepareServiceProcessOwnershipSeed(workspace);
            } finally {
                release();
            }
            workspaceConfirmed = true;
            files.apply();
            await platform.reload(backup.previousEnabled);
        },
        async startTarget(input) {
            bound(input);
            targetValid();
            if (
                !backup.previousRunning ||
                !files.matchesTarget() ||
                !ownsWorkspace() ||
                !(await quiet())
            )
                throw fail();
            startRequested = true;
            await platform.start();
            const state = await platform.inspect();
            if (state.processId && state.identity)
                targetProcess = { pid: state.processId, identity: state.identity };
        },
        async verifyTarget(input) {
            bound(input);
            targetValid();
            if (!files.matchesTarget() || !ownsWorkspace()) return false;
            const first = await platform.inspect();
            if (first.enabled !== backup.previousEnabled) return false;
            if (!backup.previousRunning) return first.state === "stopped" && (await quiet());
            if (first.state !== "running" || !first.running || !first.processId) return false;
            if (
                targetProcess &&
                (first.processId !== targetProcess.pid || first.identity !== targetProcess.identity)
            )
                return false;
            const control = await manager.inspect(workspace);
            const second = await platform.inspect();
            if (
                !isDeepStrictEqual(first, second) ||
                control.manager.pid !== first.processId ||
                !control.serviceMigration.pending ||
                control.serviceMigration.recoveryRequired ||
                control.gateway.desired !== "running" ||
                control.gateway.recoveryRequired
            )
                return false;
            if (managerId && control.manager.id !== managerId) return false;
            if (!first.identity) return false;
            targetProcess ??= { pid: first.processId, identity: first.identity };
            managerId ??= control.manager.id;
            if (
                control.gateway.actual !== "running" &&
                !(plan.sourceState === "damaged" && control.knownConfigurationFailure)
            )
                return false;
            return files.matchesTarget();
        },
        async releaseTarget(input) {
            bound(input);
            targetValid();
            if (!files.matchesTarget() || !ownsWorkspace()) throw fail();
            if (backup.previousRunning) {
                const state = await platform.inspect();
                const control = await manager.inspect(workspace);
                if (
                    !managerId ||
                    control.manager.id !== managerId ||
                    state.processId !== control.manager.pid ||
                    state.state !== "running"
                )
                    throw fail();
                await manager.release(workspace, options.operationId);
            } else {
                if (!(await quiet())) throw fail();
                const release = acquireControlWorkspace(workspace);
                try {
                    releaseServiceMigrationPending(workspace, options.operationId);
                } finally {
                    release();
                }
            }
        },
        async stopTarget(input) {
            bound(input);
            const state = await platform.inspect();
            if (!state.running && state.quiescent) return;
            // 不根据服务名停止别的配置或尚未由本事务请求启动的实例。
            if (
                !startRequested ||
                !files.matchesTarget() ||
                !ownsWorkspace() ||
                !targetProcess ||
                state.processId !== targetProcess.pid ||
                state.identity !== targetProcess.identity
            )
                throw fail();
            await platform.quiesce();
        },
        async canRestore(input) {
            bound(input);
            await retainedValid();
            return (
                files.canRestore() &&
                (!workspacePrepared || (workspaceConfirmed && ownsWorkspace())) &&
                (await quiet())
            );
        },
        async restoreOriginal(input) {
            bound(input);
            await retainedValid();
            if (
                !files.canRestore() ||
                (workspacePrepared && !workspaceConfirmed) ||
                !(await quiet())
            )
                throw fail();
            if (workspacePrepared) {
                const release = acquireControlWorkspace(workspace);
                try {
                    blockServiceMigrationWorkspace(workspace, options.operationId);
                } finally {
                    release();
                }
            }
            files.restore();
            await platform.reload(backup.previousEnabled);
        },
        async startOriginal(input) {
            bound(input);
            await retainedValid();
            if (!backup.previousRunning || !files.matchesRestored() || !(await quiet()))
                throw fail();
            await platform.start();
        },
        async verifyRestored(input) {
            bound(input);
            await retainedValid();
            if (!files.matchesRestored()) return false;
            const state = await platform.inspect();
            return (
                state.enabled === backup.previousEnabled &&
                (backup.previousRunning
                    ? state.state === "running" && state.running && state.processId !== null
                    : state.state === "stopped" && (await quiet()))
            );
        },
    };
    const verifyTarget = port.verifyTarget;
    const verifyRestored = port.verifyRestored;
    port.verifyTarget = input => ready(() => verifyTarget(input));
    port.verifyRestored = input => ready(() => verifyRestored(input));
    return port;
}
