import type { ConfigurationImpact } from "@onebots/core";
import type { GenerationActivationController } from "../control/generation-activation.js";
import type { PersistedOperationObserver } from "../persisted-operation-observer.js";
import type { ConfigurationBase, ConfigurationRepairReference } from "./configuration-store.js";
import { parseConfigurationDocument } from "./configuration-document.js";

export function checkApplicationBase(value: unknown): void {
    const base = parseConfigurationDocument(value);
    if (
        Object.keys(base).sort().join(",") !== "configRevision,generationId" ||
        !(
            base.generationId === null ||
            (typeof base.generationId === "string" && /^[a-f0-9-]{36}$/.test(base.generationId))
        ) ||
        typeof base.configRevision !== "string" ||
        !/^[a-f0-9]{64}$/.test(base.configRevision)
    )
        throw new Error("配置应用记录或请求无效");
}

/** 持久记录是恢复边界：新热更新字段损坏时封锁，不能退回旧冷启动路径。 */
export function checkApplicationRuntimeFields(value: Record<string, unknown>): void {
    const invalid = () => {
        throw new Error("配置应用运行时记录无效");
    };
    const hash = (input: unknown) => typeof input === "string" && /^[a-f0-9]{64}$/.test(input);
    const identifier = (input: unknown) =>
        typeof input === "string" &&
        input.length > 0 &&
        input.length <= 512 &&
        !/[\p{Cc}\p{Cf}]/u.test(input);
    if (
        value.executionMode !== undefined &&
        !["hot", "restart", "stored"].includes(String(value.executionMode))
    )
        invalid();
    if (value.runtimeAfter !== undefined && !hash(value.runtimeAfter)) invalid();
    if (value.runtimeBefore !== undefined) {
        const context = parseConfigurationDocument(value.runtimeBefore);
        if (
            Object.keys(context).sort().join(",") !== "configVersion,gatewayInstanceId" ||
            !hash(context.configVersion) ||
            !identifier(context.gatewayInstanceId)
        )
            invalid();
    }
    if (value.executionMode === "hot" && value.runtimeBefore === undefined) invalid();
    if (value.impact === undefined) return;
    const impact = parseConfigurationDocument(value.impact);
    if (
        Object.keys(impact).sort().join(",") !==
            "accounts,dynamicFields,mode,protocols,restartReasons" ||
        !["none", "hot", "restart"].includes(String(impact.mode))
    )
        invalid();
    for (const field of ["dynamicFields", "restartReasons"]) {
        const entries = impact[field];
        if (!Array.isArray(entries) || entries.length > 1000 || !entries.every(identifier))
            invalid();
    }
    for (const field of ["accounts", "protocols"]) {
        const entries = impact[field];
        if (!Array.isArray(entries) || entries.length > 1000) invalid();
        for (const entry of entries as unknown[]) {
            const item = parseConfigurationDocument(entry);
            const protocol = field === "protocols";
            if (
                Object.keys(item).sort().join(",") !==
                    (protocol
                        ? "accountId,action,name,platform,version"
                        : "accountId,action,platform") ||
                !identifier(item.platform) ||
                !identifier(item.accountId) ||
                !(
                    protocol ? ["add", "replace", "remove"] : ["add", "reconnect", "remove"]
                ).includes(String(item.action)) ||
                (protocol && (!identifier(item.name) || !identifier(item.version)))
            )
                invalid();
        }
    }
}

export interface ConfigurationSourceSnapshot {
    revision: string;
    document: Record<string, unknown>;
}
export interface ConfigurationApplicationOptions {
    runtime?: {
        snapshot(document: Record<string, unknown>): { configPath: string; configVersion: string };
    };
    directory: string;
    source: {
        read(): ConfigurationSourceSnapshot;
        serialize?(document: unknown): Buffer;
        inspect?(): { state: "ready" | "damaged"; revision: string };
        replaceRaw?(
            expectedRevision: string,
            bytes: Uint8Array,
        ): { revision: string; bytes: Buffer };
        replace(
            expectedRevision: string,
            document: Record<string, unknown>,
        ): ConfigurationSourceSnapshot;
    };
    lifecycle: Pick<GenerationActivationController, "runConfigurationTransaction"> &
        Partial<Pick<GenerationActivationController, "runConfigurationRecoveryTransaction">>;
    recovery?: { read(reference: ConfigurationRepairReference): Buffer };
    onOperation?: PersistedOperationObserver;
}
export interface ConfigurationApplicationInput {
    impact?: ConfigurationImpact;
    allowRestart?: boolean;
    repair?: ConfigurationRepairReference;
    id: string;
    validationId: string;
    base: ConfigurationBase;
    document: Record<string, unknown>;
}
export interface ConfigurationApplicationOperation {
    id: string;
    validationId: string;
    status: "running" | "succeeded" | "failed" | "interrupted";
    phase:
        | "accepted"
        | "stopping"
        | "writing"
        | "starting"
        | "applying"
        | "restoring"
        | "completed"
        | "failed";
    impact?: ConfigurationImpact;
    executionMode?: "hot" | "restart" | "stored";
    recoveryRequired: boolean;
    rolledBack?: boolean;
    sourceState?: "damaged";
    configRevision?: string;
    error?: "CONFIG_APPLY_FAILED" | "CONFIG_RECOVERY_REQUIRED";
}
export interface ConfigurationApplicationJournal extends ConfigurationApplicationOperation {
    runtimeBefore?: { gatewayInstanceId: string; configVersion: string };
    runtimeAfter?: string;
    mode?: "repair";
    repair?: ConfigurationRepairReference;
    schemaVersion: 1;
    base: ConfigurationBase;
    desired: "running" | "stopped";
    documentDigest: string;
    previousDigest: string;
    candidateRevision?: string;
}

export function projectConfigurationOperation(
    value: ConfigurationApplicationJournal,
): ConfigurationApplicationOperation {
    return {
        id: value.id,
        validationId: value.validationId,
        ...(value.impact ? { impact: value.impact } : {}),
        ...(value.executionMode ? { executionMode: value.executionMode } : {}),
        status: value.status,
        phase: value.phase,
        recoveryRequired: value.recoveryRequired,
        ...(value.rolledBack !== undefined ? { rolledBack: value.rolledBack } : {}),
        ...(value.sourceState === "damaged" ? { sourceState: "damaged" as const } : {}),
        ...(value.configRevision !== undefined ? { configRevision: value.configRevision } : {}),
        ...(value.error !== undefined ? { error: value.error } : {}),
    };
}
