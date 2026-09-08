import path from "node:path";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import { ServiceMigrationTransaction } from "./service-migration-transaction.js";
import type { ServiceMigrationBackup, ServiceMigrationPort } from "./service-migration-types.js";

/** 所有系统服务迁移入口必须经过这里，锁覆盖快照、日志、外部动作及最终确认。 */
export async function migrateSystemService(options: {
    stateDirectory: string;
    id: string;
    /** 只读获取真实旧定义与状态，不能执行停机、写盘或安装。 */
    capture(): Promise<ServiceMigrationBackup>;
    port: ServiceMigrationPort | ((backup: ServiceMigrationBackup) => ServiceMigrationPort);
}) {
    const release = acquireServiceMigrationLock(options.stateDirectory);
    try {
        const journal = new FileServiceMigrationJournal(
            path.join(options.stateDirectory, "migrations"),
        );
        const backup = await options.capture();
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
