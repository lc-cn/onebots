import type {
    ServiceMigrationBackup,
    ServiceMigrationJournal,
    ServiceMigrationJournalTransition,
    ServiceMigrationPhase,
    ServiceMigrationPort,
    ServiceMigrationRecord,
} from "./service-migration-types.js";
import { ServiceMigrationRollbackCoordinator } from "./service-migration-effect-proof.js";

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
        let operation = this.journal.read(record.id);
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
            operation = this.phase(operation, "stopping-old");
            await this.port.stopOriginal(backup);
            if (!(await this.port.verifyQuiescent())) throw new Error("旧服务停止结果未知");
            operation = this.phase(operation, "writing-target");
            await this.port.writeTarget(backup);
            operation = this.transition(operation, { type: "target-written" });
            if (backup.previousRunning) {
                operation = this.transition(operation, { type: "advance-target" });
                await this.port.startTarget(backup);
            }
            operation = this.transition(operation, { type: "advance-target" });
            if (!(await this.port.verifyTarget(backup))) throw new Error("新管理服务未通过验收");
        } catch (error) {
            // 日志结果未知时不再写配置/调用OS，避免外部效果超出可恢复意图。
            if (error instanceof PersistenceFailure) return this.unknown(operation);
            if (operation.phase === "prepared") return this.unknown(operation);
            // 写入抛错或target-written收据未落盘时，不能推断目标文件效果并自动覆盖。
            if (operation.phase === "writing-target") return this.unknown(operation);
            return this.rollback(operation, backup);
        }
        // 开放后用户可能已修改配置或启停；释放响应/最终日志未知时不得回退。
        try {
            operation = this.transition(operation, { type: "advance-target" });
            await this.port.releaseTarget(backup);
        } catch {
            return this.unknown(operation);
        }
        try {
            operation = this.transition(operation, { type: "complete-success" });
        } catch {
            return this.unknown(operation);
        }
        return { ...operation };
    }

    private async rollback(operation: ServiceMigrationRecord, backup: ServiceMigrationBackup) {
        const effects = new ServiceMigrationRollbackCoordinator(this.journal, this.port, backup);
        try {
            if (operation.phase !== "stopping-old") {
                operation = this.transition(operation, {
                    type: "begin-rollback",
                    origin: "target-written",
                });
                // 驱动只可停止它能确认归属的新实例，不能按服务名盲杀旧/外部实例。
                await this.port.stopTarget(backup);
            }
            if (!(await this.port.verifyQuiescent()) || !(await this.port.canRestore(backup)))
                return this.unknown(operation);
            operation =
                operation.phase === "stopping-old"
                    ? this.transition(operation, {
                          type: "begin-rollback",
                          origin: "pre-target",
                      })
                    : this.transition(operation, { type: "restoring" });
            await this.port.restoreOriginal(backup);
            operation = this.transition(operation, { type: "reloading-old" });
            operation = await effects.reload(operation);
            if (backup.previousRunning) operation = await effects.start(operation);
            operation = await effects.complete(operation);
            return { ...operation };
        } catch {
            // 固定失败记录不包含配置、OS输出或凭据；未确认恢复时阻止下一次迁移。
            return this.unknown(operation);
        }
    }

    private phase(
        operation: ServiceMigrationRecord,
        phase: ServiceMigrationPhase,
    ): ServiceMigrationRecord {
        try {
            this.journal.save({ ...operation, phase });
            return this.journal.read(operation.id);
        } catch {
            throw new PersistenceFailure("迁移意图无法持久化");
        }
    }

    private transition(
        operation: ServiceMigrationRecord,
        command: ServiceMigrationJournalTransition,
    ): ServiceMigrationRecord {
        try {
            return this.journal.transition(operation, command);
        } catch {
            throw new PersistenceFailure("迁移意图无法持久化");
        }
    }

    private unknown(operation: ServiceMigrationRecord): ServiceMigrationRecord {
        try {
            const current = this.journal.read(operation.id);
            if (
                current.phase === "completed" &&
                !current.recoveryRequired &&
                ["succeeded", "failed"].includes(current.status)
            )
                return current;
            if (current.schemaVersion === 2)
                return this.journal.transition(current, { type: "interrupt" });
            const interrupted = {
                ...current,
                status: "interrupted" as const,
                recoveryRequired: true,
                rolledBack: false,
            };
            this.journal.save(interrupted);
            return this.journal.read(operation.id);
        } catch {
            // 之前的running意图仍留在磁盘；冷启动必须继续封锁，不自动重放。
        }
        return {
            ...operation,
            status: "interrupted",
            recoveryRequired: true,
            rolledBack: false,
        };
    }
}
