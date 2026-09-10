import { describe, expect, it } from "vitest";
import type {
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlStatus,
} from "@onebots/core/control";
import { controlMutationBlock, setupJourney, workspaceReadiness } from "./control-product-state.js";

const selection = { adapters: [], protocols: [], applications: [] };
const catalog = (
    override: Partial<ControlInstallationCatalog> = {},
): ControlInstallationCatalog => ({
    activeGenerationId: null,
    selection,
    adapters: [],
    protocols: [],
    applications: [],
    ...override,
});
const configuration = (
    override: Partial<ControlConfigurationSnapshot> = {},
): ControlConfigurationSnapshot => ({
    base: { generationId: null, configRevision: "a".repeat(64) },
    document: { log_level: "info" },
    schemas: {},
    secretStates: [],
    unknownPaths: [],
    ...override,
});
const status = (override: Partial<ControlStatus> = {}): ControlStatus => ({
    schemaVersion: 1,
    manager: { id: "manager", version: "1.0.0" },
    gateway: {
        desired: "stopped",
        actual: "stopped",
        recoveryRequired: false,
        operations: [],
    },
    ...override,
});

describe("workspaceReadiness", () => {
    it("only declares a workspace empty from both authoritative snapshots", () => {
        expect(workspaceReadiness(undefined, configuration())).toBe("loading");
        expect(workspaceReadiness(catalog(), undefined)).toBe("loading");
        expect(workspaceReadiness(catalog(), configuration())).toBe("empty");
    });

    it("does not hide configured or unprojected state behind onboarding", () => {
        expect(
            workspaceReadiness(
                catalog({ selection: { ...selection, adapters: ["mock"] } }),
                configuration(),
            ),
        ).toBe("configured");
        expect(
            workspaceReadiness(catalog(), configuration({ unknownPaths: [["legacy.account"]] })),
        ).toBe("configured");
        expect(workspaceReadiness(catalog(), configuration(), true)).toBe("unavailable");
    });
});

describe("setupJourney", () => {
    it("guides an empty workspace through extensions, configuration and start", () => {
        expect(setupJourney(catalog(), configuration(), status()).state).toBe("needs-extensions");

        const installed = catalog({
            activeGenerationId: "generation",
            selection: { adapters: ["mock"], protocols: ["onebot-v11"], applications: ["zhin"] },
        });
        const needsAccount = setupJourney(installed, configuration(), status());
        expect(needsAccount.state).toBe("needs-configuration");
        expect(needsAccount.nextWorkspace).toBe("configuration");
        expect(needsAccount.counts).toEqual({
            adapters: 1,
            protocols: 1,
            applications: 1,
            accounts: 0,
        });

        const configured = configuration({ document: { "mock.10000": { token: "redacted" } } });
        expect(setupJourney(installed, configured, status()).state).toBe("ready-to-start");
        expect(
            setupJourney(
                installed,
                configured,
                status({
                    gateway: {
                        desired: "running",
                        actual: "running",
                        recoveryRequired: false,
                        operations: [],
                    },
                }),
            ).state,
        ).toBe("running");
    });

    it("does not invent progress while authoritative facts are unavailable", () => {
        expect(setupJourney(undefined, configuration(), status()).state).toBe("loading");
        expect(setupJourney(catalog(), configuration(), status(), true).state).toBe("unavailable");
    });

    it("routes a gateway recovery state to diagnostics instead of start", () => {
        const installed = catalog({
            selection: { adapters: ["mock"], protocols: ["onebot-v11"], applications: [] },
        });
        const configured = configuration({ document: { "mock.10000": {} } });
        const journey = setupJourney(
            installed,
            configured,
            status({
                gateway: {
                    desired: "running",
                    actual: "failed",
                    recoveryRequired: true,
                    operations: [],
                },
            }),
        );
        expect(journey.state).toBe("recovery");
        expect(journey.nextWorkspace).toBe("activity");
        expect(journey.nextLabel).toBe("打开恢复诊断");
    });
});

describe("controlMutationBlock", () => {
    it("prioritizes recovery, then migration, then explicit ownership failure", () => {
        expect(
            controlMutationBlock(
                status({
                    serviceMigration: { pending: true, recoveryRequired: true },
                    processOwnership: { available: false },
                }),
            )?.kind,
        ).toBe("service-recovery");
        expect(
            controlMutationBlock(
                status({ serviceMigration: { pending: true, recoveryRequired: false } }),
            )?.kind,
        ).toBe("service-migration");
        expect(controlMutationBlock(status({ processOwnership: { available: false } }))?.kind).toBe(
            "process-ownership",
        );
    });

    it("does not invent a blocker when optional evidence is absent or healthy", () => {
        expect(controlMutationBlock(status())).toBeUndefined();
        expect(
            controlMutationBlock(
                status({
                    serviceMigration: { pending: false, recoveryRequired: false },
                    processOwnership: { available: true },
                }),
            ),
        ).toBeUndefined();
    });
});
