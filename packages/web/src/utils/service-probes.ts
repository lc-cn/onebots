import { buildApiUrl } from "../config";

export type ServiceProbeState = "success" | "warning" | "danger";

export interface ServiceProbeResult {
    state: ServiceProbeState;
    label: string;
    detail: string;
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

export async function probeHealth(fetcher: typeof fetch = fetch): Promise<ServiceProbeResult> {
    try {
        const response = await fetcher(buildApiUrl("/health") || "/health", {
            cache: "no-store",
        });
        if (!response.ok) return danger("存活异常", `health HTTP ${response.status}`);
        const payload: unknown = await response.json();
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
        return {
            state: "success",
            label: "正常",
            detail: `OneBots ${payload.version.trim()}，实例 ${payload.instance_id.trim()}`,
        };
    } catch (error) {
        return danger("存活未知", `health 不可达：${errorMessage(error)}`);
    }
}

export async function probeReadiness(fetcher: typeof fetch = fetch): Promise<ServiceProbeResult> {
    try {
        const response = await fetcher(buildApiUrl("/ready") || "/ready", {
            cache: "no-store",
        });
        const payload: unknown = await response.json();
        if (!isReadinessPayload(payload)) {
            return danger("证据无效", "ready 响应缺少完整的账号、协议或配置状态");
        }
        const expectedStatus = payload.ready ? 200 : 503;
        if (response.status !== expectedStatus) {
            return danger("证据无效", `ready=${payload.ready} 与 HTTP ${response.status} 不一致`);
        }
        const detail = formatReadinessDetail(payload);
        if (!payload.ready) return danger("未就绪", detail);
        if (!payload.configured) {
            return {
                state: "warning",
                label: "待配置",
                detail: "服务可管理，尚未配置机器人账号",
            };
        }
        return {
            state: "success",
            label: "生产就绪",
            detail,
        };
    } catch (error) {
        return danger("就绪未知", `ready 不可达：${errorMessage(error)}`);
    }
}

function formatReadinessDetail(payload: ReadinessPayload): string {
    const { summary } = payload;
    const parts = [
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

function isReadinessPayload(value: unknown): value is ReadinessPayload {
    if (!isRecord(value) || !isRecord(value.config) || !isRecord(value.summary)) return false;
    if (
        typeof value.ready !== "boolean" ||
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
