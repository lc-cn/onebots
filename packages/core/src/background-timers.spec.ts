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

    it("does not keep short-lived processes alive after token manager initialization", async () => {
        const unref = vi.fn();
        vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref } as NodeJS.Timeout);
        const { initTokenManager } = await import("./middleware/token-manager.js");

        initTokenManager();

        expect(unref).toHaveBeenCalledOnce();
    });
});
