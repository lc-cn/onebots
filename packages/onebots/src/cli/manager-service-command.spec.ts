import { afterEach, describe, expect, it, vi } from "vitest";
import { controlManagerService } from "../manager-service-controller.js";
import { managerServiceCommand } from "./manager-service-command.js";
import type { ManagerServiceRecord } from "../manager-service-journal.js";
vi.mock("../manager-service-controller.js", () => ({ controlManagerService: vi.fn() }));
afterEach(() => {
    vi.mocked(controlManagerService).mockReset();
});
function record(): ManagerServiceRecord {
    return {
        schemaVersion: 1,
        id: "operation-1",
        action: "start",
        phase: "completed",
        status: "succeeded",
        recoveryRequired: false,
        desiredEnabled: true,
        managerSpecDigest: "a".repeat(64),
        managerSpec: {
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace: "/private/synthetic-workspace",
            workingDirectory: "/private/work",
            nodePath: "/private/node",
            binPath: "/private/bin.js",
            host: "127.0.0.1",
            port: 6727,
        },
    };
}
describe("manager lifecycle CLI mapping", () => {
    it.each(["start", "stop", "restart"] as const)(
        "%s delegates once to the unified controller and exposes no spec",
        async action => {
            vi.mocked(controlManagerService).mockResolvedValue({ ...record(), action });
            const result = await managerServiceCommand(action, { system: false });
            expect(controlManagerService).toHaveBeenCalledExactlyOnceWith(action, "user");
            expect(result.exitCode).toBe(0);
            expect(result.output).toContain("管理服务");
            expect(result.output).toContain("保留网关期望状态");
            expect(result.output).not.toContain("synthetic-workspace");
            expect(result.output).not.toContain("managerSpec");
        },
    );
    it("system option selects only the service scope", async () => {
        vi.mocked(controlManagerService).mockResolvedValue(record());
        await managerServiceCommand("stop", { system: true });
        expect(controlManagerService).toHaveBeenCalledExactlyOnceWith("stop", "system");
    });
    it.each(["interrupted", "failed", "running"] as const)(
        "%s is failure with operation id and phase, never a successful rollback",
        async status => {
            vi.mocked(controlManagerService).mockResolvedValue({
                ...record(),
                status,
                phase: "stopping",
                recoveryRequired: true,
            });
            const result = await managerServiceCommand("restart", { system: false });
            expect(result.exitCode).toBe(1);
            expect(result.output).toContain("operation-1");
            expect(result.output).toContain("stopping");
            expect(result.output).toContain(status);
            expect(result.output).not.toContain("已重启");
            expect(result.output).not.toContain("回滚成功");
        },
    );
    it("legacy service requires explicit migration without fallback", async () => {
        vi.mocked(controlManagerService).mockRejectedValue(
            new Error("旧服务须先执行 onebots migrate"),
        );
        expect(await managerServiceCommand("start", { system: false })).toMatchObject({
            exitCode: 1,
            output: expect.stringContaining("先执行 onebots migrate"),
        });
        expect(controlManagerService).toHaveBeenCalledTimes(1);
    });
    it("unknown exceptions do not leak OS output or private paths", async () => {
        vi.mocked(controlManagerService).mockRejectedValue(
            new Error("synthetic-secret /private/spec"),
        );
        const result = await managerServiceCommand("start", { system: false });
        expect(result.exitCode).toBe(1);
        expect(result.output).not.toContain("synthetic-secret");
        expect(result.output).not.toContain("/private/spec");
    });
});
