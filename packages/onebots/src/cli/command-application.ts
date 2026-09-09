/** OneBots CLI 命令背后的无路由 application module。 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { RuntimeOptions } from "./command-options.js";
import {
    getRuntimePluginSelection,
    getConfiguredPluginSelection,
} from "../runtime-plugin-selection.js";
import { formatRuntimeConfigDiagnostic, parseRuntimeConfig } from "../runtime-config-validator.js";
import { getLoadedPlugins, type LoadedPluginInfo } from "../plugin-loader.js";
import {
    buildAdapterCapabilityReport,
    createAdapterCapabilityEvidenceDigest,
    formatAdapterCapabilityReport,
    type AdapterCapabilityEvidenceReport,
    type AdapterCapabilitySelectionSource,
} from "../capability-report.js";
import {
    getInstallableAdapterNames,
    validateExtensionCatalogIntegrity,
} from "../extension-catalog-integrity.js";
import packageMetadata from "../../package.json" with { type: "json" };

/** 路由组件可渲染的稳定命令结果。 */
export interface CommandResult {
    output?: string;
    exitCode?: number;
    raw?: boolean;
}

/** 带进程退出码的用户可操作 CLI 错误。 */
export class CliError extends Error {
    constructor(
        message: string,
        public readonly exitCode = 1,
    ) {
        super(message);
    }
}

/** 将公开 CLI 参数转换为 runtime module 所需的绝对路径与插件列表。 */
export function normalizeRuntimeOptions(options: RuntimeOptions) {
    return {
        configPath: path.resolve(options.config ?? "config.yaml"),
        adapters: [...new Set(options.register)],
        protocols: [...new Set(options.protocol)],
        applications: [...new Set(options.target ?? [])],
    };
}

/** 显式 CLI 参数按类别优先；缺省类别复用活动配置中的插件选择。 */
export function resolveConfiguredRuntimeOptions(options: RuntimeOptions) {
    const runtime = normalizeRuntimeOptions(options);
    if (!fs.existsSync(runtime.configPath)) return runtime;
    const configured = getConfiguredPluginSelection(
        parseRuntimeConfig(fs.readFileSync(runtime.configPath, "utf8")),
    );
    if (!configured) return runtime;
    return {
        ...runtime,
        adapters: runtime.adapters.length ? runtime.adapters : configured.adapters,
        protocols: runtime.protocols.length ? runtime.protocols : configured.protocols,
        applications: runtime.applications.length
            ? runtime.applications
            : (configured.applications ?? []),
    };
}

interface CapabilityCommandDependencies {
    loadPlugins(adapters: string[], protocols: string[]): Promise<string[]>;
    getLoadedPlugins(): LoadedPluginInfo[];
    catalogIssues?(): string[];
    catalogPlatforms?(): string[];
}

/** 无连接加载适配器入口，并导出实际安装包注册的默认能力契约。 */
export async function showCapabilities(
    options: RuntimeOptions & { json: boolean },
    dependencies?: CapabilityCommandDependencies,
): Promise<CommandResult> {
    const explicitRuntime = normalizeRuntimeOptions(options);
    let runtime: ReturnType<typeof normalizeRuntimeOptions>;
    let runtimeConfigError: string | null = null;
    try {
        runtime = resolveConfiguredRuntimeOptions(options);
    } catch (error) {
        runtime = normalizeRuntimeOptions(options);
        runtimeConfigError = formatRuntimeConfigDiagnostic(error);
    }
    const resolved =
        dependencies ??
        ({
            loadPlugins: async (adapters: string[], protocols: string[]) => {
                const { loadPlugins } = await import("../runtime-plugins.js");
                return loadPlugins(adapters, protocols);
            },
            getLoadedPlugins,
        } satisfies CapabilityCommandDependencies);
    const failures = await resolved.loadPlugins(runtime.adapters, []);
    const catalogIssues = (resolved.catalogIssues ?? validateExtensionCatalogIntegrity)();
    const reportErrors = [
        ...(runtimeConfigError ? [`runtime-config: ${runtimeConfigError}`] : []),
        ...failures,
        ...catalogIssues.map(issue => `extension-catalog: ${issue}`),
    ];
    const selected = new Set(runtime.adapters);
    const catalogPlatforms = (resolved.catalogPlatforms ?? getInstallableAdapterNames)();
    const selectionSource: AdapterCapabilitySelectionSource = explicitRuntime.adapters.length
        ? "cli"
        : runtime.adapters.length
          ? "config"
          : "catalog";
    const reportPlatforms = runtime.adapters.length ? runtime.adapters : catalogPlatforms;
    const report = buildAdapterCapabilityReport(
        resolved
            .getLoadedPlugins()
            .filter(plugin => plugin.type === "adapter" && selected.has(plugin.name)),
        reportErrors,
        reportPlatforms,
        catalogIssues.length === 0,
    );
    const evidenceWithoutDigest = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        application: {
            name: packageMetadata.name,
            version: packageMetadata.version,
        },
        target: {
            configPath: runtime.configPath,
            adapterSelection: {
                source: selectionSource,
                names: [...reportPlatforms],
            },
        },
        ...report,
    } satisfies Omit<AdapterCapabilityEvidenceReport, "evidenceDigest">;
    const evidence = {
        ...evidenceWithoutDigest,
        evidenceDigest: createAdapterCapabilityEvidenceDigest(evidenceWithoutDigest),
    } satisfies AdapterCapabilityEvidenceReport;
    return {
        output: formatAdapterCapabilityReport(evidence, options.json),
        raw: options.json,
        exitCode: failures.length ? 2 : report.complete ? undefined : 1,
    };
}
