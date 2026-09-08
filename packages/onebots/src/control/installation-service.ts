import { activeInstallationResolver } from "./installation-active-resolver.js";
import { ConfigurationConflictError } from "../configuration/configuration-store.js";
import {
    prepareInstallationUpdate,
    type UpdateBase,
    type UpdateConfirmation,
} from "./installation-update.js";
import type { ResolvedRelease } from "../installation/release-resolver.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { GenerationInstaller } from "../installation/generation-installer.js";
import { verifyGeneration } from "../installation/generation-verify.js";
import { freezeGenerationArtifacts } from "../installation/generation-artifacts.js";
import { bundledRuntimeArtifacts, bundledPnpmExecutor } from "../installation/bundled-runtime-artifacts.js";
import {
    createGenerationPlan,
    type GenerationPlan,
    type GenerationSelection,
} from "../installation/generation-plan.js";
import {
    resolveGenerationPlan,
    type GenerationResolverConfig,
} from "../installation/generation-resolver.js";
import type { GenerationStore } from "../installation/generation-store.js";
import {
    GenerationConflictError,
    type GenerationActivationController,
} from "./generation-activation.js";
import { TRUSTED_EXTENSION_CATALOG } from "../trusted-extension-catalog.js";
import { getExtensionPackageCatalogEntry } from "../extension-capability-catalog.js";
import { listFrameworkProfiles } from "../framework-integration.js";

const BUILTIN_APPLICATIONS = listFrameworkProfiles()
    .filter(profile => String(profile.applicationStage) !== "planned")
    .map(profile => Object.freeze({ name: profile.id, displayName: profile.displayName }));

export interface ControlInstallationCatalog {
    activeGenerationId: string | null;
    selection: GenerationSelection;
    adapters: Array<{ name: string; displayName: string; version: string }>;
    protocols: Array<{ name: string; displayName: string; version: string }>;
    applications: Array<{ name: string; displayName: string }>;
}

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
    resolveRelease?(): Promise<ResolvedRelease>;
}

/** CLI/TUI/Web 共用的安装应用服务；HTTP 层仅认证、解析和传送结果。 */
export class ControlInstallationService {
    private readonly plans: string;
    private readonly installer: GenerationInstaller;
    private readonly resolver: GenerationResolverConfig;
    private readonly cancellations = new Map<string, AbortController>();
    private closed = false;

    constructor(private readonly options: ControlInstallationOptions) {
        this.plans = path.join(options.directory, "plans");
        fs.mkdirSync(this.plans, { recursive: true, mode: 0o700 });
        if (fs.lstatSync(this.plans).isSymbolicLink())
            throw new Error("安装计划目录不能是符号链接");
        fs.chmodSync(this.plans, 0o700);
        this.resolver = options.resolver ?? bundledRuntimeArtifacts();
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
            ...executor,
        });
    }

    /** 只读宿主目录，不依赖账号配置或下载扩展的执行结果。 */
    catalog(): ControlInstallationCatalog {
        const activeGenerationId = this.options.currentGenerationId?.() ?? null;
        const resolver = activeInstallationResolver(
            this.options.store,
            activeGenerationId,
            this.resolver,
        );
        const entries = (type: "adapter" | "protocol") =>
            TRUSTED_EXTENSION_CATALOG.filter(entry => entry.type === type).flatMap(entry => {
                const version = resolver.extensionVersions
                    ? resolver.extensionVersions[entry.packageName]
                    : getExtensionPackageCatalogEntry(entry.packageName)?.packageVersion;
                return version
                    ? [{ name: entry.name, displayName: entry.displayName, version }]
                    : [];
            });
        return {
            activeGenerationId,
            selection: structuredClone(
                this.options.currentSelection?.() ?? {
                    adapters: [],
                    protocols: [],
                    applications: [],
                },
            ),
            adapters: entries("adapter"),
            protocols: entries("protocol"),
            applications: BUILTIN_APPLICATIONS.map(application => ({ ...application })),
        };
    }

    async plan(selection: GenerationSelection, expectedGenerationId: string | null) {
        if (this.closed) throw new Error("安装服务正在关闭");
        this.assertBase(expectedGenerationId);
        const resolver = await freezeGenerationArtifacts(
            activeInstallationResolver(this.options.store, expectedGenerationId, this.resolver),
            path.join(this.options.directory, "artifacts"),
        );
        const { plan, recommendations } = await resolveGenerationPlan(selection, resolver);
        if (this.closed) throw new Error("安装服务正在关闭");
        this.assertBase(expectedGenerationId);
        return this.confirmPlan(plan, expectedGenerationId, recommendations);
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
                      installationPlan: this.confirmPlan(
                          plan,
                          expected.generationId,
                          result.recommendations,
                          update,
                      ),
                  }
                : {}),
        };
    }

    private confirmPlan(
        plan: GenerationPlan,
        expectedGenerationId: string | null,
        recommendations: string[],
        update?: UpdateConfirmation,
    ) {
        const confirmation = {
            schemaVersion: 1 as const,
            baseGenerationId: expectedGenerationId,
            plan,
            ...(update ? { update } : {}),
        };
        const id = digest(confirmation);
        const file = this.planFile(id);
        if (!fs.existsSync(file)) atomicWrite(file, confirmation);
        else this.readPlan(id);
        return {
            id,
            planDigest: plan.digest,
            baseGenerationId: expectedGenerationId,
            selection: plan.selection,
            packages: [
                plan.host,
                plan.core,
                ...plan.extensions.map(extension => ({
                    name: extension.packageName,
                    version: extension.version,
                })),
            ].map(artifact => ({ name: artifact.name, version: artifact.version })),
            peers: plan.peerRequirements,
            recommendations,
        };
    }

    install(request: { id: string; planId: string; token?: string }, allowCredentials: boolean) {
        if (this.closed) throw new Error("安装服务正在关闭");
        if (
            request.token !== undefined &&
            (typeof request.token !== "string" || request.token.length > 512 || !allowCredentials)
        )
            throw new Error("私有仓库授权仅接受本地控制连接或受保护的传输");
        const confirmation = this.readPlan(request.planId);
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
        const confirmation = this.readPlan(binding.planId);
        return confirmation.update
            ? this.options.lifecycle.activate(
                  id,
                  binding.baseGenerationId,
                  confirmation.update.configRevision,
              )
            : this.options.lifecycle.activate(id, binding.baseGenerationId);
    }

    async close(): Promise<void> {
        this.closed = true;
        for (const cancellation of this.cancellations.values()) cancellation.abort();
        await this.installer.close();
    }

    private planFile(id: string): string {
        if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
            throw new Error("安装计划标识无效");
        return path.join(this.plans, `${id}.json`);
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
        const confirmation = this.readPlan(binding.planId);
        if (
            binding.planDigest !== confirmation.plan.digest ||
            binding.baseGenerationId !== confirmation.baseGenerationId
        )
            throw new Error("安装绑定无效");
        return binding;
    }

    private readPlan(id: string): {
        schemaVersion: 1;
        baseGenerationId: string | null;
        plan: GenerationPlan;
        update?: UpdateConfirmation;
    } {
        const file = this.planFile(id);
        try {
            const input = readPrivate(file) as {
                schemaVersion: 1;
                baseGenerationId: string | null;
                plan: GenerationPlan;
                update?: UpdateConfirmation;
            };
            const plan = createGenerationPlan({ ...input.plan, target: input.plan });
            if (
                input.schemaVersion !== 1 ||
                (input.update !== undefined &&
                    (!input.update ||
                        Object.keys(input.update).sort().join(",") !==
                            "archiveSha256,configRevision" ||
                        !/^[a-f0-9]{64}$/.test(input.update.configRevision) ||
                        !/^[a-f0-9]{64}$/.test(input.update.archiveSha256))) ||
                !(input.baseGenerationId === null || typeof input.baseGenerationId === "string") ||
                digest(input) !== id ||
                JSON.stringify(plan) !== JSON.stringify(input.plan)
            )
                throw new Error("安装计划已变化");
            return input;
        } catch {
            // JSON/文件系统异常可能携带磁盘内容和路径，不向控制客户端转发。
            throw new Error("安装计划不可读取或已变化，请重新确认");
        }
    }
}


function digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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
