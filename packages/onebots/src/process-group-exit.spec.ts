import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForProcessGroupExit } from "./process-group-exit.js";
afterEach(() => vi.restoreAllMocks());
describe("bounded owned process group exit proof", () => {
    it("EPERM只等待，随后ESRCH才确认退出；永远只signal0", async () => {
        const spy = vi
            .spyOn(process, "kill")
            .mockImplementationOnce(() => {
                throw Object.assign(new Error(), { code: "EPERM" });
            })
            .mockImplementation(() => {
                throw Object.assign(new Error(), { code: "ESRCH" });
            });
        expect(await waitForProcessGroupExit(42, 100, 1)).toBe("exited");
        expect(spy.mock.calls).toEqual([
            [-42, 0],
            [-42, 0],
        ]);
    });
    it("永久EPERM有界未知，不假装已退出", async () => {
        const spy = vi.spyOn(process, "kill").mockImplementation(() => {
            throw Object.assign(new Error(), { code: "EPERM" });
        });
        expect(await waitForProcessGroupExit(42, 20, 5)).toBe("unknown");
        expect(spy.mock.calls.length).toBeGreaterThan(1);
    });
    it("其他errno立即拒绝；持续存活有界timeout", async () => {
        const spy = vi.spyOn(process, "kill").mockImplementation(() => {
            throw Object.assign(new Error(), { code: "EIO" });
        });
        expect(await waitForProcessGroupExit(42, 100)).toBe("unknown");
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockImplementation(() => true);
        expect(await waitForProcessGroupExit(42, 20, 5)).toBe("timeout");
    });
    it("不接受可触及调用方组的非法标识", async () => {
        const spy = vi.spyOn(process, "kill");
        for (const pid of [0, 1, -1, 1.5, NaN])
            expect(await waitForProcessGroupExit(pid, 1)).toBe("unknown");
        expect(spy).not.toHaveBeenCalled();
    });
});
