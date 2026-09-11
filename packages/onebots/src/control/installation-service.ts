import { ConfigurationConflictError } from "../configuration/configuration-store.js";
import { activeInstallationResolver } from "./installation-active-resolver.js";
import { prepareInstallationUpdate, type UpdateBase } from "./installation-update.js";
import type { ResolvedRelease } from "../installation/release-resolver.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GenerationInstaller } from "../installation/generation-installer.js";
import { verifyGeneration } from "../installation/generation-verify.js";
import { freezeGenerationArtifacts } from "../installation/generation-artifacts.js";
import {
    bundledRuntimeArtifacts,
    bundledPnpmExecutor,
} from "../installation/bundled-runtime-artifacts.js";
import type { GenerationSelection } from "../installation/generation-plan.js";
import {
    resolveGenerationPlan,
    type GenerationResolverConfig,
} from "../installation/generation-resolver.js";
import type { GenerationStore } from "../installation/generation-store.js";
import {
    GenerationConflictError,
    type GenerationActivationController,
} from "./generation-activation.js";
import type { ControlInstallationCatalog } from "@onebots/core/control";
import type { PersistedOperationObserver } from "../persisted-operation-observer.js";
import {
    assertExtensionsNotReferenced,
    hasExtensionRemoval,
    removedExtensions,
    type ExtensionRemovalConfirmation,
} from "./extension-removal.js";
import { ControlInstallationPlanStore } from "./installation-plan-store.js";
import { ControlInstallationCatalogReader } from "./installation-catalog.js";

export interface ControlInstallationOptions {
    directory: string;
    store: GenerationStore;
    lifecycle: Pick<GenerationActivationController, "activate">;
    /** 只由管理服务启动配置提供；不从用户请求读取宿主工件或下载入口。 */
    resolver?: GenerationResolverConfig;
    pnpmExecutable?: string;
    pnpmScript?: string;
    currentGenerationId?(): string | null;
    currentSelection?(): GenerationSelection;
    currentConfigurationRevision?(): string;
    currentConfiguration?(): { revision: string; document: Record<string, unknown> };
    resolveRelease?(): Promise<ResolvedRelease>;
    onOperation?: PersistedOperationObserver;
}

/** CLI/TUI/Web 共用的安装应用服务；HTTP 层仅认证、解析和传送结果。 */
export class ControlInstallationService {
    private readonly plans: ControlInstallationPlanStore;
    private readonly installer: GenerationInstaller;
    private readonly resolver: GenerationResolverConfig;
    private readonly catalogReader: ControlInstallationCatalogReader;
    private readonly cancellations = new Map<string, AbortController>();
    private closed = false;

    constructor(private readonly options: ControlInstallationOptions) {
        this.plans = new ControlInstallationPlanStore(options.directory);
        this.resolver = options.resolver ?? bundledRuntimeArtifacts();
        this.catalogReader = new ControlInstallationCatalogReader({
            store: options.store,
            resolver: this.resolver,
            currentGenerationId: options.currentGenerationId,
            currentSelection: options.currentSelection,
        });
        const executor =
            options.pnpmExecutable || options.pnpmScript
                ? {
                      pnpmExecutable: options.pnpmExecutable,
                      pnpmScript: options.pnpmScript,
                  }
                : bundledPnpmExecutor();
        this.installer = new GenerationInstaller({
            operationsDirectory: path.join(options.directory, "installations"),
            store: options.store,
            verify: verifyGeneration,
            onOperation: options.onOperation,
            ...executor,
        });
    }

    /** 只读宿主目录，不依赖账号配置或下载扩展的执行结果。 */
    catalog(): ControlInstallationCatalog {
        return this.catalogReader.catalog();
    }

    async plan(selection: GenerationSelection, expectedGenerationId: string | null) {
        return this.planSelection(selection, expectedGenerationId);
    }

    private async planSelection(
        selection: GenerationSelection,
        expectedGenerationId: string | null,
    ) {
        if (this.closed) throw new Error("安装服务正在关闭");
        this.assertBase(expectedGenerationId);
        selection = normalizeSelection(selection);
        const removal = removedExtensions(this.currentSelection(), selection);
        let removalConfirmation: ExtensionRemovalConfirmation | undefined;
        if (hasExtensionRemoval(removal)) {
            const snapshot = this.options.currentConfiguration?.();
            if (!snapshot || !/^[a-f0-9]{64}$/.test(snapshot.revision))
                throw new Error("当前配置引用无法确认，拒绝生成扩展移除计划");
            assertExtensionsNotReferenced(removal, snapshot.document);
            removalConfirmation = { selection: removal, configRevision: snapshot.revision };
        }
        const resolver = await freezeGenerationArtifacts(
            activeInstallationResolver(this.options.store, expectedGenerationId, this.resolver),
            path.join(this.options.directory, "artifacts"),
        );
        const { plan, recommendations } = await resolveGenerationPlan(selection, resolver);
        if (this.closed) throw new Error("安装服务正在关闭");
        this.assertBase(expectedGenerationId);
        if (removalConfirmation) this.assertConfiguration(removalConfirmation.configRevision);
        return this.plans.confirm(
            plan,
            expectedGenerationId,
            recommendations,
            undefined,
            removalConfirmation,
        );
    }

    async planUpdate(expected: UpdateBase) {
        expected = { ...expected };
        const assertCurrent = () => {
            if (this.closed) throw new Error("安装服务正在关闭");
            this.assertBase(expected.generationId);
            this.assertConfiguration(expected.configRevision);
        };
        const result = await prepareInstallationUpdate({
            expected: { ...expected },
            store: this.options.store,
            resolver: this.resolver,
            artifactsDirectory: path.join(this.options.directory, "artifacts"),
            currentSelection: this.options.currentSelection,
            resolveRelease: this.options.resolveRelease,
            assertCurrent,
        });
        assertCurrent();
        const { plan, update, ...preview } = result;
        return {
            ...preview,
            ...(result.state === "updates_available"
                ? {
                      installationPlan: this.plans.confirm(
                          plan,
                          expected.generationId,
                          result.recommendations,
                          update,
                      ),
                  }
                : {}),
        };
    }

    install(request: { id: string; planId: string; token?: string }, allowCredentials: boolean) {
        if (this.closed) throw new Error("安装服务正在关闭");
        if (
            request.token !== undefined &&
            (typeof request.token !== "string" || request.token.length > 512 || !allowCredentials)
        )
            throw new Error("私有仓库授权仅接受本地控制连接或受保护的传输");
        const confirmation = this.plans.read(request.planId);
        const plan = confirmation.plan;
        const bindingFile = this.bindingFile(request.id);
        if (fs.existsSync(bindingFile)) {
            const binding = this.readBinding(request.id);
            if (binding.planId !== request.planId) throw new Error("操作标识已绑定其他计划");
            // A durable binding may precede an interrupted initial dispatch. Existing
            // operations remain read-only retries; corruption must never trigger a dispatch.
            if (
                fs.existsSync(
                    path.join(this.options.directory, "installations", `${request.id}.json`),
                )
            ) {
                const operation = this.installer.status(request.id);
                if (operation.planDigest !== binding.planDigest)
                    throw new Error("安装操作绑定无效");
                return operation;
            }
            throw new Error("安装操作已绑定但记录缺失，必须先对账，禁止重新派发");
        }
        this.assertBase(confirmation.baseGenerationId);
        if (confirmation.update) this.assertConfiguration(confirmation.update.configRevision);
        if (confirmation.removal) {
            this.assertConfiguration(confirmation.removal.configRevision);
            const actual = removedExtensions(this.currentSelection(), plan.selection);
            if (!sameSelection(actual, confirmation.removal.selection))
                throw new Error("扩展移除计划与活动运行版本不一致，请重新确认");
        }
        atomicWrite(bindingFile, {
            planId: request.planId,
            planDigest: plan.digest,
            baseGenerationId: confirmation.baseGenerationId,
        });
        const cancellation = this.cancellations.get(request.id) ?? new AbortController();
        const pending = this.installer.install(request.id, plan, {
            token: request.token,
            signal: cancellation.signal,
        });
        this.cancellations.set(request.id, cancellation);
        void pending.then(
            () => this.cancellations.delete(request.id),
            () => {
                this.cancellations.delete(request.id);
                process.stderr.write("[onebots] 安装操作无法持久化，必须检查本地工作区\n");
            },
        );
        return this.installer.status(request.id);
    }

    status(id: string) {
        return this.installer.status(id);
    }

    cancel(id: string) {
        const status = this.installer.status(id);
        this.cancellations.get(id)?.abort();
        return status;
    }

    activate(id: string) {
        if (this.closed) throw new Error("安装服务正在关闭");
        const verified = this.options.store.readVerified(id);
        const binding = this.readBinding(verified.operationId);
        const operation = this.installer.status(verified.operationId);
        if (
            operation.phase !== "verified" ||
            operation.candidateId !== id ||
            binding.planDigest !== verified.planDigest
        )
            throw new Error("候选安装绑定无效");
        const confirmation = this.plans.read(binding.planId);
        const configRevision =
            confirmation.update?.configRevision ?? confirmation.removal?.configRevision;
        return configRevision
            ? this.options.lifecycle.activate(id, binding.baseGenerationId, configRevision)
            : this.options.lifecycle.activate(id, binding.baseGenerationId);
    }

    async close(): Promise<void> {
        this.closed = true;
        for (const cancellation of this.cancellations.values()) cancellation.abort();
        await this.installer.close();
    }

    private assertBase(expected: string | null): void {
        if (expected !== (this.options.currentGenerationId?.() ?? null))
            throw new GenerationConflictError();
    }

    private assertConfiguration(expected: string): void {
        if (
            typeof expected !== "string" ||
            !/^[a-f0-9]{64}$/.test(expected) ||
            this.options.currentConfigurationRevision?.() !== expected
        )
            throw new ConfigurationConflictError();
    }

    private currentSelection(): GenerationSelection {
        const selection = this.options.currentSelection?.();
        if (!selection) return { adapters: [], protocols: [], applications: [] };
        return normalizeSelection(selection);
    }

    private bindingFile(id: string): string {
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("安装操作标识无效");
        const directory = path.join(this.options.directory, "installation-bindings");
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        if (fs.lstatSync(directory).isSymbolicLink()) throw new Error("安装绑定目录无效");
        fs.chmodSync(directory, 0o700);
        return path.join(directory, `${id}.json`);
    }

    private readBinding(id: string): {
        planId: string;
        planDigest: string;
        baseGenerationId: string | null;
    } {
        const binding = readPrivate(this.bindingFile(id)) as {
            planId: string;
            planDigest: string;
            baseGenerationId: string | null;
        };
        const confirmation = this.plans.read(binding.planId);
        if (
            binding.planDigest !== confirmation.plan.digest ||
            binding.baseGenerationId !== confirmation.baseGenerationId
        )
            throw new Error("安装绑定无效");
        return binding;
    }
}

function normalizeSelection(selection: GenerationSelection): GenerationSelection {
    const normalized = {} as GenerationSelection;
    for (const type of ["adapters", "protocols", "applications"] as const) {
        const values = selection[type];
        if (
            !Array.isArray(values) ||
            values.length > 100 ||
            values.some(value => typeof value !== "string" || !value || value.length > 128) ||
            new Set(values).size !== values.length
        )
            throw new Error("扩展选择无效");
        normalized[type] = [...values];
    }
    return normalized;
}

function sameSelection(left: GenerationSelection, right: GenerationSelection): boolean {
    return (["adapters", "protocols", "applications"] as const).every(
        type =>
            left[type].length === right[type].length &&
            left[type].every(name => right[type].includes(name)),
    );
}

function readPrivate(file: string): unknown {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024)
        throw new Error("安装记录无效");
    return JSON.parse(fs.readFileSync(file, "utf8"));
}
function atomicWrite(file: string, value: unknown): void {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        const descriptor = fs.openSync(temporary, "wx", 0o600);
        try {
            fs.writeFileSync(descriptor, JSON.stringify(value) + "\n");
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
