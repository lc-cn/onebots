import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { createRequire } from "node:module";
import { ServiceController, type ServiceScope, type ServiceSpec } from "./service-manager.js";
import { pluginCandidates, tryLoadRegisteredPlugin } from "./plugin-loader.js";
import {
    formatRuntimeConfigDiagnostic,
    parseRuntimeConfig,
    validateRuntimeConfig,
} from "./runtime-config-validator.js";
import { writeCliOutput } from "./cli-output.js";
import { probeDoctorManagement } from "./doctor-management.js";
import { inspectExtensionCatalog } from "./doctor-extension-catalog.js";
import { inspectExtensionRuntimeRoot } from "./extension-runtime-root.js";
import { inspectRuntimePackageManager } from "./package-manager.js";
import {
    inspectNodeRuntime,
    MINIMUM_NODE_MAJOR,
    unsupportedNodeRuntimeMessage,
} from "./runtime-version.js";
import { getRuntimePluginSelection } from "./runtime-plugin-selection.js";
import type { RuntimePluginSelection } from "./runtime-plugin-selection.js";
import packageMetadata from "../package.json" with { type: "json" };
import {
    compareDoctorEndpointIdentities,
    probeDoctorEndpoint,
    resolveGatewayBaseUrl,
    resolveGatewayPort,
    type DoctorCheck,
} from "./doctor-endpoint.js";

export { compareDoctorEndpointIdentities, probeDoctorEndpoint, resolveGatewayBaseUrl };
export type { CheckLevel, DoctorCheck, DoctorEndpointIdentity } from "./doctor-endpoint.js";
export interface DoctorPluginTarget {
    source: DoctorPluginSource;
    names: string[];
}
export interface DoctorTarget {
    configPath: string;
    dataDirectory: string;
    extensionRoot: string;
    workingDirectory: string;
    service: {
        scope: ServiceScope;
        mode: "managed" | "standalone" | "uninstalled";
    };
    plugins: {
        adapters: DoctorPluginTarget;
        protocols: DoctorPluginTarget;
    };
}
export interface DoctorReport {
    schemaVersion: 1;
    generatedAt: string;
    application: {
        name: string;
        version: string;
    };
    target: DoctorTarget;
    ok: boolean;
    strict: boolean;
    checks: DoctorCheck[];
}
export interface DoctorOptions {
    configPath: string;
    adapters: string[];
    protocols: string[];
    scope: ServiceScope;
    fix?: boolean;
    /** 严格模式下，任何 warning 都会使诊断失败。 */
    strict?: boolean;
    /** false 表示独立诊断显式配置，不读取或修复已安装服务定义。 */
    useInstalledService?: boolean;
    /** 测试或嵌入场景可显式提供当前进程的端口覆盖。 */
    environmentPort?: string;
    /** 测试或嵌入场景可显式提供扩展运行目录。 */
    extensionRoot?: string;
}

export type DoctorPluginSource = "cli" | "config" | "service" | "none";

export interface DoctorPluginSelection {
    adapters: string[];
    protocols: string[];
    adapterSource: DoctorPluginSource;
    protocolSource: DoctorPluginSource;
    workingDirectory: string;
}

/** 诊断配置、插件、权限、端口、系统服务与健康端点。 */
export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
    const checks: DoctorCheck[] = [];
    const runtime = inspectNodeRuntime();
    checks.push({
        name: "node",
        level: runtime.supported ? "ok" : "error",
        message: runtime.supported
            ? `Node.js ${process.version}（要求 >=${MINIMUM_NODE_MAJOR}）`
            : unsupportedNodeRuntimeMessage(runtime),
    });
    checks.push(inspectExtensionCatalog());

    let config: Record<string, unknown> | null = null;
    let configuredPlugins: RuntimePluginSelection | undefined;
    if (!fs.existsSync(options.configPath)) {
        checks.push({
            name: "config",
            level: "error",
            message: `配置文件不存在: ${options.configPath}`,
        });
    } else {
        try {
            config = parseRuntimeConfig(fs.readFileSync(options.configPath, "utf8"));
            configuredPlugins = getRuntimePluginSelection(config);
            checks.push({
                name: "config",
                level: "ok",
                message: `配置语法有效: ${options.configPath}`,
            });
        } catch (error) {
            config = null;
            configuredPlugins = undefined;
            checks.push({
                name: "config",
                level: "error",
                message: `配置无效: ${formatRuntimeConfigDiagnostic(error)}`,
            });
        }
    }

    if (fs.existsSync(options.configPath)) {
        try {
            fs.accessSync(options.configPath, fs.constants.R_OK | fs.constants.W_OK);
            fs.accessSync(path.dirname(options.configPath), fs.constants.W_OK);
            checks.push({
                name: "permissions",
                level: "ok",
                message: "配置文件可读写，配置目录可写",
            });
        } catch (error) {
            checks.push({
                name: "permissions",
                level: "error",
                message: `配置或目录权限不足: ${(error as Error).message}`,
            });
        }
        if (process.platform !== "win32") {
            checks.push(
                inspectSensitiveFilePermissions(
                    options.configPath,
                    "config-mode",
                    "配置文件",
                    options.fix,
                ),
            );
            const backupPath = `${fs.realpathSync(options.configPath)}.bak`;
            if (fs.existsSync(backupPath)) {
                checks.push(
                    inspectSensitiveFilePermissions(
                        backupPath,
                        "config-backup-mode",
                        "配置备份",
                        options.fix,
                    ),
                );
            }
        }
    }

    const dataDir = path.resolve(path.dirname(options.configPath), "data");
    checks.push(inspectDataDirectory(dataDir, options.fix));

    const useInstalledService = options.useInstalledService !== false;
    const controller = new ServiceController(options.scope);
    const spec = useInstalledService ? controller.readSpec() : null;
    const selection = resolveDoctorPluginSelection(options, configuredPlugins, spec);
    checks.push({
        name: "plugin-selection",
        level: selection.adapters.length || selection.protocols.length ? "ok" : "warning",
        message: formatDoctorPluginSelection(selection),
    });
    const extensionRoot =
        options.extensionRoot ?? process.env.ONEBOTS_EXTENSION_ROOT ?? selection.workingDirectory;
    const extensionRuntime = inspectExtensionRuntimeRoot(extensionRoot);
    checks.push({
        name: "extension-root",
        level: extensionRuntime.error ? "error" : "ok",
        message:
            extensionRuntime.error ??
            `扩展运行目录已验证: ${extensionRuntime.root}（onebots@${extensionRuntime.version}）`,
    });
    const packageManager = extensionRuntime.error
        ? null
        : inspectRuntimePackageManager(extensionRoot);
    checks.push({
        name: "package-manager",
        level: packageManager?.error || extensionRuntime.error ? "error" : "ok",
        message:
            packageManager?.error ??
            (packageManager
                ? `扩展包管理器可用: ${packageManager.manager}（${packageManager.resolvedPath}）`
                : "扩展运行目录未通过验证，无法确定安全的包管理器"),
    });
    const runtimeRequire = createRequire(path.join(selection.workingDirectory, "package.json"));
    let pluginsReady = true;
    for (const [kind, names] of [
        ["adapter", selection.adapters],
        ["protocol", selection.protocols],
    ] as const) {
        for (const name of names) {
            const result = await tryLoadRegisteredPlugin(
                kind,
                name,
                pluginCandidates(kind, name),
                runtimeRequire,
            );
            pluginsReady &&= result.loaded;
            checks.push({
                name: `${kind}:${name}`,
                level: result.loaded ? "ok" : "error",
                message:
                    result.loaded === true
                        ? `已加载 ${name}（${result.inspection.packageName}@${result.inspection.version ?? "未知版本"}）`
                        : result.message,
            });
        }
    }

    if (config && pluginsReady) {
        try {
            validateRuntimeConfig(config);
            checks.push({ name: "runtime-config", level: "ok", message: "适配器与协议配置有效" });
        } catch (error) {
            checks.push({
                name: "runtime-config",
                level: "error",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    const status = useInstalledService ? controller.status() : null;
    checks.push(
        useInstalledService
            ? {
                  name: "service",
                  level: status?.installed && status.running ? "ok" : "warning",
                  message: status?.installed
                      ? `服务${status.running ? "正在运行" : "已安装但未运行"}`
                      : "服务未安装",
              }
            : {
                  name: "service",
                  level: "ok",
                  message: "按显式配置独立诊断，未读取或修改已安装服务定义",
              },
    );
    if (spec) {
        const stateDirectory = controller.paths().stateDir;
        try {
            fs.accessSync(stateDirectory, fs.constants.R_OK | fs.constants.W_OK);
            checks.push({
                name: "service-permissions",
                level: "ok",
                message: `服务状态目录可读写: ${stateDirectory}`,
            });
        } catch (error) {
            checks.push({
                name: "service-permissions",
                level: "error",
                message: `服务状态目录权限不足: ${(error as Error).message}`,
            });
        }
        const requestedPluginsDiffer =
            (options.adapters.length > 0 &&
                options.adapters.join("\0") !== spec.adapters.join("\0")) ||
            (options.protocols.length > 0 &&
                options.protocols.join("\0") !== spec.protocols.join("\0"));
        const stale =
            !fs.existsSync(spec.nodePath) ||
            !fs.existsSync(spec.binPath) ||
            !fs.existsSync(spec.configPath) ||
            !fs.existsSync(spec.workingDirectory) ||
            spec.configPath !== options.configPath ||
            spec.scope !== options.scope ||
            requestedPluginsDiffer ||
            !controller.definitionIsCurrent(spec);
        if (stale && options.fix && options.scope === "user") {
            await controller.install({
                ...spec,
                configPath: options.configPath,
                nodePath: process.execPath,
                binPath: path.resolve(process.argv[1]),
            });
            checks.push({
                name: "service-definition",
                level: "ok",
                message: "已重新生成用户级服务定义",
                fixed: true,
            });
        } else {
            checks.push({
                name: "service-definition",
                level: stale ? "error" : "ok",
                message: stale
                    ? `服务定义中的运行路径已失效${options.scope === "system" ? "；请使用管理员权限重新执行 onebots install --system" : "，--fix 可修复"}`
                    : "服务运行路径有效",
            });
        }
    }

    if (config) {
        let base: string | undefined;
        let port: number | undefined;
        try {
            const environmentPort = spec
                ? undefined
                : (options.environmentPort ?? process.env.PORT);
            base = resolveGatewayBaseUrl(config, environmentPort);
            port = resolveGatewayPort(config, environmentPort);
        } catch (error) {
            checks.push({
                name: "gateway-address",
                level: "error",
                message: `网关地址配置无效: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
        if (base && port !== undefined) {
            const portOpen = status?.running || (await isPortOpen(port));
            if (portOpen) {
                const endpointChecks = await Promise.all([
                    probeDoctorEndpoint(base, "health", fetch, packageMetadata.version),
                    probeDoctorEndpoint(base, "ready", fetch),
                ]);
                checks.push(...endpointChecks, compareDoctorEndpointIdentities(...endpointChecks));
                checks.push(...(await probeDoctorManagement(base, config)));
            } else {
                checks.push({ name: "port", level: "ok", message: `端口 ${port} 可用` });
            }
        }
    }
    const strict = options.strict === true;
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        application: {
            name: packageMetadata.name,
            version: packageMetadata.version,
        },
        target: {
            configPath: path.resolve(options.configPath),
            dataDirectory: dataDir,
            extensionRoot: extensionRuntime.root,
            workingDirectory: path.resolve(selection.workingDirectory),
            service: {
                scope: options.scope,
                mode: useInstalledService ? (spec ? "managed" : "uninstalled") : "standalone",
            },
            plugins: {
                adapters: {
                    source: selection.adapterSource,
                    names: [...selection.adapters],
                },
                protocols: {
                    source: selection.protocolSource,
                    names: [...selection.protocols],
                },
            },
        },
        ok: !checks.some(check => check.level === "error" || (strict && check.level === "warning")),
        strict,
        checks,
    };
}

/** 验证数据库、审计日志与适配器状态使用的数据目录，而不以路径存在代替可用性。 */
export function inspectDataDirectory(dataDirectory: string, fix = false): DoctorCheck {
    try {
        const stat = fs.statSync(dataDirectory);
        if (!stat.isDirectory()) {
            return {
                name: "data-dir",
                level: "error",
                message: `数据存储路径不是目录: ${dataDirectory}`,
            };
        }
        fs.accessSync(dataDirectory, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
        return {
            name: "data-dir",
            level: "ok",
            message: `数据目录可读写: ${dataDirectory}`,
        };
    } catch (error) {
        if (isFileSystemError(error, "ENOENT")) {
            if (!fix) {
                return {
                    name: "data-dir",
                    level: "warning",
                    message: `数据目录尚未创建: ${dataDirectory}（--fix 可修复）`,
                };
            }
            try {
                fs.mkdirSync(dataDirectory, { recursive: true });
                fs.accessSync(
                    dataDirectory,
                    fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK,
                );
                return {
                    name: "data-dir",
                    level: "ok",
                    message: `已创建并验证数据目录: ${dataDirectory}`,
                    fixed: true,
                };
            } catch (createError) {
                return {
                    name: "data-dir",
                    level: "error",
                    message: `无法创建可用的数据目录: ${formatFileSystemError(createError)}`,
                };
            }
        }
        return {
            name: "data-dir",
            level: "error",
            message: `数据目录不可用: ${formatFileSystemError(error)}`,
        };
    }
}

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === code;
}

function formatFileSystemError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 逐类别公开 doctor 最终采用的插件来源，避免服务定义与候选配置互相污染。 */
export function resolveDoctorPluginSelection(
    options: Pick<DoctorOptions, "adapters" | "protocols" | "useInstalledService">,
    configured: RuntimePluginSelection | undefined,
    service: ServiceSpec | null,
): DoctorPluginSelection {
    const useService = options.useInstalledService !== false;
    const adapters = resolvePluginCategory(
        options.adapters,
        configured?.adapters,
        useService ? service?.adapters : undefined,
    );
    const protocols = resolvePluginCategory(
        options.protocols,
        configured?.protocols,
        useService ? service?.protocols : undefined,
    );
    return {
        adapters: adapters.names,
        protocols: protocols.names,
        adapterSource: adapters.source,
        protocolSource: protocols.source,
        workingDirectory: useService && service ? service.workingDirectory : process.cwd(),
    };
}

function resolvePluginCategory(
    explicit: string[],
    configured: string[] | undefined,
    service: string[] | undefined,
): { names: string[]; source: DoctorPluginSource } {
    if (explicit.length) return { names: explicit, source: "cli" };
    if (service !== undefined) return { names: service, source: "service" };
    if (configured !== undefined) return { names: configured, source: "config" };
    return { names: [], source: "none" };
}

function formatDoctorPluginSelection(selection: DoctorPluginSelection): string {
    const sourceNames: Record<DoctorPluginSource, string> = {
        cli: "CLI",
        config: "配置文件",
        service: "服务定义",
        none: "未指定",
    };
    const list = (values: string[]) => (values.length ? values.join(", ") : "无");
    return `适配器 ${sourceNames[selection.adapterSource]} [${list(selection.adapters)}]；协议 ${sourceNames[selection.protocolSource]} [${list(selection.protocols)}]；解析目录 ${selection.workingDirectory}`;
}

/** 检查包含凭据的 POSIX 文件权限；组只读可见但不自动破坏部署授权。 */
export function inspectSensitiveFilePermissions(
    filePath: string,
    name: string,
    label: string,
    fix = false,
): DoctorCheck {
    const mode = fs.statSync(filePath).mode & 0o777;
    const formattedMode = formatMode(mode);
    const hasPublicAccess = (mode & 0o007) !== 0;
    const hasGroupMutation = (mode & 0o030) !== 0;
    if (hasPublicAccess || hasGroupMutation) {
        if (fix) {
            fs.chmodSync(filePath, 0o600);
            return {
                name,
                level: "ok",
                message: `已将${label}权限从 ${formattedMode} 收紧为 0600`,
                fixed: true,
            };
        }
        return {
            name,
            level: "error",
            message: `${label}权限 ${formattedMode} 允许其他用户访问或同组用户修改（--fix 可收紧为 0600）`,
        };
    }
    if ((mode & 0o040) !== 0) {
        return {
            name,
            level: "warning",
            message: `${label}权限 ${formattedMode} 允许同组用户读取；请确认这是服务部署所需`,
        };
    }
    return {
        name,
        level: "ok",
        message: `${label}权限 ${formattedMode} 未向组或其他用户开放`,
    };
}

function formatMode(mode: number): string {
    return mode.toString(8).padStart(3, "0");
}

/** 以人类可读或 JSON 格式输出诊断结果。 */
export function printDoctorReport(report: DoctorReport, json = false): void {
    writeCliOutput(formatDoctorReport(report, json));
}

/** 将诊断结果格式化，供 CLI、TUI 和机器输出共享。 */
export function formatDoctorReport(report: DoctorReport, json = false): string {
    if (json) return JSON.stringify(report, null, 2);
    const lines = report.checks.map(check => {
        const mark = check.level === "ok" ? "✓" : check.level === "warning" ? "!" : "✗";
        return `${mark} ${check.name}: ${check.message}${check.fixed ? " [fixed]" : ""}`;
    });
    lines.push(
        report.strict
            ? report.ok
                ? "OneBots 严格诊断通过"
                : "OneBots 严格诊断存在需要处理的问题"
            : report.ok
              ? "OneBots 诊断通过"
              : "OneBots 存在需要处理的问题",
    );
    return lines.join("\n");
}

function isPortOpen(port: number): Promise<boolean> {
    return new Promise(resolve => {
        const socket = net.connect({ host: "127.0.0.1", port });
        const finish = (result: boolean) => {
            socket.destroy();
            resolve(result);
        };
        socket.setTimeout(500);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
    });
}
