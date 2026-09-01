import { randomUUID } from "node:crypto";
import type { Adapter } from "./adapter.js";
import { metrics } from "./metrics.js";
import type { Router } from "./router.js";
import type { RuntimeOperation } from "./runtime-operation.js";

const runtimeInstanceId = randomUUID();
const runtimeStartedAt = new Date(Date.now() - process.uptime() * 1_000).toISOString();

export interface RuntimeProcessIdentity {
    instanceId: string;
    startedAt: string;
}

/** 返回当前进程内所有 BaseApp 共享的稳定运行时身份。 */
export function getRuntimeProcessIdentity(): Readonly<RuntimeProcessIdentity> {
    return {
        instanceId: runtimeInstanceId,
        startedAt: runtimeStartedAt,
    };
}

interface ObservableApp {
    readonly router: Router;
    readonly adapters: ReadonlyMap<keyof Adapter.Configs, Adapter>;
    readonly isStarted: boolean;
    readonly isReloading: boolean;
    /** 当前撤销 readiness 的运行态操作；嵌入式宿主可省略并得到 unknown。 */
    readonly runtimeOperation?: RuntimeOperation;
    /** OneBots 主应用提供磁盘配置状态；嵌入式 BaseApp 可不跟踪。 */
    readonly runtimeConfigState?: { status: string };
    /** 主应用可提供不包含原始路径或参数的启动契约摘要。 */
    readonly runtimeContractId?: string;
}

export interface ApplicationIdentity {
    name: string;
    version: string;
}

export interface RuntimeIdentity extends ApplicationIdentity {
    coreVersion: string;
}

interface ProtocolReadinessCounts {
    ready: number;
    unavailable: number;
    total: number;
}

interface AdapterReadinessCounts {
    online: number;
    offline: number;
    total: number;
    accounts_without_protocols: number;
    protocols: ProtocolReadinessCounts;
}

export interface ReadinessSnapshot {
    ready: boolean;
    timestamp: string;
    server: boolean;
    reloading: boolean;
    runtime_operation: RuntimeOperation;
    configured: boolean;
    config: {
        status: "in_sync" | "drifted" | "unavailable" | "untracked";
        in_sync: boolean;
    };
    adapters: Record<string, AdapterReadinessCounts>;
    summary: {
        total_adapters: number;
        total_accounts: number;
        online_accounts: number;
        total_protocols: number;
        ready_protocols: number;
        accounts_without_protocols: number;
    };
}

export interface ReadinessResponse extends ReadinessSnapshot {
    application: string;
    version: string;
    core_version: string;
    instance_id: string;
    started_at: string;
    runtime_contract_id?: string;
}

/** 生成与 HTTP 无关的就绪快照，便于部署探针和测试共享同一判定。 */
export function getReadinessSnapshot(app: ObservableApp): ReadinessSnapshot {
    const adapters: Record<string, AdapterReadinessCounts> = {};
    let allReady = true;
    let totalOnline = 0;
    let totalAccounts = 0;
    let totalProtocols = 0;
    let readyProtocols = 0;
    let accountsWithoutProtocols = 0;
    const configStatus = normalizeConfigStatus(app.runtimeConfigState?.status);
    const configInSync = configStatus === "in_sync" || configStatus === "untracked";
    const runtimeOperation = normalizeRuntimeOperation(app.isReloading, app.runtimeOperation);

    for (const [platform, adapter] of app.adapters) {
        let online = 0;
        let offline = 0;
        let adapterProtocols = 0;
        let adapterReadyProtocols = 0;
        let adapterAccountsWithoutProtocols = 0;
        for (const account of adapter.accounts.values()) {
            totalAccounts++;
            if (account.status === "online") {
                online++;
                totalOnline++;
            } else {
                offline++;
            }
            if (account.protocols.length === 0) {
                adapterAccountsWithoutProtocols++;
                accountsWithoutProtocols++;
            }
            for (const protocol of account.protocols) {
                adapterProtocols++;
                totalProtocols++;
                if (protocol.lifecycleStatus === "ready") {
                    adapterReadyProtocols++;
                    readyProtocols++;
                }
            }
        }
        const unavailableProtocols = adapterProtocols - adapterReadyProtocols;
        adapters[String(platform)] = {
            online,
            offline,
            total: online + offline,
            accounts_without_protocols: adapterAccountsWithoutProtocols,
            protocols: {
                ready: adapterReadyProtocols,
                unavailable: unavailableProtocols,
                total: adapterProtocols,
            },
        };
        if (offline > 0 || unavailableProtocols > 0 || adapterAccountsWithoutProtocols > 0) {
            allReady = false;
        }
    }

    return {
        ready: allReady && app.isStarted && !app.isReloading && configInSync,
        timestamp: new Date().toISOString(),
        server: app.isStarted,
        reloading: app.isReloading,
        runtime_operation: runtimeOperation,
        configured: totalAccounts > 0,
        config: {
            status: configStatus,
            in_sync: configInSync,
        },
        adapters,
        summary: {
            total_adapters: app.adapters.size,
            total_accounts: totalAccounts,
            online_accounts: totalOnline,
            total_protocols: totalProtocols,
            ready_protocols: readyProtocols,
            accounts_without_protocols: accountsWithoutProtocols,
        },
    };
}

function normalizeRuntimeOperation(
    isReloading: boolean,
    operation: RuntimeOperation | undefined,
): RuntimeOperation {
    if (!isReloading) return "idle";
    return operation === "configuration_reload" ||
        operation === "account_configuration" ||
        operation === "account_lifecycle"
        ? operation
        : "unknown";
}

function normalizeConfigStatus(status: string | undefined): ReadinessSnapshot["config"]["status"] {
    if (status === undefined) return "untracked";
    return status === "in_sync" || status === "drifted" || status === "unavailable"
        ? status
        : "unavailable";
}

export function formatProtocolReadinessMetrics(snapshot: ReadinessSnapshot): string[] {
    const lines = [
        "# HELP onebots_protocols_total Total protocol instances by platform and readiness",
        "# TYPE onebots_protocols_total gauge",
    ];
    for (const [platform, state] of Object.entries(snapshot.adapters)) {
        const label = escapePrometheusLabel(platform);
        lines.push(
            `onebots_protocols_total{platform="${label}",status="ready"} ${state.protocols.ready}`,
            `onebots_protocols_total{platform="${label}",status="unavailable"} ${state.protocols.unavailable}`,
        );
    }
    lines.push(
        "# HELP onebots_accounts_without_protocols Number of accounts without a protocol outlet by platform",
        "# TYPE onebots_accounts_without_protocols gauge",
    );
    for (const [platform, state] of Object.entries(snapshot.adapters)) {
        const label = escapePrometheusLabel(platform);
        lines.push(
            `onebots_accounts_without_protocols{platform="${label}"} ${state.accounts_without_protocols}`,
        );
    }
    return lines;
}

function escapePrometheusLabel(value: string): string {
    return value.replace(/\\/gu, "\\\\").replace(/\n/gu, "\\n").replace(/"/gu, '\\"');
}

/** 观测结果描述当前进程瞬时状态，禁止浏览器或中间代理复用旧证据。 */
function preventObservabilityCaching(ctx: { set(field: string, value: string): unknown }): void {
    ctx.set("Cache-Control", "no-store");
}

/** 注册不依赖管理端鉴权的存活、就绪与 Prometheus 端点。 */
export function registerObservabilityEndpoints(
    app: ObservableApp,
    identity: RuntimeIdentity,
): void {
    app.router.get("/health", ctx => {
        preventObservabilityCaching(ctx);
        const processIdentity = getRuntimeProcessIdentity();
        ctx.body = {
            status: "ok",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            instance_id: processIdentity.instanceId,
            started_at: processIdentity.startedAt,
            application: identity.name,
            version: identity.version,
            core_version: identity.coreVersion,
            ...(app.runtimeContractId ? { runtime_contract_id: app.runtimeContractId } : {}),
        };
    });

    app.router.get("/ready", ctx => {
        preventObservabilityCaching(ctx);
        const snapshot = getReadinessSnapshot(app);
        const processIdentity = getRuntimeProcessIdentity();
        ctx.status = snapshot.ready ? 200 : 503;
        ctx.body = {
            ...snapshot,
            application: identity.name,
            version: identity.version,
            core_version: identity.coreVersion,
            instance_id: processIdentity.instanceId,
            started_at: processIdentity.startedAt,
            ...(app.runtimeContractId ? { runtime_contract_id: app.runtimeContractId } : {}),
        } satisfies ReadinessResponse;
    });

    app.router.get("/metrics", ctx => {
        preventObservabilityCaching(ctx);
        const memory = process.memoryUsage();
        const readiness = getReadinessSnapshot(app);
        const lines = [
            "# HELP onebots_info OneBots application info",
            "# TYPE onebots_info gauge",
            `onebots_info{version="${escapePrometheusLabel(identity.version)}"} 1`,
            "# HELP onebots_core_info OneBots core runtime info",
            "# TYPE onebots_core_info gauge",
            `onebots_core_info{version="${escapePrometheusLabel(identity.coreVersion)}"} 1`,
            "# HELP onebots_uptime_seconds Application uptime in seconds",
            "# TYPE onebots_uptime_seconds gauge",
            `onebots_uptime_seconds ${process.uptime()}`,
            "# HELP onebots_started Whether the application is started",
            "# TYPE onebots_started gauge",
            `onebots_started ${app.isStarted ? 1 : 0}`,
            "# HELP onebots_reloading Whether an exclusive runtime operation has withdrawn readiness",
            "# TYPE onebots_reloading gauge",
            `onebots_reloading ${app.isReloading ? 1 : 0}`,
            "# HELP onebots_runtime_operation Active exclusive runtime operation by kind",
            "# TYPE onebots_runtime_operation gauge",
            ...(
                [
                    "idle",
                    "configuration_reload",
                    "account_configuration",
                    "account_lifecycle",
                    "unknown",
                ] as const
            ).map(
                operation =>
                    `onebots_runtime_operation{operation="${operation}"} ${readiness.runtime_operation === operation ? 1 : 0}`,
            ),
            "# HELP onebots_config_in_sync Whether disk configuration matches the active runtime",
            "# TYPE onebots_config_in_sync gauge",
            `onebots_config_in_sync ${readiness.config.in_sync ? 1 : 0}`,
            "# HELP onebots_memory_bytes Memory usage in bytes",
            "# TYPE onebots_memory_bytes gauge",
            `onebots_memory_bytes{type="rss"} ${memory.rss}`,
            `onebots_memory_bytes{type="heapTotal"} ${memory.heapTotal}`,
            `onebots_memory_bytes{type="heapUsed"} ${memory.heapUsed}`,
            `onebots_memory_bytes{type="external"} ${memory.external}`,
            "# HELP onebots_adapters_total Total number of adapters",
            "# TYPE onebots_adapters_total gauge",
            `onebots_adapters_total ${app.adapters.size}`,
            "# HELP onebots_accounts_total Total accounts by platform and status",
            "# TYPE onebots_accounts_total gauge",
        ];

        for (const [platform, adapter] of app.adapters) {
            const platformLabel = escapePrometheusLabel(String(platform));
            let online = 0;
            let offline = 0;
            for (const account of adapter.accounts.values()) {
                if (account.status === "online") online++;
                else offline++;
            }
            lines.push(
                `onebots_accounts_total{platform="${platformLabel}",status="online"} ${online}`,
                `onebots_accounts_total{platform="${platformLabel}",status="offline"} ${offline}`,
            );
        }

        lines.push(...formatProtocolReadinessMetrics(readiness));

        const performance = metrics.exportPrometheus().trim();
        if (performance) lines.push("", "# Performance metrics", performance);
        ctx.type = "text/plain; charset=utf-8";
        ctx.body = `${lines.join("\n")}\n`;
    });
}
