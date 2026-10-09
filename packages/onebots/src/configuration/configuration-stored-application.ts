import { createHash } from "node:crypto";
import type { ConfigurationTransactionPort } from "../control/generation-activation.js";
import { canonicalConfiguration } from "./configuration-store.js";
import {
    projectConfigurationOperation,
    type ConfigurationApplicationJournal,
    type ConfigurationApplicationOperation,
    type ConfigurationApplicationOptions,
} from "./configuration-application-contracts.js";

/** 网关停止时仅保存配置；不启动账号，也不生成虚假的运行回执。 */
export function executeStoredConfiguration(
    operation: ConfigurationApplicationJournal,
    document: Record<string, unknown>,
    port: ConfigurationTransactionPort,
    options: ConfigurationApplicationOptions,
    save: (value: ConfigurationApplicationJournal) => void,
    unknown: () => ConfigurationApplicationOperation,
): ConfigurationApplicationOperation {
    try {
        if (operation.desired === "stopped" && port.hasLiveChildren()) return unknown();
        operation.phase = "writing";
        save(operation);
        const next = options.source.replace(operation.base.configRevision, document);
        if (
            !/^[a-f0-9]{64}$/.test(next.revision) ||
            createHash("sha256").update(canonicalConfiguration(next.document)).digest("hex") !==
                operation.documentDigest ||
            (operation.candidateRevision !== undefined &&
                operation.candidateRevision !== next.revision)
        )
            return unknown();
        operation.configRevision = next.revision;
        operation.status = "succeeded";
        operation.phase = "completed";
        save(operation);
        return projectConfigurationOperation(operation);
    } catch {
        return unknown();
    }
}
