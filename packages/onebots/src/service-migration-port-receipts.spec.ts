import { describe, expect, it, vi } from "vitest";
import {
    createServiceMigrationRollbackContract,
    digestServiceMigrationReloadOldReceipt,
} from "./service-migration-retained-runtime.js";
import type { ServicePlatformState } from "./service-platform.js";
import { fixture, restoreRollback } from "../test-fixtures/service-migration-port.js";

vi.mock("./service-migration-retained-runtime.js", async importOriginal => ({
    ...(await importOriginal()),
    verifyRetainedLegacyRuntime: vi.fn(async () => {}),
}));

describe("rollback effect receipts", () => {
    it.each([
        ["linux", true],
        ["darwin", false],
    ] as const)(
        "%s binds the restored files, stable reload and started instance",
        async (name, loaded) => {
            const test = fixture(true, name);
            await restoreRollback(test);
            expect(test.events.at(-1)).toBe("quiesce");

            const receipt = await test.port.reloadOriginal(test.backup, test.backupDigest);
            expect(receipt).toEqual({
                schemaVersion: 1,
                backupDigest: test.backupDigest,
                rollbackContractDigest: createServiceMigrationRollbackContract(
                    test.backup,
                    test.host,
                ).digest,
                enabled: true,
                loaded,
                definitionPath: test.paths.definition,
            });
            expect(test.events.at(-1)).toBe("reload-old");

            await expect(test.port.startOriginal(test.backup, receipt)).resolves.toEqual({
                schemaVersion: 1,
                reloadReceiptDigest: digestServiceMigrationReloadOldReceipt(receipt),
                processId: 300,
                identity: "restored-identity",
            });
            expect(test.events.at(-1)).toBe("start-old");
        },
    );

    it.each([
        ["definition path", { definitionPath: "/wrong/service-definition" }],
        ["enabled state", { enabled: false }],
        ["loaded state", { loaded: false }],
        [
            "running state",
            {
                state: "running",
                running: true,
                quiescent: false,
                processId: 9,
                identity: "replacement",
            },
        ],
        ["quiescent state", { quiescent: false }],
    ] as const)("refuses to start after the reloaded %s drifts", async (_name, patch) => {
        const test = fixture();
        await restoreRollback(test);
        const receipt = await test.port.reloadOriginal(test.backup, test.backupDigest);
        test.setState({ ...test.getState(), ...patch } as ServicePlatformState);
        const calls = test.start.mock.calls.length;

        await expect(test.port.startOriginal(test.backup, receipt)).rejects.toThrow();
        expect(test.start).toHaveBeenCalledTimes(calls);
    });

    it("rejects tampered and cross-port start capabilities", async () => {
        const test = fixture();
        await restoreRollback(test);
        const receipt = await test.port.reloadOriginal(test.backup, test.backupDigest);
        const calls = test.start.mock.calls.length;
        const tampered = [
            { ...receipt, rollbackContractDigest: "f".repeat(64) },
            { ...receipt, unexpected: true },
        ];
        for (const candidate of tampered)
            await expect(test.port.startOriginal(test.backup, candidate)).rejects.toThrow();
        await expect(test.makePort().startOriginal(test.backup, receipt)).rejects.toThrow();
        expect(test.start).toHaveBeenCalledTimes(calls);
        await expect(test.port.startOriginal(test.backup, receipt)).resolves.toMatchObject({
            processId: 300,
            identity: "restored-identity",
        });
    });

    it("invalidates an old receipt after another restore or uncertain reload", async () => {
        const test = fixture();
        await test.port.stopOriginal(test.backup);
        await test.port.restoreOriginal(test.backup);
        const restoredReceipt = await test.port.reloadOriginal(test.backup, test.backupDigest);
        await test.port.restoreOriginal(test.backup);
        let calls = test.start.mock.calls.length;
        await expect(test.port.startOriginal(test.backup, restoredReceipt)).rejects.toThrow();
        expect(test.start).toHaveBeenCalledTimes(calls);

        const uncertain = fixture();
        await uncertain.port.stopOriginal(uncertain.backup);
        await uncertain.port.restoreOriginal(uncertain.backup);
        const currentReceipt = await uncertain.port.reloadOriginal(
            uncertain.backup,
            uncertain.backupDigest,
        );
        uncertain.controls.reloadError = true;
        await expect(
            uncertain.port.reloadOriginal(uncertain.backup, uncertain.backupDigest),
        ).rejects.toThrow("synthetic reload failure");
        calls = uncertain.start.mock.calls.length;
        await expect(
            uncertain.port.startOriginal(uncertain.backup, currentReceipt),
        ).rejects.toThrow();
        expect(uncertain.start).toHaveBeenCalledTimes(calls);
    });

    it("refuses an instance that appears after the final stopped observation", async () => {
        const test = fixture();
        await restoreRollback(test);
        const receipt = await test.port.reloadOriginal(test.backup, test.backupDigest);
        test.controls.startRaceState = {
            ...test.getState(),
            state: "running",
            running: true,
            loaded: true,
            processId: 999,
            identity: "external-instance",
            quiescent: false,
        };
        const events = test.events.length;

        await expect(test.port.startOriginal(test.backup, receipt)).rejects.toThrow(
            "synthetic initial state mismatch",
        );
        expect(test.events).toHaveLength(events);
        await expect(test.port.startOriginal(test.backup, receipt)).rejects.toThrow();
    });

    it("rejects reload and start return values that disagree with a fresh observation", async () => {
        const reload = fixture();
        await restoreRollback(reload);
        reload.reload.mockImplementationOnce(async enabled => ({
            ...reload.getState(),
            enabled,
            loaded: true,
            definitionPath: "/unobserved/service-definition",
        }));
        await expect(
            reload.port.reloadOriginal(reload.backup, reload.backupDigest),
        ).rejects.toThrow();

        const start = fixture();
        await restoreRollback(start);
        const receipt = await start.port.reloadOriginal(start.backup, start.backupDigest);
        start.start.mockImplementationOnce(async () => ({
            ...start.getState(),
            state: "running",
            running: true,
            processId: 300,
            identity: "unobserved-instance",
            quiescent: false,
        }));
        await expect(start.port.startOriginal(start.backup, receipt)).rejects.toThrow();
    });

    it("verifyRestored binds the started instance and stopped reload state", async () => {
        const running = fixture();
        await restoreRollback(running);
        const receipt = await running.port.reloadOriginal(running.backup, running.backupDigest);
        await running.port.startOriginal(running.backup, receipt);
        expect(await running.port.verifyRestored(running.backup)).toBe(true);
        running.setState({
            ...running.getState(),
            processId: 301,
            identity: "replacement-instance",
        });
        expect(await running.port.verifyRestored(running.backup)).toBe(false);

        const stopped = fixture(false, "darwin");
        await restoreRollback(stopped);
        await stopped.port.reloadOriginal(stopped.backup, stopped.backupDigest);
        expect(await stopped.port.verifyRestored(stopped.backup)).toBe(true);
        stopped.setState({ ...stopped.getState(), loaded: true });
        expect(await stopped.port.verifyRestored(stopped.backup)).toBe(false);
    });
});
