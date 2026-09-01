import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { createRequire } from "node:module";
import { inspectPublicStaticRoot } from "@onebots/core";
import { ServiceController, type ServiceScope, type ServiceSpec } from "./service-manager.js";
import { pluginCandidates, tryLoadRegisteredPlugin } from "./plugin-loader.js";
import {
    formatRuntimeConfigDiagnostic,
    parseRuntimeConfig,
    validateRuntimeConfig,
} from "./runtime-config-validator.js";
import { writeCliOutput } from "./cli-output.js";
import { probeDoctorManagementSurface } from "./doctor-management-surface.js";
import { hasManagementCredentials } from "./management-credentials.js";
import { inspectExtensionCatalog } from "./doctor-extension-catalog.js";
import { inspectExtensionRuntimeRoot } from "./extension-runtime-root.js";
import {
    inspectRuntimePackageManagerVersion,
    type RuntimePackageManagerVersionInspection,
} from "./package-manager.js";
import {
    inspectNodeRuntime,
    MINIMUM_NODE_MAJOR,
    unsupportedNodeRuntimeMessage,
} from "./runtime-version.js";
import { getRuntimePluginSelection } from "./runtime-plugin-selection.js";
import type { RuntimePluginSelection } from "./runtime-plugin-selection.js";
import {
    ensureRuntimeDataDirectory,
    inspectRuntimeDataDirectory,
} from "./runtime-data-directory.js";
import { inspectConfiguredDatabase } from "./doctor-database.js";
import {
    inspectDoctorServiceMetadata,
    type DoctorServiceMetadataInspection,
} from "./doctor-service-metadata.js";
import {
    inspectServiceNodeRuntime,
    type DoctorServiceRuntimeInspection,
} from "./doctor-service-runtime.js";
import { inspectServiceEntry, type DoctorServiceEntryInspection } from "./doctor-service-entry.js";
import {
    inspectDoctorServiceDefinition,
    inspectDoctorServiceDefinitionPermissions,
    repairDoctorUserService,
    type DoctorServiceDefinitionInspection,
} from "./doctor-service-definition.js";
import { inspectDoctorServiceStateDirectory } from "./doctor-service-state.js";
import packageMetadata from "../package.json" with { type: "json" };
import {
    compareDoctorEndpointIdentities,
    probeDoctorEndpoint,
    resolveGatewayBaseUrl,
    resolveGatewayPort,
    resolveManagementWebUrl,
    verifyDoctorRuntimeContract,
    type DoctorCheck,
} from "./doctor-endpoint.js";
import { resolveServiceRuntimeContractId } from "./service-runtime-contract.js";
import { inspectGatewayPortAvailability } from "./doctor-port.js";
import {
    inspectSensitiveDirectoryMutationPermissions,
    inspectSensitiveFilePermissions,
} from "./doctor-permissions.js";
import { probeDoctorManagementAfterIdentity } from "./doctor-management-boundary.js";

export { compareDoctorEndpointIdentities, probeDoctorEndpoint, resolveGatewayBaseUrl };
export type { CheckLevel, DoctorCheck, DoctorEndpointIdentity } from "./doctor-endpoint.js";
export {
    inspectSensitiveDirectoryMutationPermissions,
    inspectSensitiveFilePermissions,
} from "./doctor-permissions.js";
export interface DoctorPluginTarget {
    source: DoctorPluginSource;
    names: string[];
}
export interface DoctorTarget {
    configPath: string;
    /** 实际用于公开探针与管理 API 的地址；配置无法解析时为 null。 */
    baseUrl: string | null;
    /** 实际用于 Web 管理页探针的 origin；配置无法解析时为 null。 */
    webUrl: string | null;
    dataDirectory: string;
    databasePath: string | null;
    publicStaticDirectory: string | null;
    extensionRoot: string;
    workingDirectory: string;
    service: {
        scope: ServiceScope;
        mode: "invalid" | "managed" | "standalone" | "uninstalled";
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
    /** CLI 已读取的服务元数据，避免诊断入口重复解析并保留同一份证据。 */
    serviceMetadata?: DoctorServiceMetadataInspection;
    /** 测试或嵌入场景可替换服务 Node 版本探测。 */
    serviceRuntimeInspector?: (nodePath: string) => DoctorServiceRuntimeInspection;
    /** 测试或嵌入场景可替换服务入口身份探测。 */
    serviceEntryInspector?: (binPath: string) => DoctorServiceEntryInspection;
    /** 测试或嵌入场景可替换平台服务定义探测。 */
    serviceDefinitionInspector?: (
        controller: ServiceController,
        spec: ServiceSpec,
    ) => DoctorServiceDefinitionInspection;
    /** 测试或嵌入场景可替换实际包管理器版本探测。 */
    packageManagerInspector?: (
        runtimeRoot: string,
    ) => Promise<RuntimePackageManagerVersionInspection>;
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
            const resolvedConfigPath = fs.realpathSync(options.configPath);
            checks.push(
                inspectSensitiveFilePermissions(
                    resolvedConfigPath,
                    "config-mode",
                    "配置文件",
                    options.fix,
                ),
            );
            checks.push(
                inspectSensitiveDirectoryMutationPermissions(path.dirname(resolvedConfigPath)),
            );
            const backupPath = `${resolvedConfigPath}.bak`;
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

    const publicStatic = inspectConfiguredPublicStaticDirectory(
        path.dirname(options.configPath),
        config?.public_static_dir,
        options.fix,
    );
    if (config) checks.push(publicStatic.check);

    const dataDir = path.resolve(path.dirname(options.configPath), "data");
    const dataDirectoryCheck = inspectDataDirectory(dataDir, options.fix);
    checks.push(dataDirectoryCheck);
    if (process.platform !== "win32" && dataDirectoryCheck.level === "ok") {
        checks.push(inspectSensitiveDirectoryPermissions(dataDir, options.fix));
    }
    const database = inspectConfiguredDatabase(dataDir, config);
    checks.push(...database.checks);

    const useInstalledService = options.useInstalledService !== false;
    const controller = new ServiceController(options.scope);
    const serviceMetadata = useInstalledService
        ? (options.serviceMetadata ?? inspectDoctorServiceMetadata(controller))
        : { spec: null, error: null };
    const spec = serviceMetadata.spec;
    if (serviceMetadata.error) {
        checks.push({
            name: "service-metadata",
            level: "error",
            message: `${serviceMetadata.error}；请重新执行 onebots install 生成服务定义`,
        });
    }
    const servicePaths = controller.paths();
    const serviceMetadataPath = servicePaths.metadata;
    if (useInstalledService && process.platform !== "win32" && fs.existsSync(serviceMetadataPath)) {
        checks.push(
            inspectSensitiveFilePermissions(
                serviceMetadataPath,
                "service-metadata-mode",
                "服务元数据",
                options.fix === true && options.scope === "user",
            ),
        );
    }
    if (
        useInstalledService &&
        process.platform !== "win32" &&
        fs.existsSync(servicePaths.definition)
    ) {
        checks.push(
            inspectDoctorServiceDefinitionPermissions(
                servicePaths.definition,
                options.fix === true && options.scope === "user",
            ),
        );
    }
    const selection = resolveDoctorPluginSelection(options, configuredPlugins, spec);
    checks.push(inspectDoctorPluginSelection(selection));
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
        : await (options.packageManagerInspector ?? inspectRuntimePackageManagerVersion)(
              extensionRoot,
          );
    checks.push({
        name: "package-manager",
        level: packageManager?.error || extensionRuntime.error ? "error" : "ok",
        message:
            packageManager?.error ??
            (packageManager
                ? `扩展包管理器可用: ${packageManager.manager}@${packageManager.version}（${packageManager.resolvedPath}）`
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

    const status =
        useInstalledService && !serviceMetadata.error
            ? controller.status(serviceMetadata.spec)
            : null;
    checks.push(
        serviceMetadata.error
            ? {
                  name: "service",
                  level: "error",
                  message: "服务元数据无效，无法验证安装与运行状态",
              }
            : useInstalledService
              ? {
                    name: "service",
                    level: status?.error
                        ? "error"
                        : status?.installed && status.running
                          ? "ok"
                          : "warning",
                    message: status?.error
                        ? `${status.error}${status.detail ? `：${status.detail}` : ""}`
                        : status?.installed
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
        if (config && path.resolve(spec.configPath) === path.resolve(options.configPath)) {
            const credentialsPersisted = hasManagementCredentials(config, "");
            checks.push({
                name: "service-credentials",
                level: credentialsPersisted ? "ok" : "error",
                message: credentialsPersisted
                    ? "服务配置包含持久化管理凭据"
                    : "服务配置缺少持久化管理凭据；当前 shell 的 ONEBOTS_ACCESS_TOKEN 不会写入服务定义，请将凭据写入配置或取消该环境变量后执行 onebots setup --force",
            });
        }
        const inspectServiceRuntime = options.serviceRuntimeInspector ?? inspectServiceNodeRuntime;
        const serviceRuntime = inspectServiceRuntime(spec.nodePath);
        const inspectEntry = options.serviceEntryInspector ?? inspectServiceEntry;
        const serviceEntry = inspectEntry(spec.binPath);
        const inspectDefinition =
            options.serviceDefinitionInspector ?? inspectDoctorServiceDefinition;
        const serviceDefinition = inspectDefinition(controller, spec);
        const stateDirectory = controller.paths().stateDir;
        checks.push(
            inspectDoctorServiceStateDirectory(
                stateDirectory,
                options.fix === true && options.scope === "user",
            ),
        );
        const requestedPluginsDiffer =
            (options.adapters.length > 0 &&
                options.adapters.join("\0") !== spec.adapters.join("\0")) ||
            (options.protocols.length > 0 &&
                options.protocols.join("\0") !== spec.protocols.join("\0"));
        const stale =
            !serviceRuntime.supported ||
            !serviceEntry.valid ||
            !fs.existsSync(spec.configPath) ||
            !fs.existsSync(spec.workingDirectory) ||
            spec.configPath !== options.configPath ||
            spec.scope !== options.scope ||
            requestedPluginsDiffer ||
            !serviceDefinition.current;
        if (stale && options.fix && options.scope === "user") {
            const repairedSpec = {
                ...spec,
                configPath: options.configPath,
                nodePath: process.execPath,
                binPath: path.resolve(process.argv[1]),
            };
            checks.push(
                ...(await repairDoctorUserService({
                    controller,
                    previousSpec: spec,
                    repairedSpec,
                    previousRuntime: serviceRuntime,
                    previousEntry: serviceEntry,
                    runtimeInspector: inspectServiceRuntime,
                    entryInspector: inspectEntry,
                    definitionInspector: inspectDefinition,
                })),
            );
        } else {
            checks.push(serviceRuntime.check);
            checks.push(serviceEntry.check);
            checks.push({
                name: "service-definition",
                level: stale ? "error" : "ok",
                message:
                    serviceDefinition.error ??
                    (stale
                        ? `服务定义中的运行路径已失效${options.scope === "system" ? "；请使用管理员权限重新执行 onebots install --system" : "，--fix 可修复"}`
                        : "服务运行路径有效"),
            });
        }
    }

    let baseUrl: string | null = null;
    let webUrl: string | null = null;
    if (config) {
        let port: number | undefined;
        try {
            const environmentPort = spec
                ? undefined
                : (options.environmentPort ?? process.env.PORT);
            baseUrl = resolveGatewayBaseUrl(config, environmentPort);
            webUrl = resolveManagementWebUrl(config, environmentPort);
            port = resolveGatewayPort(config, environmentPort);
        } catch (error) {
            checks.push({
                name: "gateway-address",
                level: "error",
                message: `网关地址配置无效: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
        if (baseUrl && webUrl && port !== undefined) {
            const managementBaseUrl = baseUrl;
            const managementWebUrl = webUrl;
            const portOpen = status?.running || (await isPortOpen(port));
            if (portOpen) {
                const endpointChecks = await Promise.all([
                    probeDoctorEndpoint(
                        managementBaseUrl,
                        "health",
                        fetch,
                        packageMetadata.version,
                    ),
                    probeDoctorEndpoint(managementBaseUrl, "ready", fetch),
                ]);
                const identityCheck = compareDoctorEndpointIdentities(...endpointChecks);
                checks.push(...endpointChecks, identityCheck);
                let runtimeContractCheck: DoctorCheck | undefined;
                if (spec) {
                    runtimeContractCheck = verifyDoctorRuntimeContract(
                        identityCheck,
                        resolveServiceRuntimeContractId(spec),
                    );
                    checks.push(runtimeContractCheck);
                }
                checks.push(
                    ...(await probeDoctorManagementAfterIdentity({
                        health: endpointChecks[0],
                        identity: identityCheck,
                        ...(runtimeContractCheck ? { runtimeContract: runtimeContractCheck } : {}),
                        probe: () =>
                            probeDoctorManagementSurface({
                                baseUrl: managementBaseUrl,
                                webUrl: managementWebUrl,
                                config,
                                expectedIdentity: identityCheck.identity,
                            }),
                        confirm: () =>
                            probeDoctorEndpoint(
                                managementBaseUrl,
                                "health",
                                fetch,
                                packageMetadata.version,
                            ),
                    })),
                );
            } else {
                checks.push(await inspectGatewayPortAvailability(port));
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
            baseUrl,
            webUrl,
            dataDirectory: dataDir,
            databasePath: database.path,
            publicStaticDirectory: publicStatic.path,
            extensionRoot: extensionRuntime.root,
            workingDirectory: path.resolve(selection.workingDirectory),
            service: {
                scope: options.scope,
                mode: useInstalledService
                    ? serviceMetadata.error
                        ? "invalid"
                        : spec
                          ? "managed"
                          : "uninstalled"
                    : "standalone",
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

export interface DoctorPublicStaticInspection {
    check: DoctorCheck;
    path: string | null;
}

/** 使用运行时相同的真实路径规则验证可选静态目录，并单独证明管理上传写权限。 */
export function inspectConfiguredPublicStaticDirectory(
    configDir: string,
    configured: unknown,
    fix = false,
): DoctorPublicStaticInspection {
    if (configured !== undefined && configured !== null && typeof configured !== "string") {
        return {
            check: {
                name: "public-static-dir",
                level: "error",
                message: "public_static_dir 必须是字符串路径",
            },
            path: null,
        };
    }
    const configuredPath = typeof configured === "string" ? configured : undefined;
    const inspection = inspectPublicStaticRoot(configDir, configuredPath, fix);
    if (inspection.status === "disabled") {
        return {
            check: {
                name: "public-static-dir",
                level: "ok",
                message: "未启用站点根静态目录",
            },
            path: null,
        };
    }
    if (inspection.status === "invalid") {
        return {
            check: {
                name: "public-static-dir",
                level: "error",
                message: inspection.error,
            },
            path: inspection.root,
        };
    }
    if (inspection.status === "missing") {
        return {
            check: {
                name: "public-static-dir",
                level: "warning",
                message: `站点根静态目录尚未创建: ${inspection.root}（--fix 可修复）`,
            },
            path: inspection.root,
        };
    }
    try {
        fs.accessSync(inspection.root, fs.constants.W_OK);
        return {
            check: {
                name: "public-static-dir",
                level: "ok",
                message: inspection.created
                    ? `已创建并验证站点根静态目录: ${inspection.root}`
                    : `站点根静态目录可读取且管理端可写: ${inspection.root}`,
                ...(inspection.created ? { fixed: true } : {}),
            },
            path: inspection.root,
        };
    } catch {
        return {
            check: {
                name: "public-static-dir",
                level: "warning",
                message: `站点根静态目录可用于读取，但当前进程无法通过管理端写入: ${inspection.root}`,
            },
            path: inspection.root,
        };
    }
}

/** 验证数据库、审计与管理日志、适配器状态使用的数据目录，不以路径存在代替可用性。 */
export function inspectDataDirectory(dataDirectory: string, fix = false): DoctorCheck {
    const inspection = inspectRuntimeDataDirectory(dataDirectory);
    if (inspection.status === "ready") {
        return {
            name: "data-dir",
            level: "ok",
            message: `数据目录可读写: ${dataDirectory}`,
        };
    }
    if (inspection.status === "invalid") {
        return {
            name: "data-dir",
            level: "error",
            message: inspection.error,
        };
    }
    if (!fix) {
        return {
            name: "data-dir",
            level: "warning",
            message: `数据目录尚未创建: ${dataDirectory}（--fix 可修复）`,
        };
    }
    try {
        ensureRuntimeDataDirectory(dataDirectory);
        return {
            name: "data-dir",
            level: "ok",
            message: `已创建并验证数据目录: ${dataDirectory}`,
            fixed: true,
        };
    } catch (error) {
        return {
            name: "data-dir",
            level: "error",
            message: error instanceof Error ? error.message : String(error),
        };
    }
}

/** 检查包含数据库与日志的 POSIX 目录权限，避免同机用户读取或替换运行数据。 */
export function inspectSensitiveDirectoryPermissions(
    directoryPath: string,
    fix = false,
): DoctorCheck {
    try {
        const mode = fs.statSync(directoryPath).mode & 0o777;
        const formattedMode = formatMode(mode);
        const hasPublicAccess = (mode & 0o007) !== 0;
        const hasGroupMutation = (mode & 0o020) !== 0;
        if (hasPublicAccess || hasGroupMutation) {
            if (fix) {
                fs.chmodSync(directoryPath, 0o700);
                return {
                    name: "data-dir-mode",
                    level: "ok",
                    message: `已将数据目录权限从 ${formattedMode} 收紧为 0700`,
                    fixed: true,
                };
            }
            return {
                name: "data-dir-mode",
                level: "error",
                message: `数据目录权限 ${formattedMode} 允许其他用户访问或同组用户修改（--fix 可收紧为 0700）`,
            };
        }
        if ((mode & 0o070) !== 0) {
            return {
                name: "data-dir-mode",
                level: "warning",
                message: `数据目录权限 ${formattedMode} 允许同组用户访问；请确认这是服务部署所需`,
            };
        }
        return {
            name: "data-dir-mode",
            level: "ok",
            message: `数据目录权限 ${formattedMode} 未向组或其他用户开放`,
        };
    } catch (error) {
        const code =
            error instanceof Error && "code" in error && typeof error.code === "string"
                ? error.code
                : "UNKNOWN";
        return {
            name: "data-dir-mode",
            level: "error",
            message: `数据目录权限无法验证: ${directoryPath} (${code})`,
        };
    }
}

function formatMode(mode: number): string {
    return mode.toString(8).padStart(3, "0");
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

/** 分别证明平台入口与协议出口已经选择，避免半套插件被误报为可部署。 */
export function inspectDoctorPluginSelection(selection: DoctorPluginSelection): DoctorCheck {
    const summary = formatDoctorPluginSelection(selection);
    const hasAdapters = selection.adapters.length > 0;
    const hasProtocols = selection.protocols.length > 0;
    if (hasAdapters && hasProtocols) {
        return { name: "plugin-selection", level: "ok", message: summary };
    }
    const guidance =
        !hasAdapters && !hasProtocols
            ? "尚未选择适配器和协议；请先比较平台能力并安装至少一个平台入口和协议出口"
            : !hasAdapters
              ? "未选择适配器，无法创建平台账号"
              : "未选择协议，账号无法配置对外出口";
    return {
        name: "plugin-selection",
        level: "warning",
        message: `${summary}；${guidance}`,
    };
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
