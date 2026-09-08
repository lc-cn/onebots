import { afterEach, describe, expect, it, vi } from "vitest";
import { gatewayProcessExists } from "./workspace.js";
afterEach(() => vi.restoreAllMocks());
const missing = () => Object.assign(new Error("missing"), { code: "ESRCH" });
describe("历史网关进程组只读探测", () => {
    it("leader已退出但组内helper仍活，不能对账为已停止", () => {
        const signal = vi.spyOn(process, "kill").mockImplementation((pid, value) => {
            expect(value).toBe(0);
            if (pid > 0) throw missing();
            return true;
        });
        expect(gatewayProcessExists(12345)).toBe(true);
        expect(signal.mock.calls).toEqual([
            [12345, 0],
            [-12345, 0],
        ]);
    });
    it("只有正PID和负PGID都ESRCH才返回false", () => {
        const signal = vi.spyOn(process, "kill").mockImplementation(() => {
            throw missing();
        });
        expect(gatewayProcessExists(12345)).toBe(false);
        expect(signal.mock.calls).toEqual([
            [12345, 0],
            [-12345, 0],
        ]);
    });
    it.each(["EPERM", "EINVAL", "UNKNOWN"])("%s保守拒绝，绝不杀旧PID或进程组", code => {
        const signal = vi.spyOn(process, "kill").mockImplementation((pid, value) => {
            expect(value).toBe(0);
            if (pid > 0) throw missing();
            throw Object.assign(new Error("private-error"), { code });
        });
        expect(() => gatewayProcessExists(12345)).toThrow("无法确认历史网关进程组状态");
        expect(signal.mock.calls.every(call => call[1] === 0)).toBe(true);
    });
    it("非法或0 PID不执行任何探测", () => {
        const signal = vi.spyOn(process, "kill");
        for (const pid of [0, -1, NaN, 1.5, 0x80000000])
            expect(() => gatewayProcessExists(pid)).toThrow();
        expect(signal).not.toHaveBeenCalled();
    });
});
