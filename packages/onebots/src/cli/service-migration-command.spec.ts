import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceController } from "../service-manager.js";
import { migrateInstalledService } from "../service-migration.js";
import { migrateServiceCommand } from "./service-migration-command.js";
import type { ServiceMigrationRecord } from "../service-migration-types.js";
vi.mock("../service-migration.js", () => ({ migrateInstalledService: vi.fn() }));
afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(migrateInstalledService).mockReset();
});
const legacy = {
    scope: "user" as const,
    configPath: "/tmp/old workspace/legacy.yaml",
    workingDirectory: "/tmp/old-working",
    nodePath: "/old/node",
    binPath: "/old/bin.js",
    adapters: ["mock"],
    protocols: ["onebot-v11"],
};
function result(overrides: Partial<ServiceMigrationRecord> = {}): ServiceMigrationRecord {
    return {
        schemaVersion: 1,
        id: "migration-1",
        backupDigest: "a".repeat(64),
        phase: "completed",
        status: "succeeded",
        recoveryRequired: false,
        rolledBack: false,
        ...overrides,
    };
}
describe("migration CLI command", () => {
    it("derives workspace from installed legacy config and uses current packaged runtime", async () => {
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(legacy);
        vi.mocked(migrateInstalledService).mockResolvedValue(result());
        const output = await migrateServiceCommand({ system: false });
        expect(vi.mocked(migrateInstalledService).mock.calls[0][0]).toEqual({
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace: path.dirname(legacy.configPath),
            workingDirectory: legacy.workingDirectory,
            nodePath: process.execPath,
            binPath: fileURLToPath(new URL("../bin.js", import.meta.url)),
            host: "127.0.0.1",
            port: 6727,
        });
        expect(output.exitCode).toBe(0);
        expect(output.output).toContain("onebots auth bootstrap --data-dir '/tmp/old workspace'");
    });
    it("passes explicit scope/listen values without accepting account/protocol overrides", async () => {
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue({
            ...legacy,
            scope: "system",
        });
        vi.mocked(migrateInstalledService).mockResolvedValue(result());
        await migrateServiceCommand({ system: true, host: "0.0.0.0", port: 7000 });
        expect(vi.mocked(migrateInstalledService).mock.calls[0][0]).toMatchObject({
            scope: "system",
            host: "0.0.0.0",
            port: 7000,
        });
        expect(vi.mocked(migrateInstalledService).mock.calls[0][0]).not.toHaveProperty("adapters");
    });
    it("missing/invalid legacy service does not call migration", async () => {
        const read = vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(null);
        expect(await migrateServiceCommand({ system: false })).toMatchObject({
            exitCode: 1,
            output: expect.stringContaining("未找到"),
        });
        read.mockImplementation(() => {
            throw new Error("synthetic-secret");
        });
        expect(await migrateServiceCommand({ system: false })).toMatchObject({
            exitCode: 1,
            output: expect.not.stringContaining("synthetic-secret"),
        });
        expect(migrateInstalledService).not.toHaveBeenCalled();
    });
    it("unknown result reports its id and never claims successful rollback", async () => {
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(legacy);
        vi.mocked(migrateInstalledService).mockResolvedValue(
            result({ status: "interrupted", recoveryRequired: true, rolledBack: true }),
        );
        const output = await migrateServiceCommand({ system: false });
        expect(output.exitCode).toBe(1);
        expect(output.output).toContain("migration-1");
        expect(output.output).toContain("interrupted");
        expect(output.output).not.toContain("已确认恢复旧服务");
    });
    it("confirmed rollback is distinct from an exception with unknown operation id", async () => {
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(legacy);
        vi.mocked(migrateInstalledService).mockResolvedValue(
            result({ status: "failed", rolledBack: true }),
        );
        expect(await migrateServiceCommand({ system: false })).toMatchObject({
            exitCode: 1,
            output: expect.stringContaining("已确认恢复旧服务"),
        });
        vi.mocked(migrateInstalledService).mockRejectedValue(new Error("synthetic-secret"));
        const output = await migrateServiceCommand({ system: false });
        expect(output.exitCode).toBe(1);
        expect(output.output).not.toContain("synthetic-secret");
        expect(output.output).toContain("操作标识暂不可用");
    });
});
