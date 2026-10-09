import {
    privateDirectory,
    readFile,
    atomic,
    checkRepair,
    checkRepairRevisions,
    writeApplicationJournal,
    applicationDocumentBytes as bytes,
    applicationDigest as digest,
} from "./configuration-application-storage.js";
import { reconcileRepair } from "./configuration-reconciliation.js";
import fs from "node:fs";
import { planRuntimeConfiguration } from "@onebots/core";
import { executeHotConfiguration } from "./configuration-hot-application.js";
import { queryHotConfigurationStatus } from "./configuration-hot-reconciliation.js";
import { executeStoredConfiguration } from "./configuration-stored-application.js";
import path from "node:path";
import type { ConfigurationTransactionPort } from "../control/generation-activation.js";
import {
    parseConfigurationDocument,
    type ConfigurationDocument,
} from "./configuration-document.js";
import {
    ConfigurationConflictError,
    type ConfigurationBase,
    type ConfigurationRepairReference,
} from "./configuration-store.js";
import { observeNamedPersistedOperation } from "../persisted-operation-observer.js";

import type {
    ConfigurationApplicationOptions,
    ConfigurationApplicationInput,
    ConfigurationApplicationOperation,
    ConfigurationApplicationJournal,
} from "./configuration-application-contracts.js";
import {
    checkApplicationBase as checkBase,
    checkApplicationRuntimeFields,
    projectConfigurationOperation as publicOperation,
} from "./configuration-application-contracts.js";
export type * from "./configuration-application-contracts.js";
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const invalid = (): Error => new Error("配置应用记录或请求无效");
/** 唯一 manager 拥有此目录。私有文档与操作意图先落盘，未确认结果从不自动重放。 */
export class ConfigurationApplication {
    private readonly directory: string;
    private blocked = false;
    constructor(private readonly options: ConfigurationApplicationOptions) {
        this.directory = path.resolve(options.directory);
        privateDirectory(this.directory);
        privateDirectory(path.join(this.directory, "documents"));
        for (const filename of fs.readdirSync(this.directory)) {
            if (!filename.endsWith(".json")) continue;
            try {
                const operation = this.read(filename.slice(0, -5));
                if (operation.status === "running") {
                    operation.status = "interrupted";
                    operation.recoveryRequired = true;
                    operation.error = "CONFIG_RECOVERY_REQUIRED";
                    this.save(operation);
                }
                if (operation.recoveryRequired) this.blocked = true;
            } catch {
                // 损坏记录不能被当作新工作区；保留原文件和固定健康状态。
                this.blocked = true;
            }
        }
    }
    health(): { recoveryRequired: boolean } {
        return { recoveryRequired: this.blocked };
    }
    async reconcileRestore(
        id: string,
        expectedRevision: string,
    ): Promise<ConfigurationApplicationOperation> {
        if (
            !HASH.test(expectedRevision) ||
            !this.options.lifecycle.runConfigurationRecoveryTransaction
        )
            throw invalid();
        return this.options.lifecycle.runConfigurationRecoveryTransaction(async port => {
            const operation = this.read(id);
            if (!operation.recoveryRequired || operation.mode !== "repair" || !operation.repair)
                throw invalid();
            try {
                const result = reconcileRepair(
                    operation,
                    expectedRevision,
                    port,
                    this.options,
                    value => this.save(value),
                );
                this.blocked = fs
                    .readdirSync(this.directory)
                    .filter(name => name.endsWith(".json"))
                    .some(name => this.read(name.slice(0, -5)).recoveryRequired);
                return publicOperation(result);
            } catch (error) {
                if (error instanceof ConfigurationConflictError) throw error;
                return this.unknown(operation);
            }
        });
    }
    status(id: string): ConfigurationApplicationOperation {
        return publicOperation(this.read(id));
    }
    async queryStatus(id: string): Promise<ConfigurationApplicationOperation> {
        return queryHotConfigurationStatus(id, this.options, {
            read: key => this.read(key),
            previous: operation => this.readDocument(operation.previousDigest),
            save: operation => this.save(operation),
            settled: () => {
                this.blocked = fs
                    .readdirSync(this.directory)
                    .filter(name => name.endsWith(".json"))
                    .some(name => this.read(name.slice(0, -5)).recoveryRequired);
            },
        });
    }
    /** 区分从未派发与损坏记录；调用者不能把 status 读取失败当成可重试。 */
    hasOperation(id: string): boolean {
        try {
            fs.lstatSync(this.file(id));
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
            throw invalid();
        }
    }
    async apply(input: ConfigurationApplicationInput): Promise<ConfigurationApplicationOperation> {
        let request: ConfigurationApplicationInput;
        try {
            const snapshot = parseConfigurationDocument(input);
            if (
                !ID.test(String(snapshot.id)) ||
                typeof snapshot.id !== "string" ||
                !ID.test(String(snapshot.validationId)) ||
                typeof snapshot.validationId !== "string" ||
                Object.keys(snapshot)
                    .filter(key => key !== "allowRestart" && key !== "impact")
                    .sort()
                    .join(",") !==
                    (snapshot.repair === undefined
                        ? "base,document,id,validationId"
                        : "base,document,id,repair,validationId")
            )
                throw invalid();
            if (snapshot.allowRestart !== undefined && typeof snapshot.allowRestart !== "boolean")
                throw invalid();
            checkApplicationRuntimeFields({ impact: snapshot.impact });
            checkBase(snapshot.base);
            if (snapshot.repair !== undefined) checkRepair(snapshot.repair, snapshot.base);
            request = {
                id: snapshot.id,
                validationId: snapshot.validationId,
                base: snapshot.base as unknown as ConfigurationBase,
                document: parseConfigurationDocument(snapshot.document),
                ...(snapshot.impact
                    ? {
                          impact: snapshot.impact as unknown as ConfigurationApplicationInput["impact"],
                      }
                    : {}),
                ...(typeof snapshot.allowRestart === "boolean"
                    ? { allowRestart: snapshot.allowRestart }
                    : {}),
                ...(snapshot.repair !== undefined
                    ? { repair: snapshot.repair as unknown as ConfigurationRepairReference }
                    : {}),
            };
        } catch {
            throw invalid();
        }
        const candidate = bytes(request.document);
        // 修复写入与冷恢复均从同一规范文档序列化，避免键顺序改变原始摘要。
        if (request.repair) request.document = parseConfigurationDocument(JSON.parse(candidate));
        const candidateDigest = digest(candidate);
        if (fs.existsSync(this.file(request.id))) {
            const previous = this.read(request.id);
            if (
                previous.repair?.backupId !== request.repair?.backupId ||
                previous.repair?.originalRevision !== request.repair?.originalRevision ||
                previous.validationId !== request.validationId ||
                previous.documentDigest !== candidateDigest ||
                previous.base.configRevision !== request.base.configRevision ||
                previous.base.generationId !== request.base.generationId
            )
                throw new ConfigurationConflictError();
            return publicOperation(previous);
        }
        if (this.blocked) throw new Error("配置应用需要人工对账");
        let plannedImpact: ConfigurationApplicationInput["impact"];
        if (!request.repair) {
            const before = this.options.source.read();
            if (before.revision !== request.base.configRevision)
                throw new ConfigurationConflictError();
            plannedImpact = this.options.planImpact
                ? await this.options.planImpact(before.document, request.document)
                : planRuntimeConfiguration(before.document, request.document);
        }
        return this.options.lifecycle.runConfigurationTransaction(async port => {
            if (fs.existsSync(this.file(request.id))) {
                const previous = this.read(request.id);
                if (
                    previous.repair?.backupId !== request.repair?.backupId ||
                    previous.repair?.originalRevision !== request.repair?.originalRevision ||
                    previous.validationId !== request.validationId ||
                    previous.documentDigest !== candidateDigest ||
                    previous.base.configRevision !== request.base.configRevision ||
                    previous.base.generationId !== request.base.generationId
                )
                    throw new ConfigurationConflictError();
                return publicOperation(previous);
            }
            if (this.blocked || port.gatewayStatus().recoveryRequired)
                throw new Error("配置应用需要人工对账");
            let before: { revision: string; document?: Record<string, unknown> };
            try {
                if (request.repair) {
                    const inspection = this.options.source.inspect?.();
                    if (inspection?.state !== "damaged") throw new ConfigurationConflictError();
                    if (
                        !this.options.source.replaceRaw ||
                        !this.options.source.serialize ||
                        !this.options.recovery
                    )
                        throw invalid();
                    const original = this.options.recovery.read(request.repair);
                    if (digest(original) !== request.base.configRevision) throw invalid();
                    before = { revision: inspection.revision };
                } else before = this.options.source.read();
            } catch (error) {
                if (error instanceof ConfigurationConflictError) throw error;
                throw invalid();
            }
            if (
                port.activeGenerationId() !== request.base.generationId ||
                before.revision !== request.base.configRevision
            )
                throw new ConfigurationConflictError();
            const previousBytes = request.repair ? undefined : bytes(before.document);
            const impact = request.repair ? undefined : plannedImpact;
            if (request.impact && impact && bytes(request.impact) !== bytes(impact))
                throw new ConfigurationConflictError();
            const runtimeBefore = port.runtimeContext?.();
            const desired = port.gatewayStatus().desired;
            const executionMode =
                desired === "stopped"
                    ? "stored"
                    : (impact?.mode === "hot" || impact?.mode === "none") &&
                        runtimeBefore &&
                        port.applyRuntimeConfiguration &&
                        this.options.runtime
                      ? "hot"
                      : impact?.mode === "none"
                        ? "stored"
                        : "restart";
            if (executionMode === "restart" && request.allowRestart !== true)
                throw new Error("此配置需要重启网关，请明确确认重启后再应用");
            const operation: ConfigurationApplicationJournal = {
                ...(impact ? { impact } : {}),
                executionMode,
                ...(executionMode === "hot" ? { runtimeBefore } : {}),
                schemaVersion: 1,
                id: request.id,
                validationId: request.validationId,
                base: { ...request.base },
                desired: port.gatewayStatus().desired,
                documentDigest: candidateDigest,
                previousDigest: request.repair
                    ? request.repair.originalRevision
                    : digest(previousBytes!),
                ...(request.repair
                    ? { mode: "repair" as const, repair: { ...request.repair } }
                    : {}),
                ...(this.options.source.serialize
                    ? {
                          candidateRevision: digest(
                              this.options.source.serialize!(request.document),
                          ),
                      }
                    : {}),
                status: "running",
                phase: "accepted",
                recoveryRequired: false,
            };
            try {
                if (previousBytes !== undefined)
                    this.saveDocument(operation.previousDigest, previousBytes);
                this.saveDocument(candidateDigest, candidate);
                this.save(operation);
            } catch {
                this.blocked = true;
                throw new Error("配置应用意图无法持久化，需要检查本地状态");
            }
            return this.execute(operation, request.document, port);
        });
    }
    private async execute(
        operation: ConfigurationApplicationJournal,
        document: Record<string, unknown>,
        port: ConfigurationTransactionPort,
    ): Promise<ConfigurationApplicationOperation> {
        if (operation.executionMode === "hot") {
            return executeHotConfiguration(operation, document, port, this.options, {
                save: value => this.save(value),
                previous: () => this.readDocument(operation.previousDigest),
                unknown: () => this.unknown(operation),
                project: publicOperation,
            });
        }
        if (operation.executionMode === "stored") {
            return executeStoredConfiguration(
                operation,
                document,
                port,
                this.options,
                value => this.save(value),
                () => this.unknown(operation),
            );
        }
        // 此变量区分可确认的网关动作失败和磁盘/记录写入的不确定结果。
        let actionFailure = false;
        try {
            operation.phase = "stopping";
            this.save(operation);
            const stopped = await port.suspend();
            if (stopped.status !== "succeeded") {
                actionFailure = true;
                throw invalid();
            }
            if (port.hasLiveChildren() || port.gatewayStatus().recoveryRequired) throw invalid();
            operation.phase = "writing";
            this.save(operation);
            const next = this.options.source.replace(operation.base.configRevision, document);
            if (
                !HASH.test(next.revision) ||
                (operation.candidateRevision !== undefined &&
                    operation.candidateRevision !== next.revision) ||
                digest(bytes(next.document)) !== operation.documentDigest
            )
                throw invalid();
            operation.configRevision = next.revision;
            operation.phase = "starting";
            this.save(operation);
            if (operation.desired === "running") {
                const started = await port.start();
                if (started.status !== "succeeded") {
                    actionFailure = true;
                    throw invalid();
                }
            }
            if (this.options.source.read().revision !== operation.configRevision) throw invalid();
            operation.status = "succeeded";
            operation.phase = "completed";
            this.save(operation);
            return publicOperation(operation);
        } catch {
            if (actionFailure && !port.hasLiveChildren() && !port.gatewayStatus().recoveryRequired)
                return this.rollback(operation, port);
            return this.unknown(operation);
        }
    }
    private async rollback(
        operation: ConfigurationApplicationJournal,
        port: ConfigurationTransactionPort,
    ): Promise<ConfigurationApplicationOperation> {
        try {
            const current = operation.repair
                ? this.options.source.inspect?.()
                : this.options.source.read();
            if (!current) throw invalid();
            const expected = operation.configRevision ?? operation.base.configRevision;
            if (current.revision !== expected) throw invalid();
            operation.phase = "restoring";
            this.save(operation);
            if (operation.configRevision !== undefined) {
                if (operation.repair) {
                    const original = this.options.recovery?.read(operation.repair);
                    if (!original || digest(original) !== operation.previousDigest) throw invalid();
                    const restored = this.options.source.replaceRaw?.(expected, original);
                    if (!restored || restored.revision !== operation.previousDigest)
                        throw invalid();
                    operation.configRevision = restored.revision;
                } else {
                    const restored = this.options.source.replace(
                        expected,
                        this.readDocument(operation.previousDigest),
                    );
                    if (
                        digest(bytes(restored.document)) !== operation.previousDigest ||
                        !HASH.test(restored.revision)
                    )
                        throw invalid();
                    operation.configRevision = restored.revision;
                }
            }
            if (port.hasLiveChildren()) throw invalid();
            if (operation.desired === "running" && !operation.repair) {
                const started = await port.start();
                if (started.status !== "succeeded") throw invalid();
            }
            if (
                (operation.repair
                    ? this.options.source.inspect?.().revision
                    : this.options.source.read().revision) !==
                (operation.configRevision ?? operation.base.configRevision)
            )
                throw invalid();
            operation.status = "failed";
            operation.phase = "failed";
            operation.rolledBack = true;
            if (operation.repair) operation.sourceState = "damaged";
            operation.error = "CONFIG_APPLY_FAILED";
            this.save(operation);
            return publicOperation(operation);
        } catch {
            return this.unknown(operation);
        }
    }
    private unknown(operation: ConfigurationApplicationJournal): ConfigurationApplicationOperation {
        this.blocked = true;
        delete operation.rolledBack;
        operation.status = "failed";
        operation.recoveryRequired = true;
        operation.error = "CONFIG_RECOVERY_REQUIRED";
        try {
            this.save(operation);
        } catch {
            // 已持久化的 running 意图会在重启后继续封锁，不能宣称回滚成功。
        }
        return publicOperation(operation);
    }
    private file(id: string): string {
        if (typeof id !== "string" || !ID.test(id)) throw invalid();
        return path.join(this.directory, `${id}.json`);
    }
    private save(operation: ConfigurationApplicationJournal): void {
        writeApplicationJournal(this.file(operation.id), operation);
        if (operation.status !== "running")
            observeNamedPersistedOperation(
                this.options.onOperation,
                "configuration.apply",
                operation,
            );
    }
    private read(id: string): ConfigurationApplicationJournal {
        try {
            const raw = parseConfigurationDocument(JSON.parse(readFile(this.file(id), 4_200_000)));
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
                    (typeof raw.candidateRevision !== "string" ||
                        !HASH.test(raw.candidateRevision))) ||
                (raw.rolledBack !== undefined && typeof raw.rolledBack !== "boolean") ||
                (raw.restoreRolledBack !== undefined &&
                    typeof raw.restoreRolledBack !== "boolean") ||
                (raw.error !== undefined &&
                    !["CONFIG_APPLY_FAILED", "CONFIG_RECOVERY_REQUIRED"].includes(
                        String(raw.error),
                    ))
            )
                throw invalid();
            const operation = raw as unknown as ConfigurationApplicationJournal;
            const document = this.readDocument(operation.documentDigest);
            if (operation.mode !== undefined || operation.repair !== undefined) {
                if (operation.mode !== "repair") throw invalid();
                checkRepair(operation.repair, operation.base);
                checkRepairRevisions(operation, document, this.options.source);
                const original = this.options.recovery?.read(operation.repair!);
                if (!original || digest(original) !== operation.previousDigest) throw invalid();
            } else this.readDocument(operation.previousDigest);
            return operation;
        } catch {
            throw invalid();
        }
    }
    private saveDocument(hash: string, content: string): void {
        const file = path.join(this.directory, "documents", `${hash}.json`);
        if (fs.existsSync(file)) {
            this.readDocument(hash);
            return;
        }
        atomic(file, content);
    }
    private readDocument(hash: string): ConfigurationDocument {
        if (!HASH.test(hash)) throw invalid();
        const content = readFile(path.join(this.directory, "documents", `${hash}.json`), 4_200_000);
        if (digest(content) !== hash) throw invalid();
        return parseConfigurationDocument(JSON.parse(content));
    }
}
