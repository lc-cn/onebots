export interface ControlDiagnostics {
    schemaVersion: 1;
    manager: { id: string; pid: number; version: string };
    management: { host: string; port: number } | null;
    gateway: {
        actual: "starting" | "running" | "stopping" | "stopped" | "failed";
        desired: "running" | "stopped";
        recoveryRequired: boolean;
    };
    configuration: { state: "ready" | "damaged" | "unavailable"; recoveryRequired: boolean };
    generation: { activeId: string | null; recoveryRequired: boolean };
    storage: {
        dataDirectory: "ready" | "creatable" | "invalid" | "unavailable";
        database: "ready" | "creatable" | "invalid" | "unavailable";
        publicStatic: "ready" | "disabled" | "invalid" | "unavailable";
        databaseIntegrity: "not-checked";
    };
    extensions: {
        receipt: "bundled" | "verified" | "invalid" | "unavailable";
        selection: "ready" | "mismatch" | "unavailable";
        registration: "verified" | "not-checked";
    };
    processOwnership: { available: boolean };
    serviceMigration: { pending: boolean; recoveryRequired: boolean };
}
