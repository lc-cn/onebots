import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
    verifyConfiguration,
    type ConfigurationVerificationInput,
} from "./configuration-verify.js";
import { parseConfigurationDocument } from "./configuration-document.js";
import {
    canonicalConfiguration,
    parseConfigurationRepairReference,
    type ConfigurationRepairReference,
    ConfigurationConflictError,
    type ConfigurationBase,
    type ConfigurationDraft,
    type ConfigurationStore,
} from "./configuration-store.js";
import type {
    ConfigurationApplication,
    ConfigurationApplicationOperation,
} from "./configuration-application.js";

export interface ConfigurationRuntimeContext {
    runtimeRoot: string;
    hostEntrypoint?: string;
    selection: ConfigurationVerificationInput["selection"];
    fingerprint: string;
}
export interface ConfigurationValidationOptions {
    directory: string;
    privateRoot: string;
    store: ConfigurationStore;
    application: ConfigurationApplication;
    currentBase(): ConfigurationBase;
    runtime(draft: ConfigurationDraft): Promise<ConfigurationRuntimeContext>;
    /** 仅可信构造器可注入，绝不由 HTTP 请求提供。 */
    verify?: typeof verifyConfiguration;
}
export interface ConfigurationValidationResult {
    valid: boolean;
    issues: Array<{ path: string[]; message: string }>;
    receiptId?: string;
    draftRevision: string;
}
interface Receipt {
    mode?: "repair";
    repair?: ConfigurationRepairReference;
    schemaVersion: 1;
    id: string;
    draftId: string;
    draftRevision: string;
    base: ConfigurationBase;
    runtimeFingerprint: string;
    documentDigest: string;
}
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const failure = () => new Error("配置校验回执不可用，请重新校验草稿");

/** 回执只引用私有草稿，不含配置值。apply 是管理客户端唯一的配置应用入口。 */
export class ConfigurationValidation {
    private readonly directory: string;
    constructor(private readonly options: ConfigurationValidationOptions) {
        this.directory = path.resolve(options.directory);
        fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        const stat = fs.lstatSync(this.directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || !path.isAbsolute(options.privateRoot))
            throw failure();
        fs.chmodSync(this.directory, 0o700);
    }

    async validate(id: string, expectedRevision: string): Promise<ConfigurationValidationResult> {
        try {
            if (typeof expectedRevision !== "string" || !HASH.test(expectedRevision))
                throw failure();
            const draft = this.options.store.read(id);
            if (draft.revision !== expectedRevision) throw new ConfigurationConflictError();
            this.assertBase(draft.base);
            const context = await this.context(draft);
            const result = await (this.options.verify ?? verifyConfiguration)({
                runtimeRoot: context.runtimeRoot,
                hostEntrypoint: context.hostEntrypoint,
                selection: context.selection,
                privateRoot: this.options.privateRoot,
                document: parseConfigurationDocument(draft.document),
            });
            if (result.valid !== true)
                return {
                    valid: false,
                    draftRevision: draft.revision,
                    issues: result.issues.slice(0, 100).map(issue => ({
                        path:
                            Array.isArray(issue.path) &&
                            issue.path.length <= 64 &&
                            issue.path.every(part => typeof part === "string" && part.length <= 256)
                                ? [...issue.path]
                                : [],
                        message: "配置字段无效",
                    })),
                };
            const current = this.assertDraft(draft);
            const rechecked = await this.context(current);
            if (rechecked.fingerprint !== context.fingerprint)
                throw new ConfigurationConflictError();
            this.assertDraft(draft);
            const receipt: Receipt = {
                schemaVersion: 1,
                id: randomUUID(),
                draftId: draft.id,
                draftRevision: draft.revision,
                base: { ...draft.base },
                runtimeFingerprint: context.fingerprint,
                documentDigest: documentDigest(draft.document),
                ...(draft.mode === "repair"
                    ? { mode: "repair" as const, repair: { ...draft.repair! } }
                    : {}),
            };
            this.write(receipt);
            return {
                valid: true,
                issues: [],
                receiptId: receipt.id,
                draftRevision: draft.revision,
            };
        } catch (error) {
            if (error instanceof ConfigurationConflictError) throw error;
            throw failure();
        }
    }

    async apply(
        operationId: string,
        receiptId: string,
    ): Promise<ConfigurationApplicationOperation> {
        try {
            const receipt = this.read(receiptId);
            // 已执行的同一操作是只读查询；不能因应用后base变化而重新执行。
            if (this.options.application.hasOperation(operationId)) {
                const operation = this.options.application.status(operationId);
                if (operation.validationId !== receiptId) throw new ConfigurationConflictError();
                return operation;
            }
            const draft = this.options.store.read(receipt.draftId);
            if (
                draft.revision !== receipt.draftRevision ||
                !sameBase(draft.base, receipt.base) ||
                !sameMode(draft, receipt) ||
                documentDigest(draft.document) !== receipt.documentDigest
            )
                throw new ConfigurationConflictError();
            this.assertBase(receipt.base);
            const context = await this.context(draft);
            if (context.fingerprint !== receipt.runtimeFingerprint)
                throw new ConfigurationConflictError();
            this.assertDraft(draft);
            return await this.options.application.apply({
                id: operationId,
                validationId: receiptId,
                base: { ...receipt.base },
                document: parseConfigurationDocument(draft.document),
                ...(receipt.mode === "repair" ? { repair: { ...receipt.repair! } } : {}),
            });
        } catch (error) {
            if (error instanceof ConfigurationConflictError) throw error;
            throw failure();
        }
    }

    private assertBase(base: ConfigurationBase): void {
        if (!sameBase(base, this.options.currentBase())) throw new ConfigurationConflictError();
    }
    private assertDraft(expected: ConfigurationDraft): ConfigurationDraft {
        const current = this.options.store.read(expected.id);
        if (
            current.revision !== expected.revision ||
            !sameBase(current.base, expected.base) ||
            !sameMode(current, expected) ||
            documentDigest(current.document) !== documentDigest(expected.document)
        )
            throw new ConfigurationConflictError();
        this.assertBase(expected.base);
        return current;
    }
    private async context(draft: ConfigurationDraft): Promise<ConfigurationRuntimeContext> {
        const value = await this.options.runtime(structuredClone(draft));
        if (
            typeof value.fingerprint !== "string" ||
            !HASH.test(value.fingerprint) ||
            typeof value.runtimeRoot !== "string" ||
            !path.isAbsolute(value.runtimeRoot) ||
            (value.hostEntrypoint !== undefined &&
                (typeof value.hostEntrypoint !== "string" ||
                    !path.isAbsolute(value.hostEntrypoint)))
        )
            throw failure();
        const selection = parseConfigurationDocument({ selection: value.selection }).selection;
        return {
            runtimeRoot: value.runtimeRoot,
            hostEntrypoint: value.hostEntrypoint,
            fingerprint: value.fingerprint,
            selection: selection as unknown as ConfigurationVerificationInput["selection"],
        };
    }
    private file(id: string): string {
        if (typeof id !== "string" || !UUID.test(id)) throw failure();
        return path.join(this.directory, `${id}.json`);
    }
    private read(id: string): Receipt {
        const file = this.file(id);
        const stat = fs.lstatSync(file);
        if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.nlink !== 1 ||
            stat.size > 16_384 ||
            (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
        )
            throw failure();
        const raw = parseConfigurationDocument(JSON.parse(fs.readFileSync(file, "utf8")));
        if (
            Object.keys(raw).sort().join(",") !==
                (raw.mode === "repair"
                    ? "base,documentDigest,draftId,draftRevision,id,mode,repair,runtimeFingerprint,schemaVersion"
                    : "base,documentDigest,draftId,draftRevision,id,runtimeFingerprint,schemaVersion") ||
            raw.schemaVersion !== 1 ||
            raw.id !== id ||
            typeof raw.draftId !== "string" ||
            !UUID.test(raw.draftId) ||
            ![raw.draftRevision, raw.runtimeFingerprint, raw.documentDigest].every(
                value => typeof value === "string" && HASH.test(value),
            )
        )
            throw failure();
        const base = parseConfigurationDocument(raw.base);
        if (
            Object.keys(base).sort().join(",") !== "configRevision,generationId" ||
            !(
                base.generationId === null ||
                (typeof base.generationId === "string" && UUID.test(base.generationId))
            ) ||
            typeof base.configRevision !== "string" ||
            !HASH.test(base.configRevision)
        )
            throw failure();
        if (raw.mode === "repair")
            parseConfigurationRepairReference(raw.repair, base as unknown as ConfigurationBase);
        return raw as unknown as Receipt;
    }
    private write(receipt: Receipt): void {
        const file = this.file(receipt.id);
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
            const descriptor = fs.openSync(temporary, "wx", 0o600);
            try {
                fs.writeFileSync(descriptor, JSON.stringify(receipt));
                fs.fsyncSync(descriptor);
            } finally {
                fs.closeSync(descriptor);
            }
            fs.renameSync(temporary, file);
            if (process.platform !== "win32") {
                const parent = fs.openSync(this.directory, "r");
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
}
function sameBase(a: ConfigurationBase, b: ConfigurationBase): boolean {
    return a.generationId === b.generationId && a.configRevision === b.configRevision;
}
function documentDigest(document: Record<string, unknown>): string {
    return createHash("sha256").update(canonicalConfiguration(document)).digest("hex");
}

function sameMode(
    a: Pick<Receipt, "mode" | "repair">,
    b: Pick<Receipt, "mode" | "repair">,
): boolean {
    return (
        a.mode === b.mode &&
        a.repair?.backupId === b.repair?.backupId &&
        a.repair?.originalRevision === b.repair?.originalRevision
    );
}
