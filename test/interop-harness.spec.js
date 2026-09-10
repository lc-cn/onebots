import { describe, expect, it, vi } from "vitest";
import { stopInitialGateway } from "../scripts/interop-harness.mjs";

describe("interop manager lifecycle recovery", () => {
    it("accepts a lost stop response only after durable stopped state is read back", async () => {
        const operation = { id: "stop-1", action: "stop", status: "succeeded" };
        const local = {
            gateway: vi.fn().mockRejectedValue(new Error("response lost")),
            status: vi.fn().mockResolvedValue({
                gateway: {
                    desired: "stopped",
                    actual: "stopped",
                    recoveryRequired: false,
                    operations: [operation],
                },
            }),
        };

        await expect(stopInitialGateway(local, { logs: () => "manager log" })).resolves.toBe(
            operation,
        );
        expect(local.gateway).toHaveBeenCalledTimes(1);
    });

    it("does not replay or accept an unconfirmed stop operation", async () => {
        const local = {
            gateway: vi.fn().mockRejectedValue(new Error("request failed")),
            status: vi.fn().mockResolvedValue({
                gateway: {
                    desired: "stopped",
                    actual: "failed",
                    recoveryRequired: true,
                    operations: [{ id: "stop-1", action: "stop", status: "running" }],
                },
            }),
        };

        await expect(stopInitialGateway(local, { logs: () => "manager log" })).rejects.toThrow(
            /request failed[\s\S]*recoveryRequired[\s\S]*manager log/,
        );
        expect(local.gateway).toHaveBeenCalledTimes(1);
    });
});
