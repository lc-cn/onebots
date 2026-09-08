import {
    FileManagerServiceJournal,
    type ManagerServicePreparation,
    type ManagerServicePhase,
    type ManagerServiceRecord,
} from "./manager-service-journal.js";

/**
 * 实现方持有服务级锁和工件存储锁，整个调用期间不得释放。
 * 文件/OS 端口必须核验记录中的精确候选与快照，不接受任意路径替换。
 * 不允许在这些方法内部重试启动、释放或写入结果未知的动作。
 */
export interface ManagerServiceUpgradePort {
    /** 只读检查原 OS 状态、文件快照、双候选身份和工作区数据格式兼容性。 */
    verifyPrepared(record: ManagerServiceRecord): Promise<void>;
    /** 禁止自动拉起并等待旧 manager、gateway 和安装 worker 完全退出。 */
    quiescePrevious(record: ManagerServiceRecord): Promise<void>;
    /** 重核退出证明，在写服务文件前建立工作区维护门禁。 */
    prepareMaintenance(record: ManagerServiceRecord): Promise<void>;
    /** 仅替换服务定义与元数据；不得恢复或覆写账号、ID、认证和业务配置。 */
    writeCandidate(record: ManagerServiceRecord): Promise<void>;
    /** 重读定义并恢复原启用状态，不启动服务；维护门禁此时仍存在。 */
    restoreEnablement(record: ManagerServiceRecord): Promise<void>;
    startCandidate(record: ManagerServiceRecord): Promise<void>;
    /** 原运行服务验证新实例身份及维护状态；原停止服务验证仍无进程。 */
    verifyCandidate(record: ManagerServiceRecord): Promise<void>;
    /**
     * 原运行服务使用绑定新实例的本地释放；原停止服务只允许经退出证明的
     * 离线完成，不启动 manager 或 gateway。两者均须持久保存精确操作回执。
     */
    releaseCandidate(record: ManagerServiceRecord): Promise<void>;
    /** 只读确认持久释放回执、定义和启用/运行状态，绝不重派释放。 */
    verifyReleased(record: ManagerServiceRecord): Promise<void>;
}

/**
 * 新操作的唯一派发顺序。已有操作（包括中断操作）须走显式对账，不能重跑此函数。
 * 本协调器不猜测回滚安全性；任何未知结果保留原记录供专用恢复流程检查。
 */
export async function runManagerServiceUpgrade(
    preparation: ManagerServicePreparation,
    journal: FileManagerServiceJournal,
    port: ManagerServiceUpgradePort,
): Promise<ManagerServiceRecord> {
    if (preparation.action !== "upgrade" || !preparation.upgrade)
        throw new Error("管理升级缺少完整的双版本意图");
    // prepare 的闭合解析和唯一 ID 检查发生在任何端口调用之前。
    const record = journal.prepare(preparation);
    const call = async (phase: ManagerServicePhase, action: () => Promise<void>) => {
        record.phase = phase;
        journal.save(record);
        await action();
    };
    try {
        await port.verifyPrepared(structuredClone(record));
        await call("stopping", () => port.quiescePrevious(structuredClone(record)));
        // 维护门禁与文件变更同属于 writing 意图；冷启动不能把半步完成当作成功。
        await call("writing", async () => {
            await port.prepareMaintenance(structuredClone(record));
            await port.writeCandidate(structuredClone(record));
        });
        await call("restoring-enablement", () => port.restoreEnablement(structuredClone(record)));
        if (record.upgrade!.snapshot.initial.processId !== null)
            await call("starting", () => port.startCandidate(structuredClone(record)));
        await call("verifying", () => port.verifyCandidate(structuredClone(record)));
        await call("releasing", () => port.releaseCandidate(structuredClone(record)));
        await port.verifyReleased(structuredClone(record));
        const completed: ManagerServiceRecord = {
            ...record, phase: "completed", status: "succeeded", recoveryRequired: false,
        };
        journal.save(completed);
        return journal.read(record.id);
    } catch {
        // 不能用补写失败掩盖原始未知结果，也不能因此重放OS动作。
        try {
            const current = journal.read(record.id);
            journal.save({ ...current, status: "interrupted", recoveryRequired: true });
        } catch {
            // 原持久 running 阶段会在冷启动转为 interrupted；损坏日志也会封锁后续操作。
        }
        throw new Error("管理服务升级尚未确认，已停止派发；请对账原操作，禁止重试安装或自动回滚");
    }
}
