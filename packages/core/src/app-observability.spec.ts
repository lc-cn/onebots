import { describe, expect, it } from "vitest";
import { formatProtocolReadinessMetrics, getReadinessSnapshot } from "./app-observability.js";

function observableApp(
    accounts: Array<{ status: string; protocols: Array<{ lifecycleStatus: string }> }>,
    isStarted = true,
) {
    return {
        isStarted,
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

        expect(snapshot).toMatchObject({ ready: true, configured: false });
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
