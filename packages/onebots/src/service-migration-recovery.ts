import path from "node:path";
import { isDeepStrictEqual } from "node:util";
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

const failure = () => new Error("无法确认迁移尚未切换且旧服务未变，保留恢复记录；未执行系统动作");

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
