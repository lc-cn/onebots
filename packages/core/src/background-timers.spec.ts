import { afterEach, describe, expect, it, vi } from "vitest";

describe("background cleanup timers", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it("does not keep short-lived processes alive for metrics cleanup", async () => {
        const unref = vi.fn();
        vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref } as NodeJS.Timeout);

        await import("./metrics.js");

        expect(unref).toHaveBeenCalledOnce();
    });

    it("does not keep short-lived processes alive for the default rate limiter", async () => {
        const unref = vi.fn();
        vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref } as NodeJS.Timeout);

        await import("./middleware/rate-limit.js");

        expect(unref).toHaveBeenCalledOnce();
    });

    it("does not create a background timer for token cleanup", async () => {
        const setInterval = vi.spyOn(globalThis, "setInterval");
        const { initTokenManager } = await import("./middleware/token-manager.js");

        initTokenManager();

        expect(setInterval).not.toHaveBeenCalled();
    });
});
