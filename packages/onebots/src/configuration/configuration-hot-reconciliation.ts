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
        operation.executionMode !== "hot" ||
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
        save(operation);
        const restored = options.source.replace(operation.configRevision, previous());
        operation.configRevision = restored.revision;
        operation.status = "failed";
        operation.phase = "failed";
        operation.rolledBack = result.status === "rolled_back";
        operation.recoveryRequired = false;
        operation.error = "CONFIG_APPLY_FAILED";
    } else return false;
    save(operation);
    return true;
}
