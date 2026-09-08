import { createHash } from "node:crypto";
import type { ConfigurationRecoveryTransactionPort } from "../control/generation-activation.js";
import type {
    ConfigurationApplicationJournal,
    ConfigurationApplicationOptions,
} from "./configuration-application.js";
import { ConfigurationConflictError } from "./configuration-store.js";

/** 只恢复本次操作曾拥有的原始字节，不启动网关，不推断候选曾经 ready。 */
export function reconcileRepair(
    operation: ConfigurationApplicationJournal,
    expectedRevision: string,
    port: ConfigurationRecoveryTransactionPort,
    options: Pick<ConfigurationApplicationOptions, "source" | "recovery">,
    save: (operation: ConfigurationApplicationJournal) => void,
): ConfigurationApplicationJournal {
    if (!operation.recoveryRequired || operation.mode !== "repair" || !operation.repair)
        throw new Error("此操作不属于待对账的配置修复");
    const current = options.source.inspect?.();
    if (
        !current ||
        current.revision !== expectedRevision ||
        port.activeGenerationId() !== operation.base.generationId ||
        ![
            operation.base.configRevision,
            operation.candidateRevision,
            operation.configRevision,
        ].includes(current.revision)
    )
        throw new ConfigurationConflictError();
    if (port.hasLiveChildren() || port.gatewayStatus().recoveryRequired)
        throw new Error("网关进程归属尚未确认");
    const original = options.recovery?.read(operation.repair);
    if (
        !original ||
        createHash("sha256").update(original).digest("hex") !== operation.base.configRevision ||
        operation.previousDigest !== operation.base.configRevision ||
        !options.source.replaceRaw
    )
        throw new Error("修复备份无法核实");
    operation.phase = "restoring";
    save(operation);
    if (current.revision !== operation.base.configRevision) {
        const restored = options.source.replaceRaw(expectedRevision, original);
        if (restored.revision !== operation.base.configRevision)
            throw new Error("原始字节恢复未确认");
    }
    const restored = options.source.inspect?.();
    if (restored?.state !== "damaged" || restored.revision !== operation.base.configRevision)
        throw new Error("原始字节恢复未确认");
    operation.configRevision = restored.revision;
    operation.status = "failed";
    operation.phase = "failed";
    operation.rolledBack = true;
    operation.sourceState = "damaged";
    operation.recoveryRequired = false;
    operation.error = "CONFIG_APPLY_FAILED";
    save(operation);
    return operation;
}
