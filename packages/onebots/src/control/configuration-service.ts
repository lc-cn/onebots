import path from "node:path";
import {
    ConfigurationStore,
    type ConfigurationBase,
} from "../configuration/configuration-store.js";
import { ConfigurationDrafts } from "../configuration/configuration-drafts.js";
import { ConfigurationWorkspace } from "../configuration/configuration-workspace.js";
import { ConfigurationValidation } from "../configuration/configuration-validation.js";
import { ConfigurationRecoveryStore } from "../configuration/configuration-recovery-store.js";
import { ConfigurationConflictError } from "../configuration/configuration-store.js";
import { ConfigurationFile } from "../configuration/configuration-file.js";
import { readGenerationConfigurationSchema } from "../configuration/configuration-runtime-schema.js";
import {
    recoverConfigurationVerifications,
    verifyConfiguration,
} from "../configuration/configuration-verify.js";
import type { ConfigurationApplication } from "../configuration/configuration-application.js";
import type { ConfigurationChange, SecretChange } from "../configuration/configuration-document.js";
import type { GenerationStore, VerifiedGeneration } from "../installation/generation-store.js";
import type { ConfigurationListChange } from "../configuration/configuration-list.js";

export class ControlConfigurationService {
    private readonly abort = new AbortController();
    private readonly pending = new Set<Promise<unknown>>();
    private closed = false;
    private readonly workspace: ConfigurationWorkspace;
    private readonly source: ConfigurationFile;
    private readonly store: ConfigurationStore;
    private readonly recovery: ConfigurationRecoveryStore;
    private readonly drafts: ConfigurationDrafts;
    private readonly validation: ConfigurationValidation;
    constructor(
        private readonly options: {
            directory: string;
            configFile: string;
            runtimeRoot: string;
            generations: GenerationStore;
            application: ConfigurationApplication;
            activeGeneration(): VerifiedGeneration | null;
        },
    ) {
        const store = (this.store = new ConfigurationStore(path.join(options.directory, "drafts")));
        this.source = new ConfigurationFile(options.configFile);
        this.recovery = new ConfigurationRecoveryStore(path.join(options.directory, "recovery"));
        this.workspace = new ConfigurationWorkspace({
            privateRoot: path.join(options.directory, "schema-workers"),
            source: this.source,
            runtimeRoot: options.runtimeRoot,
            hostEntrypoint: path.resolve(import.meta.dirname, "../../lib/index.js"),
            activeGeneration: options.activeGeneration,
            readSchema: id => readGenerationConfigurationSchema(options.generations, id),
        });
        this.drafts = new ConfigurationDrafts({
            store,
            current: () => this.workspace.current(),
            repairCurrent: base => this.workspace.currentRepair(base),
        });
        this.validation = new ConfigurationValidation({
            directory: path.join(options.directory, "validations"),
            privateRoot: path.join(options.directory, "verification-workers"),
            store,
            application: options.application,
            currentBase: () => this.workspace.base(),
            runtime: draft => this.workspace.runtime(draft),
            verify: input => verifyConfiguration({ ...input, signal: this.abort.signal }),
        });
    }

    sourceState() {
        const source = this.source.inspect();
        return {
            state: source.state,
            base: {
                generationId: this.options.activeGeneration()?.id ?? null,
                configRevision: source.revision,
            },
            ...(source.state === "damaged" ? { reason: source.reason, repairAvailable: true } : {}),
        };
    }
    createRepair(base: ConfigurationBase) {
        return this.run(async () => {
            const state = this.sourceState();
            if (
                state.state !== "damaged" ||
                state.base.configRevision !== base.configRevision ||
                state.base.generationId !== base.generationId
            )
                throw new ConfigurationConflictError();
            const original = this.source.readRaw();
            if (original.revision !== base.configRevision) throw new ConfigurationConflictError();
            const reference = this.recovery.backup(original);
            const context = await this.workspace.refreshRepair(base);
            return { draft: this.drafts.createRepair(base, reference), schemas: context.schemas };
        });
    }
    private async refreshDraft(id: string) {
        const draft = this.store.read(id);
        if (draft.mode === "repair") await this.workspace.refreshRepair(draft.base);
        else await this.workspace.refresh();
    }
    snapshot() {
        return this.run(async () => {
            const context = await this.workspace.refresh();
            return { ...this.drafts.snapshot(), schemas: context.schemas };
        });
    }
    create(base: ConfigurationBase) {
        return this.run(async () => {
            await this.workspace.refresh();
            return this.drafts.create(base);
        });
    }
    readContext(id: string) {
        return this.run(async () => {
            await this.refreshDraft(id);
            const draft = this.store.read(id);
            const context =
                draft.mode === "repair"
                    ? this.workspace.currentRepair(draft.base)
                    : this.workspace.current();
            return { draft: this.drafts.read(id), schemas: context.schemas };
        });
    }
    read(id: string) {
        return this.run(async () => {
            await this.refreshDraft(id);
            return this.drafts.read(id);
        });
    }
    edit(request: {
        id: string;
        expectedRevision: string;
        changes: ConfigurationChange[];
        secrets: SecretChange[];
    }) {
        return this.run(async () => {
            await this.refreshDraft(request.id);
            return this.drafts.edit(request);
        });
    }
    editList(request: ConfigurationListChange & { id: string; expectedRevision: string }) {
        return this.run(async () => {
            await this.refreshDraft(request.id);
            const { id, expectedRevision, ...change } = request;
            return this.drafts.editList(id, expectedRevision, change);
        });
    }
    addAccount(request: {
        id: string;
        expectedRevision: string;
        platform: string;
        accountId: string;
    }) {
        return this.run(async () => {
            await this.refreshDraft(request.id);
            return this.drafts.addAccount(
                request.id,
                request.expectedRevision,
                request.platform,
                request.accountId,
            );
        });
    }
    removeAccount(request: { id: string; expectedRevision: string; accountKey: string }) {
        return this.run(async () => {
            await this.refreshDraft(request.id);
            return this.drafts.removeAccount(
                request.id,
                request.expectedRevision,
                request.accountKey,
            );
        });
    }
    setProtocol(request: {
        id: string;
        expectedRevision: string;
        accountKey: string | null;
        protocol: string;
        enabled: boolean;
    }) {
        return this.run(async () => {
            await this.refreshDraft(request.id);
            return this.drafts.setProtocol(request.id, request);
        });
    }
    validate(request: { id: string; expectedRevision: string }) {
        return this.run(async () => {
            const recovered = await recoverConfigurationVerifications(
                path.join(this.options.directory, "verification-workers"),
            );
            if (recovered.blocked.length) throw new Error("配置校验进程或临时文件归属尚待核实");
            return this.validation.validate(request.id, request.expectedRevision);
        });
    }
    apply(request: { id: string; receiptId: string }) {
        return this.run(() => this.validation.apply(request.id, request.receiptId));
    }
    reconcile(request: { id: string; expectedRevision: string }) {
        return this.run(() =>
            this.options.application.reconcileRestore(request.id, request.expectedRevision),
        );
    }
    operation(id: string) {
        return this.options.application.hasOperation(id)
            ? this.options.application.status(id)
            : undefined;
    }
    async close() {
        this.closed = true;
        this.abort.abort();
        await Promise.allSettled([...this.pending]);
    }
    private run<T>(task: () => Promise<T>): Promise<T> {
        if (this.closed) return Promise.reject(new Error("配置服务正在关闭"));
        const result = task();
        this.pending.add(result);
        void result.then(
            () => this.pending.delete(result),
            () => this.pending.delete(result),
        );
        return result;
    }
}
