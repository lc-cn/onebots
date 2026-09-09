import {
    privateDirectory,
    readFile,
    atomic,
    checkRepair,
    checkRepairRevisions,
} from "./configuration-application-storage.js";
import { reconcileRepair } from "./configuration-reconciliation.js";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
    GenerationActivationController,
    ConfigurationTransactionPort,
} from "../control/generation-activation.js";
import {
    parseConfigurationDocument,
    type ConfigurationDocument,
} from "./configuration-document.js";
import {
    canonicalConfiguration,
    ConfigurationConflictError,
    type ConfigurationBase,
    type ConfigurationRepairReference,
} from "./configuration-store.js";
import {
    observeNamedPersistedOperation,
    type PersistedOperationObserver,
} from "../persisted-operation-observer.js";

export interface ConfigurationSourceSnapshot {
    revision: string;
    document: Record<string, unknown>;
}
export interface ConfigurationApplicationOptions {
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
    phase: "accepted" | "stopping" | "writing" | "starting" | "restoring" | "completed" | "failed";
    recoveryRequired: boolean;
    rolledBack?: boolean;
    sourceState?: "damaged";
    configRevision?: string;
    error?: "CONFIG_APPLY_FAILED" | "CONFIG_RECOVERY_REQUIRED";
}
export interface ConfigurationApplicationJournal extends ConfigurationApplicationOperation {
    mode?: "repair";
    repair?: ConfigurationRepairReference;
    schemaVersion: 1;
    base: ConfigurationBase;
    desired: "running" | "stopped";
    documentDigest: string;
    previousDigest: string;
    candidateRevision?: string;
}
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
                    operation.phase = "failed";
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
    apply(input: ConfigurationApplicationInput): Promise<ConfigurationApplicationOperation> {
        let request: ConfigurationApplicationInput;
        try {
            const snapshot = parseConfigurationDocument(input);
            if (
                !ID.test(String(snapshot.id)) ||
                typeof snapshot.id !== "string" ||
                !ID.test(String(snapshot.validationId)) ||
                typeof snapshot.validationId !== "string" ||
                Object.keys(snapshot).sort().join(",") !==
                    (snapshot.repair === undefined
                        ? "base,document,id,validationId"
                        : "base,document,id,repair,validationId")
            )
                throw invalid();
            checkBase(snapshot.base);
            if (snapshot.repair !== undefined) checkRepair(snapshot.repair, snapshot.base);
            request = {
                id: snapshot.id,
                validationId: snapshot.validationId,
                base: snapshot.base as unknown as ConfigurationBase,
                document: parseConfigurationDocument(snapshot.document),
                ...(snapshot.repair !== undefined
                    ? { repair: snapshot.repair as unknown as ConfigurationRepairReference }
                    : {}),
            };
        } catch {
            return Promise.reject(invalid());
        }
        return this.options.lifecycle.runConfigurationTransaction(async port => {
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
            const operation: ConfigurationApplicationJournal = {
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
                ...(request.repair
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
        operation.phase = "failed";
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
        atomic(this.file(operation.id), JSON.stringify(operation));
        if (operation.status !== "running")
            observeNamedPersistedOperation(
                this.options.onOperation,
                "configuration.apply",
                operation,
            );
    }
    private read(id: string): ConfigurationApplicationJournal {
        try {
            const raw = parseConfigurationDocument(JSON.parse(readFile(this.file(id), 16_384)));
            checkBase(raw.base);
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
function publicOperation(
    value: ConfigurationApplicationJournal,
): ConfigurationApplicationOperation {
    return {
        id: value.id,
        validationId: value.validationId,
        status: value.status,
        phase: value.phase,
        recoveryRequired: value.recoveryRequired,
        ...(value.rolledBack !== undefined ? { rolledBack: value.rolledBack } : {}),
        ...(value.sourceState === "damaged" ? { sourceState: "damaged" as const } : {}),
        ...(value.configRevision !== undefined ? { configRevision: value.configRevision } : {}),
        ...(value.error !== undefined ? { error: value.error } : {}),
    };
}
function checkBase(value: unknown): void {
    const base = parseConfigurationDocument(value);
    if (
        Object.keys(base).sort().join(",") !== "configRevision,generationId" ||
        !(
            base.generationId === null ||
            (typeof base.generationId === "string" && /^[a-f0-9-]{36}$/.test(base.generationId))
        ) ||
        typeof base.configRevision !== "string" ||
        !HASH.test(base.configRevision)
    )
        throw invalid();
}
function bytes(document: unknown): string {
    return canonicalConfiguration(parseConfigurationDocument(document));
}
function digest(content: string | Uint8Array): string {
    return createHash("sha256").update(content).digest("hex");
}
