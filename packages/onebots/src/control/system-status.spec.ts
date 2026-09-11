import { describe, expect, it, vi } from "vitest";
import { createSystemStatus } from "./system-status.js";

const settle = () => new Promise(resolve => setImmediate(resolve));
describe("system status", () => {
    it("does not block status, shares pending IO and caches filesystem capacity", async () => {
        let time = 0;
        let finish!: (value: {
            bsize: number;
            blocks: number;
            bfree: number;
            bavail: number;
        }) => void;
        const read = vi.fn(
            () =>
                new Promise<{ bsize: number; blocks: number; bfree: number; bavail: number }>(
                    resolve => {
                        finish = resolve;
                    },
                ),
        );
        const status = createSystemStatus("/workspace", read, () => time);
        expect(status().disk.state).toBe("pending");
        status();
        await settle();
        expect(read).toHaveBeenCalledTimes(1);
        finish({ bsize: 1024, blocks: 100, bfree: 40, bavail: 30 });
        await settle();
        expect(status().disk).toMatchObject({
            state: "ready",
            total: 102400,
            used: 61440,
            available: 30720,
        });
        expect(status().memory.managerRss).toBeGreaterThan(0);
        expect(read).toHaveBeenCalledTimes(1);
        time = 30_001;
        status();
        await settle();
        expect(read).toHaveBeenCalledTimes(2);
        finish({ bsize: 1024, blocks: 100, bfree: 30, bavail: 20 });
        await settle();
    });
    it("keeps system info on disk failure and retries after the interval", async () => {
        let time = 0;
        const read = vi
            .fn()
            .mockRejectedValueOnce(new Error("unavailable"))
            .mockResolvedValue({ bsize: 1024, blocks: 10, bfree: 3, bavail: 2 });
        const status = createSystemStatus("/workspace", read, () => time);
        status();
        await settle();
        expect(status().disk.state).toBe("unavailable");
        expect(status().nodeVersion).toBe(process.version);
        expect(read).toHaveBeenCalledTimes(1);
        time = 30_001;
        status();
        await settle();
        expect(status().disk.state).toBe("ready");
    });
});
