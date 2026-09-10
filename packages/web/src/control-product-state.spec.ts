import { describe, expect, it } from "vitest";
import type {
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlStatus,
} from "@onebots/core/control";
import { controlMutationBlock, workspaceReadiness } from "./control-product-state.js";

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
