import { describe, expect, it, vi } from "vitest";
import { executeDashboardServiceAction, type DashboardServiceActionDependencies } from "./ui.js";

function createDependencies() {
    return {
        start: vi.fn(async () => ({ output: "启动已验证" })),
        stop: vi.fn(async () => ({ output: "已停止" })),
        restart: vi.fn(async () => ({ output: "重启已验证" })),
    } satisfies DashboardServiceActionDependencies;
}

describe("terminal dashboard service actions", () => {
    it.each([
        ["start", "user", "start", false, "启动已验证"],
        ["stop", "system", "stop", true, "已停止"],
        ["restart", "system", "restart", true, "重启已验证"],
    ] as const)(
        "routes %s through the shared %s-scope command boundary",
        async (action, scope, expectedMethod, system, output) => {
            const dependencies = createDependencies();

            await expect(
                executeDashboardServiceAction(action, scope, dependencies),
            ).resolves.toEqual({ output });
            expect(dependencies[expectedMethod]).toHaveBeenCalledOnce();
            expect(dependencies[expectedMethod]).toHaveBeenCalledWith({ system });
            for (const [method, dependency] of Object.entries(dependencies)) {
                if (method !== expectedMethod) expect(dependency).not.toHaveBeenCalled();
            }
        },
    );

    it("preserves preflight or online-verification failures for the dashboard", async () => {
        const dependencies = createDependencies();
        dependencies.restart.mockRejectedValue(
            new Error("服务重启命令已执行，但在线验证失败：实例未切换"),
        );

        await expect(
            executeDashboardServiceAction("restart", "user", dependencies),
        ).rejects.toThrow(/在线验证失败.*实例未切换/);
    });
});
