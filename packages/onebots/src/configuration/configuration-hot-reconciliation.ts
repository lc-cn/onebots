import { createHash } from "node:crypto";
import type { ConfigurationRecoveryTransactionPort } from "../control/generation-activation.js";
import { canonicalConfiguration } from "./configuration-store.js";
import type {
    ConfigurationApplicationJournal,
    ConfigurationApplicationOptions,
} from "./configuration-application-contracts.js";
import {
    projectConfigurationOperation,
    type ConfigurationApplicationOperation,
} from "./configuration-application-contracts.js";

export async function queryHotConfigurationStatus(
    id: string,
    options: ConfigurationApplicationOptions,
    journal: {
        read(id: string): ConfigurationApplicationJournal;
        previous(operation: ConfigurationApplicationJournal): Record<string, unknown>;
        save(operation: ConfigurationApplicationJournal): void;
        settled(): void;
    },
): Promise<ConfigurationApplicationOperation> {
    const operation = journal.read(id);
    if (
        !operation.recoveryRequired ||
        !["hot", "stored"].includes(operation.executionMode ?? "") ||
        !options.lifecycle.runConfigurationRecoveryTransaction
    )
        return projectConfigurationOperation(operation);
    try {
        return await options.lifecycle.runConfigurationRecoveryTransaction(
            async port => {
                const current = journal.read(id);
                if (
                    await reconcileHotConfiguration(
                        current,
                        port,
                        options,
                        () => journal.previous(current),
                        journal.save,
                    )
                )
                    journal.settled();
                return projectConfigurationOperation(current);
            },
            { allowLiveRuntime: true },
        );
    } catch {
        // 原实例、原回执或磁盘事实无法确认时继续封锁，绝不把查询当作重新执行。
        return projectConfigurationOperation(journal.read(id));
    }
}

/** 查询只读取原回执；确认结果后仅收敛配置文件和意图，不重新派发实例操作。 */
export async function reconcileHotConfiguration(
    operation: ConfigurationApplicationJournal,
    port: ConfigurationRecoveryTransactionPort,
    options: ConfigurationApplicationOptions,
    previous: () => Record<string, unknown>,
    save: (operation: ConfigurationApplicationJournal) => void,
): Promise<boolean> {
    if (port.activeGenerationId() !== operation.base.generationId) return false;
    const source = options.source.read();
    const sourceDigest = createHash("sha256")
        .update(canonicalConfiguration(source.document))
        .digest("hex");
    const validRevision = /^[a-f0-9]{64}$/.test(source.revision);
    if (!validRevision) return false;
    if (operation.executionMode === "stored") {
        if (operation.desired === "running" && operation.impact?.mode !== "none") return false;
        // 在线 none 的 stored 路径只确认磁盘保存，不声称执行过实例动作。
        if (operation.desired === "stopped" && port.runtimeStopped?.() !== true) return false;
        const committed =
            sourceDigest === operation.documentDigest &&
            (operation.candidateRevision === undefined ||
                source.revision === operation.candidateRevision);
        const unchanged =
            sourceDigest === operation.previousDigest &&
            source.revision === operation.base.configRevision;
        if (!committed && !unchanged) return false;
        operation.configRevision = source.revision;
        operation.status = committed ? "succeeded" : "failed";
        operation.phase = committed ? "completed" : "failed";
        operation.recoveryRequired = false;
        if (committed) delete operation.error;
        else operation.error = "CONFIG_APPLY_FAILED";
        save(operation);
        return true;
    }
    // accepted/writing 意图在 applying 落盘前不可能派发，恢复文件不依赖已死亡实例的回执。
    // restoring 意图允许识别已提交的旧文档，不重复覆盖或重派原操作。
    if (["accepted", "writing", "restoring"].includes(operation.phase)) {
        // 已有新实例可能从候选磁盘配置启动；不能仅凭旧意图修改文件并留下运行态漂移。
        const runtime = port.runtimeContext?.();
        const originalRuntimeUnchanged =
            operation.runtimeBefore &&
            runtime?.gatewayInstanceId === operation.runtimeBefore.gatewayInstanceId &&
            runtime?.configVersion === operation.runtimeBefore.configVersion;
        if (!originalRuntimeUnchanged && port.runtimeStopped?.() !== true) return false;
        if (sourceDigest !== operation.previousDigest && sourceDigest !== operation.documentDigest)
            return false;
        if (sourceDigest === operation.documentDigest) {
            if (
                operation.candidateRevision !== undefined &&
                source.revision !== operation.candidateRevision
            )
                return false;
            const restored = options.source.replace(source.revision, previous());
            if (
                !/^[a-f0-9]{64}$/.test(restored.revision) ||
                createHash("sha256")
                    .update(canonicalConfiguration(restored.document))
                    .digest("hex") !== operation.previousDigest
            )
                return false;
            operation.configRevision = restored.revision;
        } else operation.configRevision = source.revision;
        operation.status = "failed";
        if (operation.restoreRolledBack !== undefined)
            operation.rolledBack = operation.restoreRolledBack;
        delete operation.restoreRolledBack;
        operation.phase = "failed";
        operation.recoveryRequired = false;
        operation.error = "CONFIG_APPLY_FAILED";
        save(operation);
        return true;
    }
    if (
        !operation.runtimeBefore ||
        !operation.runtimeAfter ||
        !operation.configRevision ||
        !port.queryRuntimeConfiguration ||
        port.activeGenerationId() !== operation.base.generationId ||
        port.runtimeContext?.()?.gatewayInstanceId !== operation.runtimeBefore.gatewayInstanceId
    )
        return false;
    const result = await port.queryRuntimeConfiguration({
        id: operation.id,
        expected: operation.runtimeBefore,
    });
    const current = options.source.read();
    if (
        current.revision !== operation.configRevision ||
        createHash("sha256").update(canonicalConfiguration(current.document)).digest("hex") !==
            operation.documentDigest
    )
        return false;
    if (result.status === "applied" && result.configVersion === operation.runtimeAfter) {
        operation.status = "succeeded";
        operation.phase = "completed";
        operation.recoveryRequired = false;
        delete operation.error;
    } else if (
        (result.status === "rolled_back" || result.status === "rejected") &&
        result.configVersion === operation.runtimeBefore.configVersion
    ) {
        operation.phase = "restoring";
        operation.restoreRolledBack = result.status === "rolled_back";
        save(operation);
        const restored = options.source.replace(operation.configRevision, previous());
        if (
            !/^[a-f0-9]{64}$/.test(restored.revision) ||
            createHash("sha256").update(canonicalConfiguration(restored.document)).digest("hex") !==
                operation.previousDigest
        )
            return false;
        operation.configRevision = restored.revision;
        operation.status = "failed";
        operation.phase = "failed";
        operation.rolledBack = result.status === "rolled_back";
        delete operation.restoreRolledBack;
        operation.recoveryRequired = false;
        operation.error = "CONFIG_APPLY_FAILED";
    } else return false;
    save(operation);
    return true;
}
