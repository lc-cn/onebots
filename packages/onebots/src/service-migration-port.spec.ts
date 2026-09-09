import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readServiceMigrationPending } from "./service-migration-workspace.js";
import { retainedRollbackFiles } from "./service-migration-retained-runtime.js";
import { fixture } from "../test-fixtures/service-migration-port.js";

vi.mock("./service-migration-retained-runtime.js", async importOriginal => ({
    ...(await importOriginal()),
    verifyRetainedLegacyRuntime: vi.fn(async () => {}),
}));

describe("real service migration port file boundaries", () => {
    it("running migration writes files and seed before reload/start and releases only after verification", async () => {
        const test = fixture();
        const result = await test.transaction.run("migration-1", test.backup);
        expect(result.status).toBe("succeeded");
        expect(test.events).toEqual(["quiesce", "reload-target", "start-target", "release"]);
        expect(test.manager.inspect).toHaveBeenCalled();
        expect(readServiceMigrationPending(test.workspace)).toBeNull();
    });
    it("previously stopped migration never starts a manager and preserves stopped seed after release", async () => {
        const test = fixture(false);
        expect((await test.transaction.run("migration-1", test.backup)).status).toBe("succeeded");
        expect(test.events).toEqual(["quiesce", "reload-target"]);
        expect(test.manager.inspect).not.toHaveBeenCalled();
        expect(readServiceMigrationPending(test.workspace)).toBeNull();
        expect(
            JSON.parse(fs.readFileSync(path.join(test.workspace, ".control/gateway.json"), "utf8"))
                .desired,
        ).toBe("stopped");
    });
    it("false stop proof forbids any file write or automatic restart", async () => {
        const test = fixture();
        test.controls.proof = false;
        expect((await test.transaction.run("migration-1", test.backup)).recoveryRequired).toBe(
            true,
        );
        expect(test.events).toEqual(["quiesce"]);
        expect(fs.existsSync(path.join(test.workspace, ".control"))).toBe(false);
        for (const file of test.backup.files)
            expect(fs.readFileSync(file.path).toString("base64")).toBe(file.contentBase64);
    });
    it("manager PID mismatch fails readiness; changed manager identity prevents pending release", async () => {
        const test = fixture();
        await test.port.stopOriginal(test.backup);
        await test.port.writeTarget(test.backup);
        await test.port.startTarget(test.backup);
        test.controls.wrongPid = true;
        expect(await test.port.verifyTarget(test.backup)).toBe(false);
        test.controls.wrongPid = false;
        expect(await test.port.verifyTarget(test.backup)).toBe(true);
        test.controls.managerId = "10000000-0000-4000-8000-000000000002";
        await expect(test.port.releaseTarget(test.backup)).rejects.toThrow();
        expect(test.manager.release).not.toHaveBeenCalled();
    });
    it("failed target readiness blocks the workspace before restarting the restored old service", async () => {
        const test = fixture();
        test.controls.invalidGateway = true;
        const result = await test.transaction.run("migration-1", test.backup);
        expect(result).toMatchObject({
            status: "failed",
            rolledBack: true,
            recoveryRequired: false,
        });
        expect(test.events).toEqual([
            "quiesce",
            "reload-target",
            "start-target",
            "quiesce",
            "reload-old",
            "start-old",
        ]);
        expect(() => readServiceMigrationPending(test.workspace)).toThrow();
        const replacements = new Map(
            retainedRollbackFiles(test.backup, test.host).map(file => [
                file.path,
                file.bytes.toString("base64"),
            ]),
        );
        for (const file of test.backup.files)
            expect(fs.readFileSync(file.path).toString("base64")).toBe(
                replacements.get(file.path) ?? file.contentBase64,
            );
    });
    it("partial workspace preparation remains unknown and never automatically restores or restarts", async () => {
        const test = fixture();
        const original = fs.linkSync;
        vi.spyOn(fs, "linkSync").mockImplementation((from, to) => {
            if (String(to).endsWith("gateway.json")) throw new Error("synthetic-secret");
            original(from, to);
        });
        const result = await test.transaction.run("migration-1", test.backup);
        expect(result.recoveryRequired).toBe(true);
        expect(test.events).toEqual(["quiesce"]);
        expect(readServiceMigrationPending(test.workspace)?.operationId).toBe("migration-1");
    });
    it("rollback cannot quiesce a replacement service instance after verified target identity changes", async () => {
        const test = fixture();
        await test.port.stopOriginal(test.backup);
        await test.port.writeTarget(test.backup);
        await test.port.startTarget(test.backup);
        expect(await test.port.verifyTarget(test.backup)).toBe(true);
        test.setState({ ...test.getState(), processId: 999, identity: "external-identity" });
        const count = test.events.length;
        await expect(test.port.stopTarget(test.backup)).rejects.toThrow();
        expect(test.events.length).toBe(count);
    });
    it("does not adopt an instance that appears before or after target start", async () => {
        for (const edge of ["before", "after"] as const) {
            const test = fixture();
            await test.port.stopOriginal(test.backup);
            await test.port.writeTarget(test.backup);
            const replacement = {
                ...test.getState(),
                state: "running" as const,
                running: true,
                processId: 999,
                identity: "external-instance",
                quiescent: false,
            };
            test.controls[edge === "before" ? "startRaceState" : "afterStartState"] = replacement;
            await expect(test.port.startTarget(test.backup)).rejects.toThrow();
            await expect(test.port.stopTarget(test.backup)).rejects.toThrow();
            expect(test.events.filter(event => event === "quiesce")).toHaveLength(1);
        }
    });
});

it("loss of explicit stop proof after target files are written forbids starting the manager", async () => {
    const test = fixture();
    await test.port.stopOriginal(test.backup);
    await test.port.writeTarget(test.backup);
    test.controls.proof = false;
    await expect(test.port.startTarget(test.backup)).rejects.toThrow();
    expect(test.events).toEqual(["quiesce", "reload-target"]);
});
