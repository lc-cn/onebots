import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { AdapterRegistry, ProtocolRegistry } from "@onebots/core";
import { writeCliError } from "./cli-output.js";

export type PluginInspection =
    | { status: "ready"; candidate: string; entryPath: string }
    | { status: "broken"; candidate: string; reason: string; buildCommand?: string }
    | { status: "missing"; candidates: string[] };

export type PluginLoadResult =
    | { loaded: true; inspection: Extract<PluginInspection, { status: "ready" }> }
    | { loaded: false; inspection: PluginInspection; message: string };

export type PluginType = "adapter" | "protocol";

/** 所有 CLI 路径共享同一组插件包名候选，避免运行、doctor 与服务预检规则漂移。 */
export function pluginCandidates(type: PluginType, name: string): string[] {
    const prefix = type === "adapter" ? "adapter" : "protocol";
    return [`@onebots/${prefix}-${name}`, `onebots-${prefix}-${name}`, name];
}

/** 区分插件未安装与 workspace 包存在但构建入口缺失。 */
export function inspectPlugin(
    candidates: string[],
    runtimeRequire: NodeJS.Require,
): PluginInspection {
    for (const candidate of candidates) {
        let requireEntry: string | undefined;
        try {
            requireEntry = runtimeRequire.resolve(candidate);
        } catch {
            // 纯 ESM 包可能只暴露 exports.import，继续从 package.json 解析。
        }

        const packageJsonPath = resolvePackageJson(candidate, runtimeRequire, requireEntry);
        if (packageJsonPath) {
            const entryPath = resolvePackageEntry(candidate, packageJsonPath);
            if (!entryPath) {
                return {
                    status: "broken",
                    candidate,
                    reason: "package.json 未提供可导入的插件入口",
                    buildCommand: candidate.startsWith("@onebots/")
                        ? `pnpm --filter ${candidate} build`
                        : undefined,
                };
            }
            if (fs.existsSync(entryPath)) {
                return { status: "ready", candidate, entryPath };
            }
            return {
                status: "broken",
                candidate,
                reason: `构建产物不存在: ${entryPath}`,
                buildCommand: candidate.startsWith("@onebots/")
                    ? `pnpm --filter ${candidate} build`
                    : undefined,
            };
        }

        if (requireEntry) return { status: "ready", candidate, entryPath: requireEntry };
    }
    return { status: "missing", candidates };
}

/** 加载第一个可用插件，并且每个逻辑插件最多输出一条诊断。 */
export async function tryLoadPlugin(
    kind: "适配器" | "协议",
    name: string,
    candidates: string[],
    runtimeRequire: NodeJS.Require,
): Promise<PluginLoadResult> {
    const inspection = inspectPlugin(candidates, runtimeRequire);
    if (inspection.status === "missing") {
        return {
            loaded: false,
            inspection,
            message: `未找到${kind} ${name}（已尝试: ${inspection.candidates.join(", ")}）`,
        };
    }
    if (inspection.status === "broken") {
        const suggestion = inspection.buildCommand ? `；请先运行 ${inspection.buildCommand}` : "";
        return {
            loaded: false,
            inspection,
            message: `加载${kind} ${name} 失败：已找到 ${inspection.candidate}，但入口无法加载（${inspection.reason}）${suggestion}`,
        };
    }
    try {
        await import(pathToFileURL(inspection.entryPath).href);
        return { loaded: true, inspection };
    } catch (error) {
        return {
            loaded: false,
            inspection,
            message: `加载${kind} ${name} 失败：${inspection.candidate} 运行时初始化失败（${firstLine(error)}）`,
        };
    }
}

/** 加载插件后确认它提供了 CLI 名称所承诺的工厂与配置 Schema。 */
export async function tryLoadRegisteredPlugin(
    type: PluginType,
    name: string,
    candidates: string[],
    runtimeRequire: NodeJS.Require,
): Promise<PluginLoadResult> {
    const kind = type === "adapter" ? "适配器" : "协议";
    const result = await tryLoadPlugin(kind, name, candidates, runtimeRequire);
    if (result.loaded === false) return result;

    const contractError = getRegistrationContractError(type, name);
    if (!contractError) return result;
    return {
        loaded: false,
        inspection: result.inspection,
        message: `加载${kind} ${name} 失败：${result.inspection.candidate} 已初始化，但${contractError}`,
    };
}

/** 兼容布尔返回值的加载入口；失败时输出结构化结果中的唯一诊断。 */
export async function loadPlugin(
    type: PluginType,
    name: string,
    candidates: string[],
    runtimeRequire: NodeJS.Require,
    warn: (message: string) => void = writeCliError,
): Promise<boolean> {
    const result = await tryLoadRegisteredPlugin(type, name, candidates, runtimeRequire);
    if (result.loaded === false) {
        warn(`[onebots] ${result.message}`);
    }
    return result.loaded;
}

function getRegistrationContractError(type: PluginType, name: string): string | undefined {
    if (type === "adapter") {
        if (!AdapterRegistry.has(name)) return `没有注册适配器 ${name}`;
        if (!AdapterRegistry.getSchema(name)) return `没有注册适配器配置 Schema ${name}`;
        return undefined;
    }

    const identity = parseProtocolIdentity(name);
    if (!identity) return `协议插件名必须使用 <name>-<version> 格式（例如 onebot-v11）`;
    const { protocol, version } = identity;
    if (!ProtocolRegistry.has(protocol, version)) {
        return `没有注册协议 ${protocol}/${version}`;
    }
    const schemaKey = `${protocol}.${version}`;
    if (!ProtocolRegistry.getSchema(schemaKey)) {
        return `没有注册协议配置 Schema ${schemaKey}`;
    }
    return undefined;
}

function parseProtocolIdentity(name: string): { protocol: string; version: string } | undefined {
    const match = /^(.+)-(v\d+)$/.exec(name);
    if (!match) return undefined;
    return { protocol: match[1], version: match[2] };
}

interface PackageManifest {
    name?: unknown;
    main?: unknown;
    module?: unknown;
    exports?: unknown;
}

function resolvePackageJson(
    candidate: string,
    runtimeRequire: NodeJS.Require,
    requireEntry?: string,
): string | undefined {
    const packageName = parsePackageName(candidate);
    if (!packageName) return undefined;

    for (const searchPath of runtimeRequire.resolve.paths(packageName) ?? []) {
        const packageJsonPath = path.join(searchPath, packageName, "package.json");
        if (fs.existsSync(packageJsonPath)) return packageJsonPath;
    }

    if (requireEntry) {
        let directory = path.dirname(requireEntry);
        while (directory !== path.dirname(directory)) {
            const packageJsonPath = path.join(directory, "package.json");
            if (fs.existsSync(packageJsonPath)) {
                const manifest = readPackageJson(packageJsonPath);
                if (manifest.name === packageName) return packageJsonPath;
            }
            directory = path.dirname(directory);
        }
    }
    return undefined;
}

function readPackageJson(file: string): PackageManifest {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8")) as PackageManifest;
    } catch {
        return {};
    }
}

function resolvePackageEntry(candidate: string, packageJsonPath: string): string | undefined {
    const manifest = readPackageJson(packageJsonPath);
    const packageName = parsePackageName(candidate);
    if (!packageName) return undefined;
    const subpath = candidate === packageName ? "." : `.${candidate.slice(packageName.length)}`;
    const exported = resolveExportTarget(manifest.exports, subpath);
    const usesExports = manifest.exports !== undefined;
    const target =
        exported ??
        (!usesExports && typeof manifest.module === "string" ? manifest.module : undefined) ??
        (!usesExports && typeof manifest.main === "string" ? manifest.main : undefined) ??
        (!usesExports ? "index.js" : undefined);
    if (!target || (usesExports && !target.startsWith("./")) || path.isAbsolute(target)) {
        return undefined;
    }

    const packageDirectory = path.dirname(packageJsonPath);
    const entryPath = path.resolve(packageDirectory, target);
    const relative = path.relative(packageDirectory, entryPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    return entryPath;
}

function resolveExportTarget(exportsValue: unknown, subpath: string): string | undefined {
    if (typeof exportsValue === "string") return subpath === "." ? exportsValue : undefined;
    if (Array.isArray(exportsValue)) {
        for (const option of exportsValue) {
            const target = resolveExportTarget(option, subpath);
            if (target) return target;
        }
        return undefined;
    }
    if (!exportsValue || typeof exportsValue !== "object") return undefined;

    const exportsMap = exportsValue as Record<string, unknown>;
    const hasSubpaths = Object.keys(exportsMap).some(key => key.startsWith("."));
    if (hasSubpaths) return resolveExportTarget(exportsMap[subpath], ".");
    if (subpath !== ".") return undefined;
    for (const condition of ["import", "node", "default", "require"] as const) {
        const target = resolveExportTarget(exportsMap[condition], ".");
        if (target) return target;
    }
    return undefined;
}

function parsePackageName(candidate: string): string | undefined {
    if (candidate.startsWith(".") || candidate.startsWith("/") || candidate.startsWith("file:")) {
        return undefined;
    }
    const parts = candidate.split("/");
    if (candidate.startsWith("@")) {
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
    }
    return parts[0] || undefined;
}

function firstLine(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).split("\n")[0];
}
