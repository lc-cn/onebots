import { describe, expect, it, vi } from "vitest";
import { verifyServiceStopped } from "./service-offline-verification.js";
import type { ServiceStatus } from "./service-manager.js";

function status(running: boolean, detail: string): ServiceStatus {
    return { installed: true, running, scope: "user", detail };
}

describe("service offline verification", () => {
    it("waits until the process manager confirms the service stopped", async () => {
        const readStatus = vi
            .fn<() => ServiceStatus>()
            .mockReturnValueOnce(status(true, "stopping"))
            .mockReturnValueOnce(status(false, "inactive"));
        const sleep = vi.fn(async () => undefined);

        await expect(
            verifyServiceStopped(readStatus, { attempts: 3, intervalMs: 25, sleep }),
        ).resolves.toBeUndefined();
        expect(readStatus).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledOnce();
        expect(sleep).toHaveBeenCalledWith(25);
    });

    it("keeps the final process-manager evidence when stopping times out", async () => {
        const readStatus = vi
            .fn<() => ServiceStatus>()
            .mockReturnValueOnce(status(true, "stop pending"))
            .mockReturnValue(status(true, "launchd relaunched pid 42"));

        await expect(
            verifyServiceStopped(readStatus, {
                attempts: 2,
                sleep: async () => undefined,
            }),
        ).rejects.toThrow(/仍处于运行状态.*launchd relaunched pid 42/);
    });
});
