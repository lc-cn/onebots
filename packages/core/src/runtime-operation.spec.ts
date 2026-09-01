import { describe, expect, it, vi } from "vitest";
import { acquireRuntimeOperation } from "./runtime-operation.js";

describe("runtime operation lease", () => {
    it("publishes one operation and restores readiness exactly once", () => {
        const host = { isReloading: false, runtimeOperation: "idle" as const };
        const lease = acquireRuntimeOperation(host, "account_configuration", vi.fn());

        expect(host).toEqual({
            isReloading: true,
            runtimeOperation: "account_configuration",
        });
        expect(lease.operation).toBe("account_configuration");

        lease.release();
        lease.release();
        expect(host).toEqual({ isReloading: false, runtimeOperation: "idle" });
    });

    it("rejects a second owner without changing the active evidence", () => {
        const host = { isReloading: false, runtimeOperation: "idle" as const };
        const first = acquireRuntimeOperation(host, "account_lifecycle", vi.fn());
        const conflict = vi.fn(active => new Error(`busy:${active}`));

        expect(() => acquireRuntimeOperation(host, "configuration_reload", conflict)).toThrow(
            "busy:account_lifecycle",
        );
        expect(conflict).toHaveBeenCalledWith("account_lifecycle");
        expect(host).toEqual({ isReloading: true, runtimeOperation: "account_lifecycle" });

        first.release();
    });

    it("does not let an expired release clear a later lease", () => {
        const host = { isReloading: false, runtimeOperation: "idle" as const };
        const first = acquireRuntimeOperation(host, "account_configuration", vi.fn());
        first.release();
        const second = acquireRuntimeOperation(host, "configuration_reload", vi.fn());

        first.release();
        expect(host).toEqual({
            isReloading: true,
            runtimeOperation: "configuration_reload",
        });

        second.release();
        expect(host).toEqual({ isReloading: false, runtimeOperation: "idle" });
    });

    it("fails closed when a legacy host is busy without an operation reason", () => {
        const host = { isReloading: true };
        const conflict = vi.fn(active => new Error(`busy:${active}`));

        expect(() => acquireRuntimeOperation(host, "account_configuration", conflict)).toThrow(
            "busy:unknown",
        );
        expect(host).toEqual({ isReloading: true });
    });
});
