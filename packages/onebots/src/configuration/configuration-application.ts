import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
} from "./configuration-store.js";

export interface ConfigurationSourceSnapshot {
    revision: string;
    document: Record<string, unknown>;
}
export interface ConfigurationApplicationOptions {
    directory: string;
    source: {
        read(): ConfigurationSourceSnapshot;
        replace(
            expectedRevision: string,
            document: Record<string, unknown>,
        ): ConfigurationSourceSnapshot;
    };
    lifecycle: Pick<GenerationActivationController, "runConfigurationTransaction">;
}
export interface ConfigurationApplicationInput {
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
    configRevision?: string;
    error?: "CONFIG_APPLY_FAILED" | "CONFIG_RECOVERY_REQUIRED";
}
interface Journal extends ConfigurationApplicationOperation {
    schemaVersion: 1;
    base: ConfigurationBase;
    desired: "running" | "stopped";
    documentDigest: string;
    previousDigest: string;
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
                Object.keys(snapshot).sort().join(",") !== "base,document,id,validationId"
            )
                throw invalid();
            checkBase(snapshot.base);
            request = {
                id: snapshot.id,
                validationId: snapshot.validationId,
                base: snapshot.base as unknown as ConfigurationBase,
                document: parseConfigurationDocument(snapshot.document),
            };
        } catch {
            return Promise.reject(invalid());
        }
        return this.options.lifecycle.runConfigurationTransaction(async port => {
            const candidate = bytes(request.document);
            const candidateDigest = digest(candidate);
            if (fs.existsSync(this.file(request.id))) {
                const previous = this.read(request.id);
                if (
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
            let before: ConfigurationSourceSnapshot;
            try {
                before = this.options.source.read();
            } catch {
                throw invalid();
            }
            if (
                port.activeGenerationId() !== request.base.generationId ||
                before.revision !== request.base.configRevision
            )
                throw new ConfigurationConflictError();
            const previousBytes = bytes(before.document);
            const operation: Journal = {
                schemaVersion: 1,
                id: request.id,
                validationId: request.validationId,
                base: { ...request.base },
                desired: port.gatewayStatus().desired,
                documentDigest: candidateDigest,
                previousDigest: digest(previousBytes),
                status: "running",
                phase: "accepted",
                recoveryRequired: false,
            };
            try {
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
        operation: Journal,
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
        operation: Journal,
        port: ConfigurationTransactionPort,
    ): Promise<ConfigurationApplicationOperation> {
        try {
            const current = this.options.source.read();
            const expected = operation.configRevision ?? operation.base.configRevision;
            if (current.revision !== expected) throw invalid();
            operation.phase = "restoring";
            this.save(operation);
            if (operation.configRevision !== undefined) {
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
            if (port.hasLiveChildren()) throw invalid();
            if (operation.desired === "running") {
                const started = await port.start();
                if (started.status !== "succeeded") throw invalid();
            }
            if (
                this.options.source.read().revision !==
                (operation.configRevision ?? operation.base.configRevision)
            )
                throw invalid();
            operation.status = "failed";
            operation.phase = "failed";
            operation.rolledBack = true;
            operation.error = "CONFIG_APPLY_FAILED";
            this.save(operation);
            return publicOperation(operation);
        } catch {
            return this.unknown(operation);
        }
    }

    private unknown(operation: Journal): ConfigurationApplicationOperation {
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
    private save(operation: Journal): void {
        atomic(this.file(operation.id), JSON.stringify(operation));
    }
    private read(id: string): Journal {
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
                (raw.rolledBack !== undefined && typeof raw.rolledBack !== "boolean") ||
                (raw.error !== undefined &&
                    !["CONFIG_APPLY_FAILED", "CONFIG_RECOVERY_REQUIRED"].includes(
                        String(raw.error),
                    ))
            )
                throw invalid();
            const operation = raw as unknown as Journal;
            this.readDocument(operation.documentDigest);
            this.readDocument(operation.previousDigest);
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

function publicOperation(value: Journal): ConfigurationApplicationOperation {
    return {
        id: value.id,
        validationId: value.validationId,
        status: value.status,
        phase: value.phase,
        recoveryRequired: value.recoveryRequired,
        ...(value.rolledBack !== undefined ? { rolledBack: value.rolledBack } : {}),
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
function digest(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}
function privateDirectory(directory: string): void {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())
        throw invalid();
    fs.chmodSync(directory, 0o700);
}
function readFile(file: string, max: number): string {
    const stat = fs.lstatSync(file);
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > max ||
        (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    )
        throw invalid();
    return fs.readFileSync(file, "utf8");
}
function atomic(file: string, content: string): void {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        const descriptor = fs.openSync(temporary, "wx", 0o600);
        try {
            fs.writeFileSync(descriptor, content);
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        fs.renameSync(temporary, file);
        if (process.platform !== "win32") {
            const parent = fs.openSync(path.dirname(file), "r");
            try {
                fs.fsyncSync(parent);
            } finally {
                fs.closeSync(parent);
            }
        }
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}
