import * as fs from "node:fs";
import type { DoctorCheck } from "./doctor-endpoint.js";
import {
    compareDoctorEndpointIdentities,
    probeDoctorEndpoint,
    resolveGatewayBaseUrl,
    resolveManagementWebUrl,
    verifyDoctorRuntimeContract,
} from "./doctor-endpoint.js";
import { inspectDoctorServiceMetadata } from "./doctor-service-metadata.js";
import {
    inspectDoctorServiceDefinition,
    inspectDoctorServiceDefinitionPermissions,
} from "./doctor-service-definition.js";
import { probeDoctorManagementPage } from "./doctor-management-page.js";
import { ServiceController, type ServiceScope, type ServiceSpec } from "./service-manager.js";
import { parseRuntimeConfig } from "./runtime-config-validator.js";
import type { ScopeOptions } from "./cli/command-options.js";
import packageMetadata from "../package.json" with { type: "json" };
import { resolveServiceRuntimeContractId } from "./service-runtime-contract.js";
import {
    inspectServiceNodeRuntime,
    type DoctorServiceRuntimeInspection,
} from "./doctor-service-runtime.js";
import { inspectServiceEntry, type DoctorServiceEntryInspection } from "./doctor-service-entry.js";
import { inspectPersistedCredentialPermissions } from "./persisted-credential-permissions.js";
import { inspectPersistedManagementCredentials } from "./management-credentials.js";
import { inspectDoctorServiceStateDirectory } from "./doctor-service-state.js";
import { inspectSensitiveFilePermissions } from "./doctor-permissions.js";

export type ServiceStatusKind =
    | "uninstalled"
    | "stopped"
    | "ready"
    | "pending_configuration"
    | "version_unverified"
    | "unavailable";

export interface ServiceStatusReport {
    schemaVersion: 1;
    generatedAt: string;
    application: {
        name: string;
        version: string;
    };
    target: {
        scope: ServiceScope;
        configPath: string | null;
        baseUrl: string | null;
        webUrl: string | null;
    };
    status: ServiceStatusKind;
    ok: boolean;
    processManager: {
        installed: boolean | null;
        running: boolean | null;
        detail: string | null;
        error: string | null;
    };
    serviceDefinition: {
        path: string | null;
        current: boolean | null;
        error: string | null;
    };
    serviceRuntime: {
        valid: boolean | null;
        checks: DoctorCheck[];
    };
    probe: {
        checks: DoctorCheck[];
        error: string | null;
    };
}

export interface ServiceStatusResult {
    output: string;
    exitCode?: number;
    raw?: boolean;
}

export interface ServiceStatusDependencies {
    inspectNode(nodePath: string): DoctorServiceRuntimeInspection;
    inspectEntry(binPath: string): DoctorServiceEntryInspection;
}

const serviceStatusDependencies: ServiceStatusDependencies = {
    inspectNode: inspectServiceNodeRuntime,
    inspectEntry: inspectServiceEntry,
};

/** 同时检查进程管理器与网关探针，并生成文本或稳定 JSON 证据。 */
export async function inspectServiceStatus(
    options: ScopeOptions & { json?: boolean },
    fetcher: typeof fetch = fetch,
    dependencies: ServiceStatusDependencies = serviceStatusDependencies,
): Promise<ServiceStatusResult> {
    const scope = options.system ? "system" : "user";
    const controller = new ServiceController(scope);
    const metadata = inspectDoctorServiceMetadata(controller);
    if (metadata.error) {
        return formatServiceStatusResult(
            createServiceStatusReport(
                scope,
                "unavailable",
                { installed: null, running: null, detail: null, error: metadata.error },
                { error: "服务元数据不可用，未执行 HTTP 探测" },
            ),
            options.json,
        );
    }
    const status = controller.status(metadata.spec);
    const serviceDefinition = inspectStatusServiceDefinition(controller, metadata.spec);
    const serviceRuntime = inspectStatusServiceRuntime(controller, metadata.spec, dependencies);
    const processManager = {
        installed: status.installed,
        running: status.error ? null : status.running,
        detail: status.detail?.trim() || null,
        error: status.error ?? null,
    };
    if (status.error) {
        return formatServiceStatusResult(
            createServiceStatusReport(scope, "unavailable", processManager, {
                ...(metadata.spec ? { configPath: metadata.spec.configPath } : {}),
                serviceDefinition,
                serviceRuntime,
                error: "进程管理器状态不可用，未执行 HTTP 探测",
            }),
            options.json,
        );
    }
    if (!status.installed) {
        return formatServiceStatusResult(
            createServiceStatusReport(scope, "uninstalled", processManager, {
                ...(metadata.spec ? { configPath: metadata.spec.configPath } : {}),
                serviceDefinition,
                serviceRuntime,
            }),
            options.json,
        );
    }
    if (!status.running) {
        return formatServiceStatusResult(
            createServiceStatusReport(scope, "stopped", processManager, {
                ...(metadata.spec ? { configPath: metadata.spec.configPath } : {}),
                serviceDefinition,
                serviceRuntime,
            }),
            options.json,
        );
    }

    const spec = metadata.spec;
    if (!spec) {
        return formatServiceStatusResult(
            createServiceStatusReport(scope, "unavailable", processManager, {
                error: "服务元数据缺失",
            }),
            options.json,
        );
    }
    if (serviceDefinition.current !== true) {
        return formatServiceStatusResult(
            createServiceStatusReport(scope, "unavailable", processManager, {
                configPath: spec.configPath,
                serviceDefinition,
                serviceRuntime,
                error: `${serviceDefinition.error ?? "服务平台定义与元数据不一致"}，未执行 HTTP 探测`,
            }),
            options.json,
        );
    }
    try {
        const config = parseRuntimeConfig(fs.readFileSync(spec.configPath, "utf8"));
        const baseUrl = resolveGatewayBaseUrl(config);
        const webUrl = resolveManagementWebUrl(config);
        const endpointChecks = await Promise.all(
            (["health", "ready"] as const).map(endpoint =>
                probeDoctorEndpoint(
                    baseUrl,
                    endpoint,
                    fetcher,
                    endpoint === "health" ? packageMetadata.version : undefined,
                ),
            ),
        );
        const identityCheck = compareDoctorEndpointIdentities(
            endpointChecks[0]!,
            endpointChecks[1]!,
        );
        const runtimeContractCheck = verifyDoctorRuntimeContract(
            identityCheck,
            resolveServiceRuntimeContractId(spec),
        );
        const checks = [...endpointChecks, identityCheck, runtimeContractCheck];
        if (
            endpointChecks[0]!.level === "ok" &&
            identityCheck.level === "ok" &&
            runtimeContractCheck.level === "ok"
        ) {
            checks.push(await probeDoctorManagementPage(webUrl, config.path, fetcher));
        }
        const hasError =
            serviceRuntime.valid === false || checks.some(check => check.level === "error");
        const hasWarning = checks.some(check => check.level === "warning");
        const runtimeVersionUnverified = checks[0]?.level === "warning";
        const kind: ServiceStatusKind = hasError
            ? "unavailable"
            : runtimeVersionUnverified
              ? "version_unverified"
              : hasWarning
                ? "pending_configuration"
                : "ready";
        return formatServiceStatusResult(
            createServiceStatusReport(scope, kind, processManager, {
                configPath: spec.configPath,
                baseUrl,
                webUrl,
                checks,
                serviceDefinition,
                serviceRuntime,
            }),
            options.json,
        );
    } catch (error) {
        return formatServiceStatusResult(
            createServiceStatusReport(scope, "unavailable", processManager, {
                configPath: spec.configPath,
                serviceDefinition,
                serviceRuntime,
                error: `配置读取失败: ${error instanceof Error ? error.message : String(error)}`,
            }),
            options.json,
        );
    }
}

interface ServiceStatusReportEvidence {
    configPath?: string;
    baseUrl?: string;
    webUrl?: string;
    checks?: DoctorCheck[];
    error?: string;
    serviceDefinition?: ServiceStatusReport["serviceDefinition"];
    serviceRuntime?: ServiceStatusReport["serviceRuntime"];
}

function createServiceStatusReport(
    scope: ServiceScope,
    status: ServiceStatusKind,
    processManager: ServiceStatusReport["processManager"],
    evidence: ServiceStatusReportEvidence = {},
): ServiceStatusReport {
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        application: { name: packageMetadata.name, version: packageMetadata.version },
        target: {
            scope,
            configPath: evidence.configPath ?? null,
            baseUrl: evidence.baseUrl ?? null,
            webUrl: evidence.webUrl ?? null,
        },
        status,
        ok: status === "ready" || status === "pending_configuration",
        processManager,
        serviceDefinition: evidence.serviceDefinition ?? {
            path: null,
            current: null,
            error: null,
        },
        serviceRuntime: evidence.serviceRuntime ?? {
            valid: null,
            checks: [],
        },
        probe: {
            checks: evidence.checks ?? [],
            error: evidence.error ?? null,
        },
    };
}

function formatServiceStatusResult(report: ServiceStatusReport, json = false): ServiceStatusResult {
    const exitCode = report.ok ? undefined : report.status === "uninstalled" ? 2 : 1;
    if (json) {
        return { output: JSON.stringify(report, null, 2), exitCode, raw: true };
    }
    if (report.target.configPath === null && report.probe.error) {
        return {
            output: report.processManager.error ?? report.probe.error,
            exitCode,
        };
    }
    const summary: Record<ServiceStatusKind, string> = {
        uninstalled: "未安装",
        stopped: "已安装，未运行",
        ready: "运行中，已就绪",
        pending_configuration: "运行中，待配置",
        version_unverified: "运行中，版本未验证",
        unavailable: report.probe.error ? "运行中，状态无法验证" : "运行中，不可用",
    };
    return {
        output: [
            summary[report.status],
            ...(report.processManager.detail
                ? [`进程管理器: ${report.processManager.detail}`]
                : []),
            ...(report.serviceDefinition.path
                ? [
                      report.serviceDefinition.current
                          ? `服务定义: 与元数据一致 (${report.serviceDefinition.path})`
                          : `服务定义: ${report.serviceDefinition.error ?? "与元数据不一致"}`,
                  ]
                : []),
            ...report.serviceRuntime.checks.map(check => check.message),
            ...report.probe.checks.map(check => check.message),
            ...(report.probe.error ? [report.probe.error] : []),
        ].join("\n"),
        exitCode,
    };
}

function inspectStatusServiceRuntime(
    controller: ServiceController,
    spec: ServiceSpec | null,
    dependencies: ServiceStatusDependencies,
): ServiceStatusReport["serviceRuntime"] {
    if (!spec) return { valid: null, checks: [] };
    const runtime = dependencies.inspectNode(spec.nodePath);
    const entry = dependencies.inspectEntry(spec.binPath);
    const credentialCheck = inspectStatusPersistedCredentials(spec.configPath);
    const permissionChecks = inspectStatusCredentialPermissions(spec.configPath);
    const controlPlaneChecks = inspectStatusServiceControlPlane(controller, spec);
    return {
        valid:
            runtime.supported &&
            entry.valid &&
            credentialCheck.level !== "error" &&
            permissionChecks.every(check => check.level !== "error") &&
            controlPlaneChecks.every(check => check.level !== "error"),
        checks: [
            runtime.check,
            entry.check,
            credentialCheck,
            ...permissionChecks,
            ...controlPlaneChecks,
        ],
    };
}

function inspectStatusServiceControlPlane(
    controller: ServiceController,
    spec: ServiceSpec,
): DoctorCheck[] {
    const paths = controller.paths();
    const checks = [inspectDoctorServiceStateDirectory(paths.stateDir)];
    if (process.platform === "win32") return checks;
    return [
        ...checks,
        inspectStatusServiceMetadataPermissions(paths.metadata),
        inspectDoctorServiceDefinitionPermissions(controller.definitionPath(spec)),
    ];
}

function inspectStatusServiceMetadataPermissions(metadataPath: string): DoctorCheck {
    try {
        return inspectSensitiveFilePermissions(metadataPath, "service-metadata-mode", "服务元数据");
    } catch {
        return {
            name: "service-metadata-mode",
            level: "error",
            message: `服务元数据权限无法验证: ${metadataPath}`,
        };
    }
}

function inspectStatusPersistedCredentials(configPath: string): DoctorCheck {
    try {
        const config = parseRuntimeConfig(fs.readFileSync(configPath, "utf8"));
        return inspectPersistedManagementCredentials(config);
    } catch (error) {
        const code =
            error instanceof Error && "code" in error && typeof error.code === "string"
                ? error.code
                : "INVALID";
        return {
            name: "service-credentials",
            level: "error",
            message: `持久化管理凭据无法验证：服务配置无法读取或结构无效 (${code})`,
        };
    }
}

function inspectStatusCredentialPermissions(configPath: string): DoctorCheck[] {
    try {
        return inspectPersistedCredentialPermissions(configPath);
    } catch (error) {
        const code =
            error instanceof Error && "code" in error && typeof error.code === "string"
                ? error.code
                : "UNKNOWN";
        return [
            {
                name: "config-mode",
                level: "error",
                message: `持久化凭据权限无法验证: ${configPath} (${code})`,
            },
        ];
    }
}

function inspectStatusServiceDefinition(
    controller: ServiceController,
    spec: ServiceSpec | null,
): ServiceStatusReport["serviceDefinition"] {
    if (!spec) return { path: null, current: null, error: null };
    const inspection = inspectDoctorServiceDefinition(controller, spec);
    return {
        path: controller.definitionPath(spec),
        current: inspection.current,
        error:
            inspection.error ??
            (inspection.current
                ? null
                : "服务平台定义与服务元数据不一致，请重新执行 onebots install"),
    };
}
