import type { Adapter } from "./adapter.js";
import { metrics } from "./metrics.js";
import type { Router } from "./router.js";

interface ObservableApp {
    readonly router: Router;
    readonly adapters: ReadonlyMap<keyof Adapter.Configs, Adapter>;
    readonly isStarted: boolean;
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
    protocols: ProtocolReadinessCounts;
}

export interface ReadinessSnapshot {
    ready: boolean;
    timestamp: string;
    server: boolean;
    configured: boolean;
    adapters: Record<string, AdapterReadinessCounts>;
    summary: {
        total_adapters: number;
        total_accounts: number;
        online_accounts: number;
        total_protocols: number;
        ready_protocols: number;
    };
}

/** 生成与 HTTP 无关的就绪快照，便于部署探针和测试共享同一判定。 */
export function getReadinessSnapshot(app: ObservableApp): ReadinessSnapshot {
    const adapters: Record<string, AdapterReadinessCounts> = {};
    let allReady = true;
    let totalOnline = 0;
    let totalAccounts = 0;
    let totalProtocols = 0;
    let readyProtocols = 0;

    for (const [platform, adapter] of app.adapters) {
        let online = 0;
        let offline = 0;
        let adapterProtocols = 0;
        let adapterReadyProtocols = 0;
        for (const account of adapter.accounts.values()) {
            totalAccounts++;
            if (account.status === "online") {
                online++;
                totalOnline++;
            } else {
                offline++;
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
            protocols: {
                ready: adapterReadyProtocols,
                unavailable: unavailableProtocols,
                total: adapterProtocols,
            },
        };
        if (offline > 0 || unavailableProtocols > 0) allReady = false;
    }

    return {
        ready: allReady && app.isStarted,
        timestamp: new Date().toISOString(),
        server: app.isStarted,
        configured: totalAccounts > 0,
        adapters,
        summary: {
            total_adapters: app.adapters.size,
            total_accounts: totalAccounts,
            online_accounts: totalOnline,
            total_protocols: totalProtocols,
            ready_protocols: readyProtocols,
        },
    };
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
    return lines;
}

function escapePrometheusLabel(value: string): string {
    return value.replace(/\\/gu, "\\\\").replace(/\n/gu, "\\n").replace(/"/gu, '\\"');
}

/** 注册不依赖管理端鉴权的存活、就绪与 Prometheus 端点。 */
export function registerObservabilityEndpoints(app: ObservableApp, version: string): void {
    app.router.get("/health", ctx => {
        ctx.body = {
            status: "ok",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version,
        };
    });

    app.router.get("/ready", ctx => {
        const snapshot = getReadinessSnapshot(app);
        ctx.status = snapshot.ready ? 200 : 503;
        ctx.body = snapshot;
    });

    app.router.get("/metrics", ctx => {
        const memory = process.memoryUsage();
        const readiness = getReadinessSnapshot(app);
        const lines = [
            "# HELP onebots_info OneBots application info",
            "# TYPE onebots_info gauge",
            `onebots_info{version="${version}"} 1`,
            "# HELP onebots_uptime_seconds Application uptime in seconds",
            "# TYPE onebots_uptime_seconds gauge",
            `onebots_uptime_seconds ${process.uptime()}`,
            "# HELP onebots_started Whether the application is started",
            "# TYPE onebots_started gauge",
            `onebots_started ${app.isStarted ? 1 : 0}`,
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
