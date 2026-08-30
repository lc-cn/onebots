import type { Adapter } from "./adapter.js";
import { metrics } from "./metrics.js";
import type { Router } from "./router.js";

interface ObservableApp {
    readonly router: Router;
    readonly adapters: ReadonlyMap<keyof Adapter.Configs, Adapter>;
    readonly isStarted: boolean;
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
        const adapters: Record<string, { online: number; offline: number; total: number }> = {};
        let allReady = true;
        let totalOnline = 0;
        let totalAccounts = 0;

        for (const [platform, adapter] of app.adapters) {
            let online = 0;
            let offline = 0;
            for (const account of adapter.accounts.values()) {
                totalAccounts++;
                if (account.status === "online") {
                    online++;
                    totalOnline++;
                } else {
                    offline++;
                }
            }
            adapters[String(platform)] = { online, offline, total: online + offline };
            if (offline > 0) allReady = false;
        }

        const ready = allReady && app.isStarted;
        ctx.status = ready ? 200 : 503;
        ctx.body = {
            ready,
            timestamp: new Date().toISOString(),
            server: app.isStarted,
            adapters,
            summary: {
                total_adapters: app.adapters.size,
                total_accounts: totalAccounts,
                online_accounts: totalOnline,
            },
        };
    });

    app.router.get("/metrics", ctx => {
        const memory = process.memoryUsage();
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
            let online = 0;
            let offline = 0;
            for (const account of adapter.accounts.values()) {
                if (account.status === "online") online++;
                else offline++;
            }
            lines.push(
                `onebots_accounts_total{platform="${platform}",status="online"} ${online}`,
                `onebots_accounts_total{platform="${platform}",status="offline"} ${offline}`,
            );
        }

        const performance = metrics.exportPrometheus().trim();
        if (performance) lines.push("", "# Performance metrics", performance);
        ctx.type = "text/plain; charset=utf-8";
        ctx.body = `${lines.join("\n")}\n`;
    });
}
