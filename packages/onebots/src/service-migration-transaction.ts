import type {
    ServiceMigrationBackup,
    ServiceMigrationJournal,
    ServiceMigrationPhase,
    ServiceMigrationPort,
    ServiceMigrationRecord,
} from "./service-migration-types.js";

class PersistenceFailure extends Error {}

/**
 * 调用方必须在整个调用期间持有服务级排他锁（不是新manager需要的工作区锁）。
 * 已有记录只供查询；任何冷中断必须另行对账，不从阶段名推断外部动作完成。
 */
export class ServiceMigrationTransaction {
    private queue: Promise<void> = Promise.resolve();
    constructor(
        private readonly journal: ServiceMigrationJournal,
        private readonly port: ServiceMigrationPort,
    ) {}

    run(id: string, backup: ServiceMigrationBackup): Promise<ServiceMigrationRecord> {
        const task = this.queue.then(() => this.execute(id, backup));
        this.queue = task.then(
            () => undefined,
            () => undefined,
        );
        return task;
    }
    /** 只接受当前进程刚完成捕获绑定的prepared记录；冷恢复不能调用此方法重放。 */
    runPrepared(record: ServiceMigrationRecord): Promise<ServiceMigrationRecord> {
        const task = this.queue.then(() => this.executePrepared(record));
        this.queue = task.then(
            () => undefined,
            () => undefined,
        );
        return task;
    }

    private async execute(
        id: string,
        input: ServiceMigrationBackup,
    ): Promise<ServiceMigrationRecord> {
        return this.executePrepared(this.journal.prepare(id, input));
    }

    private async executePrepared(record: ServiceMigrationRecord): Promise<ServiceMigrationRecord> {
        const operation = this.journal.read(record.id);
        if (
            JSON.stringify(operation) !== JSON.stringify(record) ||
            operation.phase !== "prepared" ||
            operation.status !== "running" ||
            operation.recoveryRequired
        )
            throw new Error("迁移准备记录已变化，禁止重放");
        const backup = this.journal.backup(operation);
        try {
            if (!(await this.port.verifyOriginal(backup))) throw new Error("旧服务基线已变化");
            this.phase(operation, "stopping-old");
            await this.port.stopOriginal(backup);
            if (!(await this.port.verifyQuiescent())) throw new Error("旧服务停止结果未知");
            this.phase(operation, "writing-target");
            await this.port.writeTarget(backup);
            if (backup.previousRunning) {
                this.phase(operation, "starting-manager");
                await this.port.startTarget(backup);
            }
            this.phase(operation, "verifying");
            if (!(await this.port.verifyTarget(backup))) throw new Error("新管理服务未通过验收");
        } catch (error) {
            // 日志结果未知时不再写配置/调用OS，避免外部效果超出可恢复意图。
            if (error instanceof PersistenceFailure) return this.unknown(operation);
            if (operation.phase === "prepared") return this.unknown(operation);
            return this.rollback(operation, backup);
        }
        // 开放后用户可能已修改配置或启停；释放响应/最终日志未知时不得回退。
        try {
            this.phase(operation, "releasing-target");
            await this.port.releaseTarget(backup);
        } catch {
            return this.unknown(operation);
        }
        operation.status = "succeeded";
        operation.phase = "completed";
        try {
            this.journal.save(operation);
        } catch {
            return this.unknown(operation);
        }
        return { ...operation };
    }

    private async rollback(operation: ServiceMigrationRecord, backup: ServiceMigrationBackup) {
        try {
            if (operation.phase !== "stopping-old") {
                this.phase(operation, "stopping-target");
                // 驱动只可停止它能确认归属的新实例，不能按服务名盲杀旧/外部实例。
                await this.port.stopTarget(backup);
            }
            if (!(await this.port.verifyQuiescent()) || !(await this.port.canRestore(backup)))
                return this.unknown(operation);
            this.phase(operation, "restoring");
            await this.port.restoreOriginal(backup);
            if (backup.previousRunning) {
                this.phase(operation, "restarting-old");
                await this.port.startOriginal(backup);
            }
            if (!(await this.port.verifyRestored(backup))) return this.unknown(operation);
            operation.phase = "completed";
            operation.status = "failed";
            operation.rolledBack = true;
            operation.recoveryRequired = false;
            this.journal.save(operation);
            return { ...operation };
        } catch {
            // 固定失败记录不包含配置、OS输出或凭据；未确认恢复时阻止下一次迁移。
            return this.unknown(operation);
        }
    }

    private phase(operation: ServiceMigrationRecord, phase: ServiceMigrationPhase): void {
        operation.phase = phase;
        try {
            this.journal.save(operation);
        } catch {
            throw new PersistenceFailure("迁移意图无法持久化");
        }
    }

    private unknown(operation: ServiceMigrationRecord): ServiceMigrationRecord {
        operation.status = "interrupted";
        operation.recoveryRequired = true;
        operation.rolledBack = false;
        try {
            this.journal.save(operation);
        } catch {
            // 之前的running意图仍留在磁盘；冷启动必须继续封锁，不自动重放。
        }
        return { ...operation };
    }
}
