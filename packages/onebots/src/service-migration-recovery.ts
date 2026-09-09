import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import fs from "node:fs";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";
import type { ServiceScope } from "./service-definition.js";
import type { ServicePlatform } from "./service-platform.js";
import { getServiceFiles } from "./service-files.js";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import { captureServiceMigration } from "./service-migration-capture.js";
import { SystemdServicePlatform } from "./service-platform-systemd.js";
import { LaunchdServicePlatform } from "./service-platform-launchd.js";
import { readServiceMigrationPending } from "./service-migration-workspace.js";
import { assertNoPendingManagerUpgrade } from "./service-upgrade-workspace.js";
import { ServiceMigrationFiles } from "./service-migration-files.js";
import { createServiceMigrationFilePlan } from "./service-migration-file-plan.js";
import {
    retainedRollbackFiles,
    verifyRetainedLegacyRuntime,
} from "./service-migration-retained-runtime.js";

const failure = () => new Error("无法确认迁移尚未切换且旧服务未变，保留恢复记录；未执行系统动作");
const rollbackFailure = () =>
    new Error("无法确认旧服务已停止且目标尚未接管，保留恢复记录；未继续回退");

/** 显式取消尚未停服的迁移；保留全部备份及失败工件，不重放、不恢复文件、不清理目录。 */
export async function cancelUnstartedServiceMigration(
    id: string,
    scope: ServiceScope,
    host: ServiceHost = createDefaultServiceHost(),
    platform?: Pick<ServicePlatform, "inspect">,
) {
    if (
        !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
        !["user", "system"].includes(scope) ||
        !["linux", "darwin"].includes(host.platform) ||
        (scope === "system" && host.uid !== 0)
    )
        throw failure();
    const paths = getServiceFiles(scope, host);
    const release = acquireServiceMigrationLock(paths.stateDir);
    try {
        const journal = new FileServiceMigrationJournal(path.join(paths.stateDir, "migrations"));
        const record = journal.read(id);
        const backup = journal.backup(record);
        if (backup.target.scope !== scope) throw failure();
        // 已取消记录只读返回；之后发生的合法迁移不应使历史取消变成重派。
        if (record.phase === "cancelled") return record;
        if (
            !record.recoveryRequired ||
            record.status !== "interrupted" ||
            !["prepared", "capturing-runtime", "preparing-manager"].includes(record.phase) ||
            record.rolledBack
        )
            throw failure();
        if (readServiceMigrationPending(backup.target.workspace)) throw failure();
        assertNoPendingManagerUpgrade(backup.target.workspace);
        const inspector =
            platform ??
            (host.platform === "linux"
                ? new SystemdServicePlatform(host, scope, paths.definition)
                : new LaunchdServicePlatform(host, scope, paths.definition));
        const current = await captureServiceMigration(backup.target, host, inspector);
        const {
            retainedRuntime: _retained,
            targetCandidateDigest: _candidate,
            ...original
        } = backup;
        if (!isDeepStrictEqual(current, original) || !isDeepStrictEqual(journal.read(id), record))
            throw failure();
        // 早期阶段证明本操作未派发OS变更；这里只结束原意图，绝不声称做过回滚。
        journal.save({
            ...record,
            phase: "cancelled",
            status: "failed",
            recoveryRequired: false,
            rolledBack: false,
        });
        return journal.read(id);
    } catch {
        throw failure();
    } finally {
        release();
    }
}

/**
 * 冷回退只处理旧服务已静止且目标文件尚未写入的中断，以及本函数自身的恢复/重启阶段。
 * 它绝不停止当前进程；目标文件或目标管理进程已出现时必须走单独的身份对账。
 */
export async function rollbackStoppedServiceMigration(
    id: string,
    scope: ServiceScope,
    host: ServiceHost = createDefaultServiceHost(),
    platform?: ServicePlatform,
) {
    if (
        !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
        !["user", "system"].includes(scope) ||
        !["linux", "darwin"].includes(host.platform) ||
        (scope === "system" && host.uid !== 0)
    )
        throw rollbackFailure();
    const paths = getServiceFiles(scope, host);
    const release = acquireServiceMigrationLock(paths.stateDir);
    try {
        const journal = new FileServiceMigrationJournal(path.join(paths.stateDir, "migrations"));
        let record = journal.read(id);
        const backup = journal.backup(record);
        if (backup.target.scope !== scope || !backup.retainedRuntime) throw rollbackFailure();
        if (
            record.phase === "completed" &&
            record.status === "failed" &&
            record.rolledBack &&
            !record.recoveryRequired
        )
            return record;
        if (
            record.status !== "interrupted" ||
            !record.recoveryRequired ||
            record.rolledBack ||
            !["stopping-old", "restoring", "restarting-old"].includes(record.phase)
        )
            throw rollbackFailure();
        const controlDirectory = path.join(backup.target.workspace, ".control");
        const verifyWorkspace = async () => {
            // 捕获契约要求旧入口没有 .control；出现目录即代表已有并发接管或目标曾写入。
            // 不创建锁文件污染旧工作区，服务级锁继续排斥所有受支持的系统生命周期入口。
            try {
                fs.lstatSync(controlDirectory);
                throw rollbackFailure();
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw rollbackFailure();
            }
        };
        await verifyWorkspace();
        await verifyRetainedLegacyRuntime(backup.retainedRuntime);
        const plan = createServiceMigrationFilePlan(backup, host);
        const files = new ServiceMigrationFiles(
            backup,
            plan.files,
            retainedRollbackFiles(backup, host),
        );
        // systemd 的 cgroup.events 可在冷启动后证明组内进程为空。launchd 在热停机观测丢失后
        // 没有等价的内核组证据；默认入口必须拒绝，直到停机证明被持久化并可重验。
        if (!platform && host.platform !== "linux") throw rollbackFailure();
        const driver = platform ?? new SystemdServicePlatform(host, scope, paths.definition);
        const observed = await driver.inspect();
        const stableDefinition = observed.definitionPath === paths.definition && observed.loaded;
        const restoredRunning =
            record.phase === "restarting-old" &&
            backup.previousRunning &&
            stableDefinition &&
            files.matchesRestored() &&
            observed.state === "running" &&
            observed.running &&
            observed.processId !== null &&
            observed.identity !== null &&
            observed.enabled === backup.previousEnabled &&
            isDeepStrictEqual(observed, await driver.inspect());
        if (!restoredRunning) {
            const originalFiles = files.matchesOriginal();
            const restoredFiles = files.matchesRestored();
            if (
                !stableDefinition ||
                observed.state !== "stopped" ||
                observed.running ||
                !observed.quiescent ||
                (record.phase === "stopping-old"
                    ? !originalFiles || observed.enabled
                    : !files.canRestore() || (!restoredFiles && observed.enabled))
            )
                throw rollbackFailure();
            await verifyWorkspace();
            record = { ...record, phase: "restoring" };
            journal.save(record);
            files.restore();
            await verifyWorkspace();
            await driver.reload(backup.previousEnabled);
            if (backup.previousRunning) {
                await verifyWorkspace();
                record = { ...record, phase: "restarting-old" };
                journal.save(record);
                await driver.start();
            }
        }
        await verifyWorkspace();
        if (!files.matchesRestored()) throw rollbackFailure();
        const final = await driver.inspect();
        if (
            final.definitionPath !== paths.definition ||
            !final.loaded ||
            final.enabled !== backup.previousEnabled ||
            (backup.previousRunning
                ? final.state !== "running" ||
                  !final.running ||
                  final.processId === null ||
                  final.identity === null
                : final.state !== "stopped" || final.running || !final.quiescent) ||
            !isDeepStrictEqual(final, await driver.inspect())
        )
            throw rollbackFailure();
        const completed = {
            ...record,
            phase: "completed" as const,
            status: "failed" as const,
            recoveryRequired: false,
            rolledBack: true,
        };
        journal.save(completed);
        return journal.read(id);
    } catch {
        throw rollbackFailure();
    } finally {
        release();
    }
}
