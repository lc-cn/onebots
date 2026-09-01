import { buildApiUrl } from "../config";
import {
    DEFAULT_SERVICE_PROBE_TIMEOUT_MS,
    runServiceProbe,
    ServiceProbeTimeoutError,
} from "./service-probe-request";

export type ServiceProbeState = "success" | "warning" | "danger";

export interface ServiceProbeIdentity {
    application: string;
    version: string;
    instanceId: string;
    runtimeContractId: string;
}

export interface ServiceProbeResult {
    state: ServiceProbeState;
    label: string;
    detail: string;
    identity?: ServiceProbeIdentity;
}

interface ReadinessSummary {
    total_accounts: number;
    online_accounts: number;
    total_protocols: number;
    ready_protocols: number;
    accounts_without_protocols: number;
}

interface ReadinessPayload {
    ready: boolean;
    application: string;
    version: string;
    core_version: string;
    instance_id: string;
    started_at: string;
    runtime_contract_id: string;
    configured: boolean;
    server: boolean;
    reloading: boolean;
    config: {
        status: string;
        in_sync: boolean;
    };
    summary: ReadinessSummary;
}

export function pendingReadinessProbe(): ServiceProbeResult {
    return {
        state: "warning",
        label: "检查中",
        detail: "正在读取服务就绪证据",
    };
}

export async function probeHealth(
    fetcher: typeof fetch = fetch,
    timeoutMs = DEFAULT_SERVICE_PROBE_TIMEOUT_MS,
): Promise<ServiceProbeResult> {
    try {
        const { response, payload } = await runServiceProbe(async signal => {
            const response = await fetcher(buildApiUrl("/health") || "/health", {
                cache: "no-store",
                signal,
            });
            const payload: unknown = response.ok ? await response.json() : null;
            return { response, payload };
        }, timeoutMs);
        if (!response.ok) return danger("存活异常", `health HTTP ${response.status}`);
        if (!isRecord(payload) || payload.status !== "ok") {
            return danger("证据无效", "health 未声明 status=ok");
        }
        if (payload.application !== "onebots") {
            return danger("证据无效", "health 未声明 onebots 应用身份");
        }
        if (typeof payload.version !== "string" || !payload.version.trim()) {
            return danger("证据无效", "health 未声明应用版本");
        }
        if (typeof payload.instance_id !== "string" || !payload.instance_id.trim()) {
            return danger("证据无效", "health 未声明 instance_id");
        }
        if (
            typeof payload.runtime_contract_id !== "string" ||
            !payload.runtime_contract_id.trim()
        ) {
            return danger("证据无效", "health 未声明 runtime_contract_id");
        }
        return {
            state: "success",
            label: "正常",
            detail: `OneBots ${payload.version.trim()}，实例 ${payload.instance_id.trim()}`,
            identity: {
                application: "onebots",
                version: payload.version.trim(),
                instanceId: payload.instance_id.trim(),
                runtimeContractId: payload.runtime_contract_id.trim(),
            },
        };
    } catch (error) {
        if (error instanceof ServiceProbeTimeoutError) {
            return danger("存活未知", `health 探测超时（${error.timeoutMs}ms）`);
        }
        return danger("存活未知", `health 不可达：${errorMessage(error)}`);
    }
}

export async function probeReadiness(
    fetcher: typeof fetch = fetch,
    timeoutMs = DEFAULT_SERVICE_PROBE_TIMEOUT_MS,
): Promise<ServiceProbeResult> {
    try {
        const { response, payload } = await runServiceProbe(async signal => {
            const response = await fetcher(buildApiUrl("/ready") || "/ready", {
                cache: "no-store",
                signal,
            });
            const payload: unknown = await response.json();
            return { response, payload };
        }, timeoutMs);
        if (!isReadinessPayload(payload)) {
            return danger("证据无效", "ready 响应缺少完整的账号、协议或配置状态");
        }
        const expectedStatus = payload.ready ? 200 : 503;
        if (response.status !== expectedStatus) {
            return danger("证据无效", `ready=${payload.ready} 与 HTTP ${response.status} 不一致`);
        }
        const detail = formatReadinessDetail(payload);
        const identity = readinessIdentity(payload);
        if (!payload.ready) return { ...danger("未就绪", detail), identity };
        if (!payload.configured) {
            return {
                state: "warning",
                label: "待配置",
                detail: `服务可管理，尚未配置机器人账号；${formatReadinessIdentity(payload)}`,
                identity,
            };
        }
        return {
            state: "success",
            label: "生产就绪",
            detail,
            identity,
        };
    } catch (error) {
        if (error instanceof ServiceProbeTimeoutError) {
            return danger("就绪未知", `ready 探测超时（${error.timeoutMs}ms）`);
        }
        return danger("就绪未知", `ready 不可达：${errorMessage(error)}`);
    }
}

/** 保留 readiness 结论，但拒绝将两个不同实例的探针拼成同一服务状态。 */
export function reconcileServiceProbeInstances(
    health: ServiceProbeResult,
    readiness: ServiceProbeResult,
): ServiceProbeResult {
    if (!health.identity || !readiness.identity) return readiness;
    if (
        health.identity.application === readiness.identity.application &&
        health.identity.version === readiness.identity.version &&
        health.identity.instanceId === readiness.identity.instanceId &&
        health.identity.runtimeContractId === readiness.identity.runtimeContractId
    ) {
        return readiness;
    }
    return danger(
        "证据冲突",
        `health 来自 ${formatProbeIdentity(health.identity)}，ready 来自 ${formatProbeIdentity(readiness.identity)}，拒绝拼接不一致的探针证据`,
    );
}

function formatReadinessDetail(payload: ReadinessPayload): string {
    const { summary } = payload;
    const parts = [
        formatReadinessIdentity(payload),
        `账号 ${summary.online_accounts}/${summary.total_accounts} 在线`,
        `协议出口 ${summary.ready_protocols}/${summary.total_protocols} 就绪`,
    ];
    if (summary.accounts_without_protocols > 0) {
        parts.push(`${summary.accounts_without_protocols} 个账号没有协议出口`);
    }
    if (!payload.config.in_sync) parts.push(`配置状态 ${payload.config.status}`);
    if (payload.reloading) parts.push("正在重载");
    if (!payload.server) parts.push("HTTP 服务未启动");
    return parts.join("，");
}

function formatReadinessIdentity(payload: ReadinessPayload): string {
    return `OneBots ${payload.version}，实例 ${payload.instance_id}`;
}

function readinessIdentity(payload: ReadinessPayload): ServiceProbeIdentity {
    return {
        application: payload.application,
        version: payload.version.trim(),
        instanceId: payload.instance_id.trim(),
        runtimeContractId: payload.runtime_contract_id.trim(),
    };
}

function formatProbeIdentity(identity: ServiceProbeIdentity): string {
    return `${identity.application}@${identity.version} 实例 ${identity.instanceId}`;
}

function isReadinessPayload(value: unknown): value is ReadinessPayload {
    if (!isRecord(value) || !isRecord(value.config) || !isRecord(value.summary)) return false;
    if (
        typeof value.ready !== "boolean" ||
        value.application !== "onebots" ||
        typeof value.version !== "string" ||
        !value.version.trim() ||
        typeof value.core_version !== "string" ||
        !value.core_version.trim() ||
        typeof value.instance_id !== "string" ||
        !value.instance_id.trim() ||
        typeof value.runtime_contract_id !== "string" ||
        !value.runtime_contract_id.trim() ||
        typeof value.started_at !== "string" ||
        !value.started_at.trim() ||
        typeof value.configured !== "boolean" ||
        typeof value.server !== "boolean" ||
        typeof value.reloading !== "boolean" ||
        typeof value.config.status !== "string" ||
        typeof value.config.in_sync !== "boolean"
    ) {
        return false;
    }
    const totalAccounts = value.summary.total_accounts;
    const onlineAccounts = value.summary.online_accounts;
    const totalProtocols = value.summary.total_protocols;
    const readyProtocols = value.summary.ready_protocols;
    const accountsWithoutProtocols = value.summary.accounts_without_protocols;
    if (
        !isNonNegativeNumber(totalAccounts) ||
        !isNonNegativeNumber(onlineAccounts) ||
        !isNonNegativeNumber(totalProtocols) ||
        !isNonNegativeNumber(readyProtocols) ||
        !isNonNegativeNumber(accountsWithoutProtocols)
    ) {
        return false;
    }

    const configuredFromCounts = totalAccounts > 0;
    const countsAreCoherent =
        onlineAccounts <= totalAccounts &&
        readyProtocols <= totalProtocols &&
        accountsWithoutProtocols <= totalAccounts &&
        value.configured === configuredFromCounts;
    if (!countsAreCoherent) return false;

    return (
        !value.ready ||
        (value.server &&
            !value.reloading &&
            value.config.in_sync &&
            onlineAccounts === totalAccounts &&
            readyProtocols === totalProtocols &&
            accountsWithoutProtocols === 0)
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isNonNegativeNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function danger(label: string, detail: string): ServiceProbeResult {
    return { state: "danger", label, detail };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
