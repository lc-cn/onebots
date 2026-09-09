/** OneBots CLI 命令背后的无路由 application module。 */
import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import { BaseAppConfigSchema, writeConfigFileAtomic } from "@onebots/core";
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

/** 读取点分隔路径表示的配置项。 */
export function getConfig(options: RuntimeOptions, key: string): CommandResult {
    const data = readConfig(normalizeRuntimeOptions(options).configPath);
    const value = key.split(".").reduce<unknown>((current, part) => {
        if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
        return current[part as keyof typeof current];
    }, data);
    return { output: value === undefined ? "" : String(value) };
}

/** 写入点分隔路径表示的配置项，并保留备份。 */
export function setConfig(options: RuntimeOptions, key: string, value: string): CommandResult {
    const file = normalizeRuntimeOptions(options).configPath;
    const data = readConfig(file);
    const keys = parseWritableConfigPath(key);
    let current = data;
    for (const part of keys.slice(0, -1)) {
        if (!current[part] || typeof current[part] !== "object" || Array.isArray(current[part]))
            current[part] = {};
        current = current[part] as Record<string, unknown>;
    }
    const leaf = keys.at(-1)!;
    const expectedType = resolveConfigSetType(keys, current[leaf]);
    current[leaf] = parseConfigSetValue(key, value, expectedType);
    writeConfigFileAtomic(file, yaml.dump(data), { backup: true });
    return { output: `已设置 ${key}` };
}

/** 以 YAML 返回完整配置。 */
export function listConfig(options: RuntimeOptions): CommandResult {
    return { output: yaml.dump(readConfig(normalizeRuntimeOptions(options).configPath)) };
}

function readConfig(file: string): Record<string, unknown> {
    if (!fs.existsSync(file)) throw new CliError(`配置文件不存在: ${file}`, 2);
    try {
        return parseRuntimeConfig(fs.readFileSync(file, "utf8"));
    } catch (error) {
        throw new CliError(`配置文件无效: ${formatRuntimeConfigDiagnostic(error)}`, 2);
    }
}

type ConfigSetScalarType = "string" | "number" | "boolean";
const RESERVED_CONFIG_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function parseWritableConfigPath(key: string): string[] {
    const keys = key.split(".");
    if (keys.some(part => !part.trim())) {
        throw new CliError("配置路径不能包含空字段", 2);
    }
    const reserved = keys.find(part => RESERVED_CONFIG_PATH_SEGMENTS.has(part));
    if (reserved) {
        throw new CliError(`配置路径包含不允许写入的保留字段: ${reserved}`, 2);
    }
    return keys;
}

/** 顶层基础 Schema 优先于损坏的现有值；嵌套字段沿用其当前标量类型。 */
function resolveConfigSetType(keys: string[], existing: unknown): ConfigSetScalarType | undefined {
    if (keys.length === 1) {
        const rule = BaseAppConfigSchema[keys[0]] as { type?: unknown } | undefined;
        if (rule && ["string", "number", "boolean"].includes(String(rule.type))) {
            return rule.type as ConfigSetScalarType;
        }
    }
    return ["string", "number", "boolean"].includes(typeof existing)
        ? (typeof existing as ConfigSetScalarType)
        : undefined;
}

function parseConfigSetValue(
    key: string,
    value: string,
    expectedType: ConfigSetScalarType | undefined,
): string | number | boolean {
    if (expectedType === "string") return value;
    if (expectedType === "boolean") {
        if (value === "true") return true;
        if (value === "false") return false;
        throw new CliError(`配置项 ${key} 需要布尔值 true 或 false`, 2);
    }
    const numeric = Number(value);
    if (expectedType === "number") {
        if (!value.trim() || !Number.isFinite(numeric)) {
            throw new CliError(`配置项 ${key} 需要有限数字`, 2);
        }
        return numeric;
    }
    if (value === "true") return true;
    if (value === "false") return false;
    return Number.isFinite(numeric) && value.trim() ? numeric : value;
}
