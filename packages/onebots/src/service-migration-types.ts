import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { RetainedLegacyRuntime } from "./service-migration-retained-runtime.js";

export type ServiceMigrationPhase =
    | "prepared"
    | "capturing-runtime"
    | "preparing-manager"
    | "stopping-old"
    | "writing-target"
    | "target-written"
    | "starting-manager"
    | "verifying"
    | "releasing-target"
    | "stopping-target"
    | "restoring"
    | "restarting-old"
    | "reloading-old"
    | "starting-old"
    | "verifying-restored"
    | "cancelled"
    | "completed";
export type ServiceMigrationRollbackOrigin = "pre-target" | "target-written";
export interface ServiceMigrationReloadOldReceipt {
    schemaVersion: 1;
    backupDigest: string;
    rollbackContractDigest: string;
    enabled: boolean;
    loaded: boolean;
    definitionPath: string;
}
export interface ServiceMigrationStartOldReceipt {
    schemaVersion: 1;
    reloadReceiptDigest: string;
    processId: number;
    identity: string;
}
export type ServiceMigrationJournalTransition =
    | { type: "target-written" }
    | { type: "advance-target" }
    | { type: "begin-rollback"; origin: ServiceMigrationRollbackOrigin }
    | { type: "restoring" }
    | { type: "reloading-old" }
    | { type: "complete-success" }
    | { type: "interrupt" };
declare const migrationProof: unique symbol;
export type ServiceMigrationReloadedProof = { readonly [migrationProof]: "reloaded" };
export type ServiceMigrationStartedProof = { readonly [migrationProof]: "started" };
export type ServiceMigrationRestoredProof = { readonly [migrationProof]: "restored" };
export type ServiceMigrationEffectProof =
    | ServiceMigrationReloadedProof
    | ServiceMigrationStartedProof
    | ServiceMigrationRestoredProof;
export interface ServiceMigrationFile {
    role: "definition" | "metadata" | "configuration" | "runner";
    path: string;
    mode: number;
    /** 精确保留原文件编码及换行；仅存放在私有备份中。 */
    contentBase64: string;
}
export interface ServiceMigrationBackup {
    schemaVersion: 1;
    target: ManagerServiceSpec;
    previousRunning: boolean;
    previousEnabled: boolean;
    files: ServiceMigrationFile[];
    /** 新捕获的旧工件；历史记录缺失时仍可只读，但不能据此宣称旧运行闭包已保留。 */
    retainedRuntime?: RetainedLegacyRuntime;
    /** 绑定目标管理程序的双验证收据摘要，不将当前CLI目录视为不可变工件。 */
    targetCandidateDigest?: string;
}
export interface ServiceMigrationRecord {
    /** 准备与工件绑定阶段保留v1；目标写入确认及闭合回退事务升级为v2。 */
    schemaVersion: 1 | 2;
    id: string;
    backupDigest: string;
    /** 工件/候选绑定前的不可变备份，仅由绑定事务追加，状态检查不读取其正文。 */
    previousBackupDigests?: string[];
    phase: ServiceMigrationPhase;
    status: "running" | "succeeded" | "failed" | "interrupted";
    recoveryRequired: boolean;
    rolledBack: boolean;
    /** v2回退来源；只能由journal专用事务绑定。 */
    rollbackOrigin?: ServiceMigrationRollbackOrigin;
    /** v2旧定义重载收据；由稳定OS观测生成并经journal专用事务绑定。 */
    reloadOldReceipt?: ServiceMigrationReloadOldReceipt;
    /** v2旧实例启动收据；仅在原服务应运行时绑定。 */
    startOldReceipt?: ServiceMigrationStartOldReceipt;
}
export interface ServiceMigrationJournal {
    /** 未结束操作或损坏日志必须拒绝新迁移；相同ID也不能自动重放。 */
    prepare(id: string, backup: ServiceMigrationBackup): ServiceMigrationRecord;
    read(id: string): ServiceMigrationRecord;
    backup(record: ServiceMigrationRecord): ServiceMigrationBackup;
    save(record: ServiceMigrationRecord): void;
    transition(
        expected: Readonly<ServiceMigrationRecord>,
        command: ServiceMigrationJournalTransition | ServiceMigrationEffectProof,
    ): ServiceMigrationRecord;
}

/** 平台驱动须给出实际观测，绝不能以请求已发出或PID文件缺失代替停止证明。 */
export interface ServiceMigrationPort {
    verifyOriginal(backup: ServiceMigrationBackup): Promise<boolean>;
    stopOriginal(backup: ServiceMigrationBackup): Promise<void>;
    verifyQuiescent(): Promise<boolean>;
    writeTarget(backup: ServiceMigrationBackup): Promise<void>;
    startTarget(backup: ServiceMigrationBackup): Promise<void>;
    /**
     * 核验定义/配置/启用状态和原启停意图。原运行时须核验manager身份；合法配置要求
     * gateway ready，原配置已损坏时允许明确的配置失败但manager必须健康且可修复。
     * 不得将未知子进程或任意启动失败等同已知配置损坏；原停止时不得启动。
     */
    verifyTarget(backup: ServiceMigrationBackup): Promise<boolean>;
    /** 验收后开放管理操作；结果未知时只能对账，不能回退覆盖用户的新操作。 */
    releaseTarget(backup: ServiceMigrationBackup): Promise<void>;
    stopTarget(backup: ServiceMigrationBackup): Promise<void>;
    /** 只有原始或本次候选文件摘要且进程已停止时才允许恢复。 */
    canRestore(backup: ServiceMigrationBackup): Promise<boolean>;
    /** 只恢复旧文件；重载系统定义是下一项独立外部效果。 */
    restoreOriginal(backup: ServiceMigrationBackup): Promise<void>;
    /** 重载旧定义并返回与备份及完整回退契约绑定的稳定停态收据。 */
    reloadOriginal(
        backup: ServiceMigrationBackup,
        backupDigest: string,
    ): Promise<ServiceMigrationReloadOldReceipt>;
    /** 仅接受同一Port实例刚生成的重载收据，不会隐式重载或选择另一实例。 */
    startOriginal(
        backup: ServiceMigrationBackup,
        reloadReceipt?: ServiceMigrationReloadOldReceipt,
    ): Promise<ServiceMigrationStartOldReceipt>;
    verifyRestored(
        backup: ServiceMigrationBackup,
        reloadReceipt?: ServiceMigrationReloadOldReceipt,
        startReceipt?: ServiceMigrationStartOldReceipt,
    ): Promise<boolean>;
}
