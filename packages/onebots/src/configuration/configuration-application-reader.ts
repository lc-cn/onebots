import path from "node:path";
import {
    parseConfigurationDocument,
    type ConfigurationDocument,
} from "./configuration-document.js";
import {
    checkApplicationBase as checkBase,
    checkApplicationRuntimeFields,
    type ConfigurationApplicationJournal,
    type ConfigurationApplicationOptions,
} from "./configuration-application-contracts.js";
import {
    readFile,
    checkRepair,
    checkRepairRevisions,
    applicationDigest as digest,
} from "./configuration-application-storage.js";
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const invalid = () => new Error("配置应用记录或请求无效");

export function readConfigurationApplicationJournal(
    directory: string,
    id: string,
    options: Pick<ConfigurationApplicationOptions, "source" | "recovery">,
): ConfigurationApplicationJournal {
    try {
        if (!ID.test(id)) throw invalid();
        const raw = parseConfigurationDocument(
            JSON.parse(readFile(path.join(directory, `${id}.json`), 4_200_000)),
        );
        checkBase(raw.base);
        checkApplicationRuntimeFields(raw);
        if (
            raw.schemaVersion !== 1 ||
            raw.id !== id ||
            typeof raw.validationId !== "string" ||
            !ID.test(raw.validationId) ||
            typeof raw.documentDigest !== "string" ||
            !HASH.test(raw.documentDigest) ||
            typeof raw.previousDigest !== "string" ||
            !HASH.test(raw.previousDigest) ||
            !["running", "succeeded", "failed", "interrupted"].includes(String(raw.status)) ||
            ![
                "accepted",
                "stopping",
                "writing",
                "starting",
                "applying",
                "restoring",
                "completed",
                "failed",
            ].includes(String(raw.phase)) ||
            !["running", "stopped"].includes(String(raw.desired)) ||
            typeof raw.recoveryRequired !== "boolean" ||
            (raw.configRevision !== undefined &&
                (typeof raw.configRevision !== "string" || !HASH.test(raw.configRevision))) ||
            (raw.candidateRevision !== undefined &&
                (typeof raw.candidateRevision !== "string" || !HASH.test(raw.candidateRevision))) ||
            (raw.rolledBack !== undefined && typeof raw.rolledBack !== "boolean") ||
            (raw.restoreRolledBack !== undefined && typeof raw.restoreRolledBack !== "boolean") ||
            (raw.error !== undefined &&
                !["CONFIG_APPLY_FAILED", "CONFIG_RECOVERY_REQUIRED"].includes(String(raw.error)))
        )
            throw invalid();
        const operation = raw as unknown as ConfigurationApplicationJournal;
        const document = readApplicationDocument(directory, operation.documentDigest);
        if (operation.mode !== undefined || operation.repair !== undefined) {
            if (operation.mode !== "repair") throw invalid();
            checkRepair(operation.repair, operation.base);
            checkRepairRevisions(operation, document, options.source);
            const original = options.recovery?.read(operation.repair!);
            if (!original || digest(original) !== operation.previousDigest) throw invalid();
        } else readApplicationDocument(directory, operation.previousDigest);
        return operation;
    } catch {
        throw invalid();
    }
}
export function readApplicationDocument(directory: string, hash: string): ConfigurationDocument {
    if (!HASH.test(hash)) throw invalid();
    const content = readFile(path.join(directory, "documents", `${hash}.json`), 4_200_000);
    if (digest(content) !== hash) throw invalid();
    return parseConfigurationDocument(JSON.parse(content));
}
