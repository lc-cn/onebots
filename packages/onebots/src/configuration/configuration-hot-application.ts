import { createHash } from "node:crypto";
import type { ConfigurationTransactionPort } from "../control/generation-activation.js";
import { canonicalConfiguration } from "./configuration-store.js";
import type {
    ConfigurationApplicationJournal,
    ConfigurationApplicationOperation,
    ConfigurationApplicationOptions,
} from "./configuration-application.js";

/** 热应用与配置磁盘提交共享意图记录；断链或回执缺失绝不推测已回滚。 */
export async function executeHotConfiguration(
    operation: ConfigurationApplicationJournal,
    document: Record<string, unknown>,
    port: ConfigurationTransactionPort,
    options: ConfigurationApplicationOptions,
    journal: {
        save(value: ConfigurationApplicationJournal): void;
        previous(): Record<string, unknown>;
        unknown(): ConfigurationApplicationOperation;
        project(value: ConfigurationApplicationJournal): ConfigurationApplicationOperation;
    },
): Promise<ConfigurationApplicationOperation> {
    const restore = (rolledBack: boolean): ConfigurationApplicationOperation => {
        if (!operation.configRevision) return journal.unknown();
        operation.phase = "restoring";
        operation.restoreRolledBack = rolledBack;
        journal.save(operation);
        const restored = options.source.replace(operation.configRevision, journal.previous());
        if (
            !/^[a-f0-9]{64}$/.test(restored.revision) ||
            createHash("sha256").update(canonicalConfiguration(restored.document)).digest("hex") !==
                operation.previousDigest
        )
            return journal.unknown();
        operation.configRevision = restored.revision;
        operation.status = "failed";
        operation.phase = "failed";
        operation.rolledBack = rolledBack;
        delete operation.restoreRolledBack;
        operation.error = "CONFIG_APPLY_FAILED";
        journal.save(operation);
        return journal.project(operation);
    };
    try {
        if (!operation.runtimeBefore || !port.applyRuntimeConfiguration || !options.runtime)
            return journal.unknown();
        // writing 意图先落盘且永远表示尚未派发；快照只能在源提交确认后发布，避免写失败累积工件。
        operation.phase = "writing";
        journal.save(operation);
        const next = options.source.replace(operation.base.configRevision, document);
        if (
            !/^[a-f0-9]{64}$/.test(next.revision) ||
            (operation.candidateRevision !== undefined &&
                operation.candidateRevision !== next.revision) ||
            createHash("sha256").update(canonicalConfiguration(next.document)).digest("hex") !==
                operation.documentDigest
        )
            return journal.unknown();
        operation.configRevision = next.revision;
        const snapshot = options.runtime.snapshot(next.document);
        operation.runtimeAfter = snapshot.configVersion;
        operation.phase = "applying";
        journal.save(operation);
        const result = await port.applyRuntimeConfiguration({
            id: operation.id,
            expected: operation.runtimeBefore,
            nextConfigVersion: snapshot.configVersion,
            configPath: snapshot.configPath,
        });
        if (result.status === "applied" && result.configVersion === snapshot.configVersion) {
            if (options.source.read().revision !== operation.configRevision)
                return journal.unknown();
            operation.status = "succeeded";
            operation.phase = "completed";
        } else if (
            (result.status === "rolled_back" || result.status === "rejected") &&
            result.configVersion === operation.runtimeBefore.configVersion
        ) {
            return restore(result.status === "rolled_back");
        } else return journal.unknown();
        journal.save(operation);
        return journal.project(operation);
    } catch {
        // 本地文件与远端实例任何一方失去确认都必须保留未知状态，不自动重派。
        return journal.unknown();
    }
}
