import { describe, expect, it, vi } from "vitest";
import { createSystemDashboardRefreshCoordinator } from "./system-dashboard-refresh.js";

describe("system dashboard refresh coordinator", () => {
    it("coalesces automatic refreshes and joins a simultaneous manual service probe", async () => {
        let finishService!: () => void;
        const refreshSystemInfo = vi.fn(async () => undefined);
        const refreshServiceStatus = vi
            .fn<() => Promise<void>>()
            .mockImplementationOnce(() => new Promise<void>(resolve => (finishService = resolve)))
            .mockResolvedValue(undefined);
        const coordinator = createSystemDashboardRefreshCoordinator({
            refreshSystemInfo,
            refreshServiceStatus,
        });

        const first = coordinator.refreshAll();
        const second = coordinator.refreshAll();
        const manual = coordinator.refreshServiceStatus();
        expect(refreshSystemInfo).toHaveBeenCalledOnce();
        expect(refreshServiceStatus).toHaveBeenCalledOnce();

        finishService();
        await Promise.all([first, second, manual]);
        await coordinator.refreshAll();
        expect(refreshSystemInfo).toHaveBeenCalledTimes(2);
        expect(refreshServiceStatus).toHaveBeenCalledTimes(2);
    });

    it("releases a failed refresh so the next cycle can recover", async () => {
        const refreshSystemInfo = vi
            .fn<() => Promise<void>>()
            .mockRejectedValueOnce(new Error("temporary failure"))
            .mockResolvedValue(undefined);
        const refreshServiceStatus = vi.fn(async () => undefined);
        const coordinator = createSystemDashboardRefreshCoordinator({
            refreshSystemInfo,
            refreshServiceStatus,
        });

        await expect(coordinator.refreshAll()).rejects.toThrow("temporary failure");
        await expect(coordinator.refreshAll()).resolves.toBeUndefined();
        expect(refreshSystemInfo).toHaveBeenCalledTimes(2);
        expect(refreshServiceStatus).toHaveBeenCalledTimes(2);
    });
});
