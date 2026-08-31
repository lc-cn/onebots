import packageMetadata from "../package.json" with { type: "json" };
import { normalizeGatewayPathPrefix } from "@onebots/core";

export type CheckLevel = "ok" | "warning" | "error";

export interface DoctorEndpointIdentity {
    application: string;
    version: string;
    instanceId: string;
}

export interface DoctorCheck {
    name: string;
    level: CheckLevel;
    message: string;
    fixed?: boolean;
    identity?: DoctorEndpointIdentity;
}

/** 根据运行时配置生成本机管理与可观测端点的根 URL。 */
export function resolveGatewayBaseUrl(config: Record<string, unknown>): string {
    const port = Number(config.port ?? 6727);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new TypeError("网关 port 必须是 1 到 65535 之间的整数");
    }
    const prefix = normalizeGatewayPathPrefix(config.path ?? "");
    return `http://127.0.0.1:${port}${prefix}`;
}

type DoctorEndpoint = "health" | "ready";
type DoctorFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** 探测运行中网关的健康端点；非 2xx 必须使 doctor 失败。 */
export async function probeDoctorEndpoint(
    base: string,
    endpoint: DoctorEndpoint,
    fetcher: DoctorFetch = fetch,
    expectedVersion?: string,
): Promise<DoctorCheck> {
    try {
        const response = await fetcher(`${base}/${endpoint}`, {
            cache: "no-store",
            signal: AbortSignal.timeout(2_000),
        });
        const body = await response.text();
        const detail = summarizeEndpointBody(endpoint, body);
        const semanticError = response.ok ? validateEndpointBody(endpoint, body) : undefined;
        const versionWarning =
            endpoint === "health" && response.ok && !semanticError && expectedVersion
                ? validateHealthVersion(body, expectedVersion)
                : undefined;
        const configurationPending =
            endpoint === "ready" && response.ok && !semanticError && isConfigurationPending(body);
        const identity = readEndpointIdentity(body);
        return {
            name: endpoint,
            level:
                response.ok && !semanticError
                    ? configurationPending || versionWarning
                        ? "warning"
                        : "ok"
                    : "error",
            message: `${endpoint}: HTTP ${response.status}${detail}${semanticError ? `；${semanticError}` : ""}${versionWarning ? `；${versionWarning}` : ""}`,
            ...(identity ? { identity } : {}),
        };
    } catch (error) {
        return {
            name: endpoint,
            level: "error",
            message: `${endpoint} 不可达: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/** 证明两份独立 HTTP 探针来自同一个应用版本和进程实例。 */
export function compareDoctorEndpointIdentities(
    health: DoctorCheck,
    readiness: DoctorCheck,
): DoctorCheck {
    if (!health.identity || !readiness.identity) {
        const missing = [
            ...(!health.identity ? ["health"] : []),
            ...(!readiness.identity ? ["ready"] : []),
        ];
        return {
            name: "probe-instance",
            level: "error",
            message: `${missing.join(" 与 ")} 缺少完整应用、版本或 instance_id，无法证明探针来自同一实例`,
        };
    }
    const healthLabel = formatEndpointIdentity(health.identity);
    const readinessLabel = formatEndpointIdentity(readiness.identity);
    if (
        health.identity.application !== readiness.identity.application ||
        health.identity.version !== readiness.identity.version ||
        health.identity.instanceId !== readiness.identity.instanceId
    ) {
        return {
            name: "probe-instance",
            level: "error",
            message: `health 来自 ${healthLabel}，ready 来自 ${readinessLabel}，拒绝拼接不一致的探针证据`,
        };
    }
    return {
        name: "probe-instance",
        level: "ok",
        message: `health 与 ready 均来自 ${healthLabel}`,
        identity: health.identity,
    };
}

function summarizeEndpointBody(endpoint: DoctorEndpoint, body: string): string {
    if (!body.trim()) return "";
    try {
        const payload = JSON.parse(body) as Record<string, unknown>;
        if (endpoint !== "ready") {
            const details: string[] = [];
            if (typeof payload.status === "string") details.push(`状态 ${payload.status}`);
            if (typeof payload.version === "string") {
                const application =
                    typeof payload.application === "string" ? payload.application : "onebots";
                details.push(`${application}@${payload.version}`);
            }
            if (typeof payload.core_version === "string") {
                details.push(`@onebots/core@${payload.core_version}`);
            }
            return details.length > 0 ? `；${details.join("；")}` : "";
        }
        const summary = payload.summary as Record<string, unknown> | undefined;
        const adapters = payload.adapters as
            | Record<
                  string,
                  {
                      online?: unknown;
                      total?: unknown;
                      offline?: unknown;
                      accounts_without_protocols?: unknown;
                      protocols?: { ready?: unknown; total?: unknown; unavailable?: unknown };
                  }
              >
            | undefined;
        const details: string[] = [];
        if (typeof payload.version === "string") {
            const application =
                typeof payload.application === "string" ? payload.application : "onebots";
            details.push(`${application}@${payload.version}`);
        }
        if (typeof payload.instance_id === "string") {
            details.push(`实例 ${payload.instance_id}`);
        }
        if (payload.reloading === true) details.push("配置重载中");
        else if (payload.configured === false) details.push("未配置账号");
        const config = payload.config as { status?: unknown; in_sync?: unknown } | undefined;
        if (config?.in_sync === false) {
            const label =
                config.status === "drifted"
                    ? "磁盘配置未应用"
                    : config.status === "unavailable"
                      ? "配置文件不可读"
                      : `配置不同步（${String(config.status ?? "unknown")}）`;
            details.push(label);
        }
        if (summary) {
            details.push(
                `账号 ${Number(summary.online_accounts ?? 0)}/${Number(summary.total_accounts ?? 0)} 在线`,
            );
            if (Number(summary.total_protocols ?? 0) > 0) {
                details.push(
                    `协议 ${Number(summary.ready_protocols ?? 0)}/${Number(summary.total_protocols ?? 0)} 就绪`,
                );
            }
        }
        const unavailable = Object.entries(adapters ?? {})
            .filter(([, state]) => Number(state.offline ?? 0) > 0)
            .map(
                ([platform, state]) =>
                    `${platform}(${Number(state.online ?? 0)}/${Number(state.total ?? 0)})`,
            );
        if (unavailable.length > 0) details.push(`未就绪: ${unavailable.join(", ")}`);
        const unavailableProtocols = Object.entries(adapters ?? {})
            .filter(([, state]) => Number(state.protocols?.unavailable ?? 0) > 0)
            .map(
                ([platform, state]) =>
                    `${platform}(${Number(state.protocols?.ready ?? 0)}/${Number(state.protocols?.total ?? 0)})`,
            );
        if (unavailableProtocols.length > 0) {
            details.push(`协议未就绪: ${unavailableProtocols.join(", ")}`);
        }
        const accountsWithoutProtocols = Object.entries(adapters ?? {})
            .filter(([, state]) => Number(state.accounts_without_protocols ?? 0) > 0)
            .map(
                ([platform, state]) =>
                    `${platform}(${Number(state.accounts_without_protocols ?? 0)})`,
            );
        if (accountsWithoutProtocols.length > 0) {
            details.push(`无协议出口: ${accountsWithoutProtocols.join(", ")}`);
        }
        return details.length > 0 ? `；${details.join("；")}` : "";
    } catch {
        const singleLine = body.replace(/\s+/gu, " ").trim();
        return singleLine ? `；响应 ${singleLine.slice(0, 160)}` : "";
    }
}

function isConfigurationPending(body: string): boolean {
    try {
        const payload = JSON.parse(body) as Record<string, unknown>;
        return payload.configured === false && payload.reloading !== true;
    } catch {
        return false;
    }
}

function readEndpointIdentity(body: string): DoctorEndpointIdentity | undefined {
    try {
        const payload = JSON.parse(body) as Record<string, unknown>;
        const application =
            typeof payload.application === "string" ? payload.application.trim() : "";
        const version = typeof payload.version === "string" ? payload.version.trim() : "";
        const instanceId =
            typeof payload.instance_id === "string" ? payload.instance_id.trim() : "";
        return application && version && instanceId
            ? { application, version, instanceId }
            : undefined;
    } catch {
        return undefined;
    }
}

function formatEndpointIdentity(identity: DoctorEndpointIdentity): string {
    return `${identity.application}@${identity.version} 实例 ${identity.instanceId}`;
}

function validateEndpointBody(endpoint: DoctorEndpoint, body: string): string | undefined {
    try {
        const payload = JSON.parse(body) as Record<string, unknown>;
        if (endpoint === "health" && payload.status !== "ok") {
            return "响应未声明 status: ok";
        }
        if (endpoint === "ready" && payload.ready !== true) {
            return "响应未声明 ready: true";
        }
        if (endpoint === "ready") return validateReadinessIdentity(payload);
        return undefined;
    } catch {
        return "响应不是有效 JSON";
    }
}

function validateReadinessIdentity(payload: Record<string, unknown>): string | undefined {
    const application = typeof payload.application === "string" ? payload.application.trim() : "";
    if (!application) return "响应未声明运行应用身份";
    if (application !== packageMetadata.name) {
        return `在线应用 ${application} 不是 ${packageMetadata.name}`;
    }
    const version = typeof payload.version === "string" ? payload.version.trim() : "";
    if (!version) return "响应未声明运行版本";
    const instanceId = typeof payload.instance_id === "string" ? payload.instance_id.trim() : "";
    if (!instanceId) return "响应未声明 instance_id";
    return undefined;
}

function validateHealthVersion(body: string, expectedVersion: string): string | undefined {
    const payload = JSON.parse(body) as Record<string, unknown>;
    const runningVersion = typeof payload.version === "string" ? payload.version.trim() : "";
    if (!runningVersion) return `响应未声明运行版本（当前 CLI ${expectedVersion}）`;
    const runningApplication =
        typeof payload.application === "string" ? payload.application.trim() : "";
    if (!runningApplication) return "响应未声明运行应用身份";
    if (runningApplication !== packageMetadata.name) {
        return `在线应用 ${runningApplication} 不是 ${packageMetadata.name}`;
    }
    if (runningVersion !== expectedVersion) {
        return `在线 OneBots ${runningVersion} 与当前 CLI ${expectedVersion} 不一致；请重启或核对运行入口`;
    }
    return undefined;
}
