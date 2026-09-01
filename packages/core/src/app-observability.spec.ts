import { describe, expect, it } from "vitest";
import {
    formatProtocolReadinessMetrics,
    getReadinessSnapshot,
    getRuntimeProcessIdentity,
    registerObservabilityEndpoints,
} from "./app-observability.js";
import type { RuntimeOperation } from "./runtime-operation.js";

function observableApp(
    accounts: Array<{ status: string; protocols: Array<{ lifecycleStatus: string }> }>,
    isStarted = true,
    isReloading = false,
    configStatus?: string,
    runtimeOperation?: RuntimeOperation,
) {
    return {
        isStarted,
        isReloading,
        runtimeOperation,
        runtimeConfigState: configStatus ? { status: configStatus } : undefined,
        adapters: new Map([
            [
                "mock",
                {
                    accounts: new Map(accounts.map((account, index) => [String(index), account])),
                },
            ],
        ]),
    } as never;
}

function observabilityContext(): Record<string, unknown> {
    return {
        set: () => undefined,
    };
}

describe("application readiness", () => {
    it("rejects an online account whose protocol failed to start", () => {
        const snapshot = getReadinessSnapshot(
            observableApp([{ status: "online", protocols: [{ lifecycleStatus: "failed" }] }]),
        );

        expect(snapshot).toMatchObject({
            ready: false,
            configured: true,
            adapters: {
                mock: {
                    online: 1,
                    offline: 0,
                    protocols: { ready: 0, unavailable: 1, total: 1 },
                },
            },
            summary: {
                total_accounts: 1,
                online_accounts: 1,
                total_protocols: 1,
                ready_protocols: 0,
            },
        });
    });

    it("accepts an online account only after every protocol is ready", () => {
        const snapshot = getReadinessSnapshot(
            observableApp([
                {
                    status: "online",
                    protocols: [{ lifecycleStatus: "ready" }, { lifecycleStatus: "ready" }],
                },
            ]),
        );

        expect(snapshot.ready).toBe(true);
        expect(snapshot.summary.ready_protocols).toBe(2);
    });

    it("rejects an online account without any protocol outlet", () => {
        const snapshot = getReadinessSnapshot(observableApp([{ status: "online", protocols: [] }]));

        expect(snapshot).toMatchObject({
            ready: false,
            configured: true,
            adapters: {
                mock: {
                    online: 1,
                    accounts_without_protocols: 1,
                    protocols: { ready: 0, unavailable: 0, total: 0 },
                },
            },
            summary: {
                total_accounts: 1,
                online_accounts: 1,
                total_protocols: 0,
                accounts_without_protocols: 1,
            },
        });
    });

    it("keeps an empty first-run gateway reachable while exposing pending configuration", () => {
        const snapshot = getReadinessSnapshot(observableApp([]));

        expect(snapshot).toMatchObject({
            ready: true,
            configured: false,
            runtime_operation: "idle",
        });
    });

    it("rejects readiness while configuration is reloading", () => {
        const snapshot = getReadinessSnapshot(
            observableApp(
                [{ status: "online", protocols: [{ lifecycleStatus: "ready" }] }],
                true,
                true,
                undefined,
                "configuration_reload",
            ),
        );

        expect(snapshot).toMatchObject({
            ready: false,
            server: true,
            reloading: true,
            runtime_operation: "configuration_reload",
        });
    });

    it("fails closed to an unknown operation for an embedded busy host", () => {
        const snapshot = getReadinessSnapshot(
            observableApp(
                [{ status: "online", protocols: [{ lifecycleStatus: "ready" }] }],
                true,
                true,
            ),
        );

        expect(snapshot.runtime_operation).toBe("unknown");
    });

    it.each(["drifted", "unavailable"])(
        "rejects readiness when runtime configuration is %s",
        configStatus => {
            const snapshot = getReadinessSnapshot(
                observableApp(
                    [{ status: "online", protocols: [{ lifecycleStatus: "ready" }] }],
                    true,
                    false,
                    configStatus,
                ),
            );

            expect(snapshot).toMatchObject({
                ready: false,
                config: { status: configStatus, in_sync: false },
            });
        },
    );

    it("keeps embedded applications ready when configuration tracking is unavailable", () => {
        const snapshot = getReadinessSnapshot(
            observableApp([{ status: "online", protocols: [{ lifecycleStatus: "ready" }] }]),
        );

        expect(snapshot).toMatchObject({
            ready: true,
            config: { status: "untracked", in_sync: true },
        });
    });

    it("fails closed for an invalid tracked configuration status", () => {
        const snapshot = getReadinessSnapshot(
            observableApp(
                [{ status: "online", protocols: [{ lifecycleStatus: "ready" }] }],
                true,
                false,
                "corrupt",
            ),
        );

        expect(snapshot).toMatchObject({
            ready: false,
            config: { status: "unavailable", in_sync: false },
        });
    });

    it("publishes configuration drift through readiness and Prometheus routes", () => {
        const handlers = new Map<string, (ctx: Record<string, unknown>) => void>();
        const app = {
            ...observableApp(
                [{ status: "online", protocols: [{ lifecycleStatus: "ready" }] }],
                true,
                false,
                "drifted",
            ),
            router: {
                get: (route: string, handler: (ctx: Record<string, unknown>) => void) =>
                    handlers.set(route, handler),
            },
            runtimeContractId: "sha256:runtime-contract",
        };
        registerObservabilityEndpoints(app as never, {
            name: "onebots",
            version: "1.2.3",
            coreVersion: "1.1.0",
        });

        const readyContext = observabilityContext();
        handlers.get("/ready")?.(readyContext);
        expect(readyContext).toMatchObject({
            status: 503,
            body: {
                ready: false,
                application: "onebots",
                version: "1.2.3",
                core_version: "1.1.0",
                instance_id: getRuntimeProcessIdentity().instanceId,
                started_at: getRuntimeProcessIdentity().startedAt,
                runtime_contract_id: "sha256:runtime-contract",
                config: { status: "drifted", in_sync: false },
            },
        });

        const metricsContext = observabilityContext();
        handlers.get("/metrics")?.(metricsContext);
        expect(metricsContext.body).toContain("onebots_config_in_sync 0");
        expect(metricsContext.body).toContain('onebots_info{version="1.2.3"} 1');
        expect(metricsContext.body).toContain('onebots_core_info{version="1.1.0"} 1');
        expect(metricsContext.body).toContain('onebots_runtime_operation{operation="idle"} 1');
        expect(metricsContext.body).toContain(
            'onebots_runtime_operation{operation="account_lifecycle"} 0',
        );

        app.isReloading = true;
        app.runtimeOperation = "account_lifecycle";
        const busyMetricsContext = observabilityContext();
        handlers.get("/metrics")?.(busyMetricsContext);
        expect(busyMetricsContext.body).toContain('onebots_runtime_operation{operation="idle"} 0');
        expect(busyMetricsContext.body).toContain(
            'onebots_runtime_operation{operation="account_lifecycle"} 1',
        );

        const healthContext = observabilityContext();
        handlers.get("/health")?.(healthContext);
        expect(healthContext.body).toMatchObject({
            application: "onebots",
            version: "1.2.3",
            core_version: "1.1.0",
            instance_id: expect.any(String),
            started_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
            runtime_contract_id: "sha256:runtime-contract",
        });
        expect(healthContext.body).toMatchObject({
            instance_id: getRuntimeProcessIdentity().instanceId,
            started_at: getRuntimeProcessIdentity().startedAt,
        });
        expect(readyContext.body).toMatchObject({
            instance_id: (healthContext.body as Record<string, unknown>).instance_id,
            started_at: (healthContext.body as Record<string, unknown>).started_at,
        });
        const secondHealthContext = observabilityContext();
        handlers.get("/health")?.(secondHealthContext);
        expect(secondHealthContext.body).toMatchObject({
            instance_id: (healthContext.body as Record<string, unknown>).instance_id,
            started_at: (healthContext.body as Record<string, unknown>).started_at,
        });
    });

    it("exports protocol readiness with safe Prometheus labels", () => {
        const snapshot = getReadinessSnapshot(
            observableApp([{ status: "online", protocols: [{ lifecycleStatus: "ready" }] }]),
        );
        snapshot.adapters['mock"adapter'] = snapshot.adapters.mock;
        delete snapshot.adapters.mock;

        expect(formatProtocolReadinessMetrics(snapshot)).toContain(
            'onebots_protocols_total{platform="mock\\"adapter",status="ready"} 1',
        );
        expect(formatProtocolReadinessMetrics(snapshot)).toContain(
            'onebots_accounts_without_protocols{platform="mock\\"adapter"} 0',
        );
    });
});
