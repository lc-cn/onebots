import path from "node:path";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import { ServiceMigrationTransaction } from "./service-migration-transaction.js";
import type { RetainedLegacyRuntime } from "./service-migration-retained-runtime.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";
import type { ServiceMigrationBackup, ServiceMigrationPort } from "./service-migration-types.js";
import type { PersistedOperationObserver } from "./persisted-operation-observer.js";

/** 所有系统服务迁移入口必须经过这里，锁覆盖快照、日志、外部动作及最终确认。 */
export async function migrateSystemService(options: {
    stateDirectory: string;
    id: string;
    /** 只读获取真实旧定义与状态，不能执行停机、写盘或安装。 */
    capture(): Promise<ServiceMigrationBackup>;
    /** 意图落盘后捕获；只允许创建私有旧工件，不得改变系统服务或业务工作区。 */
    retain?(backup: ServiceMigrationBackup): Promise<RetainedLegacyRuntime>;
    prepareManager?(
        backup: ServiceMigrationBackup,
    ): Promise<{ spec: ManagerServiceSpec; digest: string }>;
    port: ServiceMigrationPort | ((backup: ServiceMigrationBackup) => ServiceMigrationPort);
    onOperation?: PersistedOperationObserver;
}) {
    if (options.prepareManager && !options.retain) throw new Error("管理候选准备必须先保留旧工件");
    const release = acquireServiceMigrationLock(options.stateDirectory);
    try {
        const journal = new FileServiceMigrationJournal(
            path.join(options.stateDirectory, "migrations"),
            options.onOperation,
        );
        const backup = await options.capture();
        if (options.retain) {
            let record = journal.prepare(options.id, backup);
            let port: ServiceMigrationPort;
            try {
                record.phase = "capturing-runtime";
                journal.save(record);
                const retained = await options.retain(journal.backup(record));
                record = journal.bindRuntime(record, retained);
                if (options.prepareManager) {
                    record.phase = "preparing-manager";
                    journal.save(record);
                    const candidate = await options.prepareManager(journal.backup(record));
                    verifyManagerServiceCandidate(candidate.spec, candidate.digest);
                    record = journal.bindManagerCandidate(record, candidate.spec, candidate.digest);
                }
                const bound = journal.backup(record);
                port = typeof options.port === "function" ? options.port(bound) : options.port;
            } catch {
                // 捕获或绑定结果未知时不派发OS动作；重读可能已经落盘的新摘要。
                record = journal.read(options.id);
                record.status = "interrupted";
                record.recoveryRequired = true;
                journal.save(record);
                return record;
            }
            return await new ServiceMigrationTransaction(journal, port).runPrepared(record);
        }
        const port = typeof options.port === "function" ? options.port(backup) : options.port;
        return await new ServiceMigrationTransaction(journal, port).run(options.id, backup);
    } finally {
        release();
    }
}

/** 本地对账前的固定状态查询，不返回备份内容；同时受服务级锁保护。 */
export function inspectServiceMigration(stateDirectory: string, id: string) {
    const release = acquireServiceMigrationLock(stateDirectory);
    try {
        return new FileServiceMigrationJournal(path.join(stateDirectory, "migrations")).read(id);
    } finally {
        release();
    }
}
