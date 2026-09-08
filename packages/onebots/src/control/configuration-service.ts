import path from "node:path";
import {
    ConfigurationStore,
    type ConfigurationBase,
} from "../configuration/configuration-store.js";
import { ConfigurationDrafts } from "../configuration/configuration-drafts.js";
import { ConfigurationWorkspace } from "../configuration/configuration-workspace.js";
import { ConfigurationValidation } from "../configuration/configuration-validation.js";
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
        const store = new ConfigurationStore(path.join(options.directory, "drafts"));
        this.workspace = new ConfigurationWorkspace({
            source: new ConfigurationFile(options.configFile),
            runtimeRoot: options.runtimeRoot,
            hostEntrypoint: path.resolve(import.meta.dirname, "../../lib/index.js"),
            activeGeneration: options.activeGeneration,
            readSchema: id => readGenerationConfigurationSchema(options.generations, id),
        });
        this.drafts = new ConfigurationDrafts({ store, current: () => this.workspace.current() });
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
    read(id: string) {
        return this.run(async () => {
            await this.workspace.refresh();
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
            await this.workspace.refresh();
            return this.drafts.edit(request);
        });
    }
    editList(request: ConfigurationListChange & { id: string; expectedRevision: string }) {
        return this.run(async () => {
            await this.workspace.refresh();
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
            await this.workspace.refresh();
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
            await this.workspace.refresh();
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
            await this.workspace.refresh();
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
