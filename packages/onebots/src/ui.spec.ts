import { describe, expect, it, vi } from "vitest";
import { executeDeployment } from "./tui/session.js";
describe("工作台统一上线流程", () => {
    it.each([
        [false, false, ["install", "start"]],
        [true, false, ["start"]],
        [true, true, ["restart"]],
    ] as const)("installed=%s running=%s", async (installed, running, expected) => {
        const calls: string[] = [];
        await executeDeployment({
            status: () => ({ installed, running }),
            install: async () => {
                calls.push("install");
            },
            start: async () => {
                calls.push("start");
            },
            restart: async () => {
                calls.push("restart");
            },
        });
        expect(calls).toEqual(expected);
    });
    it("安装失败不启动，线上验证失败不报告成功", async () => {
        const dependencies = {
            status: () => ({ installed: false, running: false }),
            install: vi.fn().mockRejectedValue(new Error("预检失败")),
            start: vi.fn(),
            restart: vi.fn(),
        };
        await expect(executeDeployment(dependencies)).rejects.toThrow("预检失败");
        expect(dependencies.start).not.toHaveBeenCalled();
        dependencies.status = () => ({ installed: true, running: true });
        dependencies.restart.mockRejectedValue(new Error("在线验证失败"));
        await expect(executeDeployment(dependencies)).rejects.toThrow("在线验证失败");
    });
});
