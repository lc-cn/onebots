import * as fs from "node:fs";
import type { DoctorCheck } from "./doctor-endpoint.js";
import {
    compareDoctorEndpointIdentities,
    probeDoctorEndpoint,
    resolveGatewayBaseUrl,
} from "./doctor-endpoint.js";
import { inspectDoctorServiceMetadata } from "./doctor-service-metadata.js";
import { ServiceController, type ServiceScope } from "./service-manager.js";
import { parseRuntimeConfig } from "./runtime-config-validator.js";
import type { ScopeOptions } from "./cli/command-options.js";
import packageMetadata from "../package.json" with { type: "json" };

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
    };
    status: ServiceStatusKind;
    ok: boolean;
    processManager: {
        installed: boolean | null;
        running: boolean | null;
        detail: string | null;
        error: string | null;
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

/** 同时检查进程管理器与网关探针，并生成文本或稳定 JSON 证据。 */
export async function inspectServiceStatus(
    options: ScopeOptions & { json?: boolean },
    fetcher: typeof fetch = fetch,
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
                error: "进程管理器状态不可用，未执行 HTTP 探测",
            }),
            options.json,
        );
    }
    if (!status.installed) {
        return formatServiceStatusResult(
            createServiceStatusReport(scope, "uninstalled", processManager),
            options.json,
        );
    }
    if (!status.running) {
        return formatServiceStatusResult(
            createServiceStatusReport(scope, "stopped", processManager),
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
    try {
        const config = parseRuntimeConfig(fs.readFileSync(spec.configPath, "utf8"));
        const baseUrl = resolveGatewayBaseUrl(config);
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
        const checks = [
            ...endpointChecks,
            compareDoctorEndpointIdentities(endpointChecks[0]!, endpointChecks[1]!),
        ];
        const hasError = checks.some(check => check.level === "error");
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
                checks,
            }),
            options.json,
        );
    } catch (error) {
        return formatServiceStatusResult(
            createServiceStatusReport(scope, "unavailable", processManager, {
                configPath: spec.configPath,
                error: `配置读取失败: ${error instanceof Error ? error.message : String(error)}`,
            }),
            options.json,
        );
    }
}

interface ServiceStatusReportEvidence {
    configPath?: string;
    baseUrl?: string;
    checks?: DoctorCheck[];
    error?: string;
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
        },
        status,
        ok: status === "ready" || status === "pending_configuration",
        processManager,
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
            ...report.probe.checks.map(check => check.message),
            ...(report.probe.error ? [report.probe.error] : []),
        ].join("\n"),
        exitCode,
    };
}
