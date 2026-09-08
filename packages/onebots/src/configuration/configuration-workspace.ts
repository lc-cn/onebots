import { createHash } from "node:crypto";
import type { VerifiedGeneration } from "../installation/generation-store.js";
import { resolveGenerationRuntime } from "../installation/generation-runtime.js";
import { getConfiguredPluginSelection } from "../runtime-plugin-selection.js";
import {
    ConfigurationConflictError,
    type ConfigurationDraft,
    type ConfigurationBase,
} from "./configuration-store.js";
import type { ConfigurationFile } from "./configuration-file.js";
import type { ConfigurationContext, ConfigurationRepairContext } from "./configuration-drafts.js";
import {
    normalizeConfigurationSchema,
    type ConfigurationSchemaBundle,
    type VerifiedProtocolMetadata,
} from "./configuration-schema.js";
import { inspectConfigurationRuntime } from "./configuration-runtime-inspect.js";

interface CachedSchema {
    generationId: string | null;
    selectionKey: string;
    schemas: ConfigurationSchemaBundle;
}

/** 把当前配置、活动运行版本和可信 Schema 合成客户端唯一上下文。 */
export class ConfigurationWorkspace {
    private cached?: CachedSchema;
    private repairCached?: ConfigurationRepairContext;
    constructor(
        private readonly options: {
            source: ConfigurationFile;
            privateRoot?: string;
            runtimeRoot: string;
            hostEntrypoint: string;
            activeGeneration(): VerifiedGeneration | null;
            readSchema(id: string): ConfigurationSchemaBundle;
            inspect?: typeof inspectConfigurationRuntime;
        },
    ) {}

    base() {
        return {
            generationId: this.options.activeGeneration()?.id ?? null,
            configRevision: this.options.source.inspect().revision,
        };
    }

    async refresh(): Promise<ConfigurationContext> {
        const before = this.options.source.read();
        const generation = this.options.activeGeneration();
        const selection = selected(before.document);
        const selectionKey = JSON.stringify(selection);
        const schemas = generation
            ? this.options.readSchema(generation.id)
            : bundle(
                  (
                      await (this.options.inspect ?? inspectConfigurationRuntime)({
                          privateRoot: this.options.privateRoot,
                          runtimeRoot: this.options.runtimeRoot,
                          hostEntrypoint: this.options.hostEntrypoint,
                          selection,
                      })
                  ).schemas,
              );
        if (
            (this.options.activeGeneration()?.id ?? null) !== (generation?.id ?? null) ||
            this.options.source.read().revision !== before.revision
        )
            throw new ConfigurationConflictError();
        this.cached = { generationId: generation?.id ?? null, selectionKey, schemas };
        return this.current();
    }

    /** 损坏配置只提供当前已验证版本的能力，不尝试从原始字节猜扩展选择。 */
    async refreshRepair(expected: ConfigurationBase): Promise<ConfigurationRepairContext> {
        this.assertRepairBase(expected);
        const generation = this.options.activeGeneration();
        const schemas = generation
            ? this.options.readSchema(generation.id)
            : bundle(
                  (
                      await (this.options.inspect ?? inspectConfigurationRuntime)({
                          privateRoot: this.options.privateRoot,
                          runtimeRoot: this.options.runtimeRoot,
                          hostEntrypoint: this.options.hostEntrypoint,
                          selection: { adapters: [], protocols: [], applications: [] },
                      })
                  ).schemas,
              );
        this.assertRepairBase(expected);
        this.repairCached = { base: structuredClone(expected), schemas };
        return this.currentRepair(expected);
    }

    currentRepair(expected: ConfigurationBase): ConfigurationRepairContext {
        this.assertRepairBase(expected);
        if (
            !this.repairCached ||
            this.repairCached.base.generationId !== expected.generationId ||
            this.repairCached.base.configRevision !== expected.configRevision
        )
            throw new ConfigurationConflictError();
        return structuredClone(this.repairCached);
    }

    private assertRepairBase(expected: ConfigurationBase): void {
        const snapshot = this.options.source.inspect();
        if (
            !expected ||
            snapshot.state !== "damaged" ||
            snapshot.revision !== expected.configRevision ||
            (this.options.activeGeneration()?.id ?? null) !== expected.generationId
        )
            throw new ConfigurationConflictError();
    }

    current(): ConfigurationContext {
        const snapshot = this.options.source.read();
        const generation = this.options.activeGeneration();
        if (
            !this.cached ||
            this.cached.generationId !== (generation?.id ?? null) ||
            this.cached.selectionKey !== JSON.stringify(selected(snapshot.document))
        )
            throw new ConfigurationConflictError();
        return {
            base: { generationId: generation?.id ?? null, configRevision: snapshot.revision },
            document: snapshot.document,
            schemas: structuredClone(this.cached.schemas),
        };
    }

    async runtime(draft: ConfigurationDraft) {
        const generation = this.options.activeGeneration();
        if ((generation?.id ?? null) !== draft.base.generationId)
            throw new ConfigurationConflictError();
        const selection = selected(draft.document);
        if (generation) {
            const runtime = resolveGenerationRuntime(generation, selection);
            // 读取时再次核验 Schema 收据；不能复用一份已变化的表单映射。
            this.options.readSchema(generation.id);
            return {
                runtimeRoot: runtime.runtimeRoot,
                selection: runtime.selection,
                fingerprint: createHash("sha256")
                    .update(
                        JSON.stringify([
                            generation.id,
                            generation.planDigest,
                            generation.receipt.schemasDigest,
                        ]),
                    )
                    .digest("hex"),
            };
        }
        const inspected = await (this.options.inspect ?? inspectConfigurationRuntime)({
            runtimeRoot: this.options.runtimeRoot,
            hostEntrypoint: this.options.hostEntrypoint,
            selection,
        });
        if (this.options.activeGeneration() !== null) throw new ConfigurationConflictError();
        return {
            runtimeRoot: this.options.runtimeRoot,
            hostEntrypoint: this.options.hostEntrypoint,
            selection,
            fingerprint: inspected.fingerprint,
        };
    }
}

function selected(document: Record<string, unknown>) {
    const selection = getConfiguredPluginSelection(document, true);
    return {
        adapters: selection?.adapters ?? [],
        protocols: selection?.protocols ?? [],
        applications: selection?.applications ?? [],
    };
}

function bundle(schemas: Record<string, unknown>): ConfigurationSchemaBundle {
    if (!Array.isArray(schemas.protocolMetadata)) throw new Error("运行时缺少可信配置映射");
    return normalizeConfigurationSchema({
        schemas,
        protocols: schemas.protocolMetadata as VerifiedProtocolMetadata[],
    });
}
