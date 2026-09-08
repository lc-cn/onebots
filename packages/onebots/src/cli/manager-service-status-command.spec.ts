import { afterEach, describe, expect, it, vi } from "vitest";
import {
    inspectManagerServiceStatus,
    type ManagerServiceStatus,
} from "../manager-service-status.js";
import { managerServiceStatusCommand } from "./manager-service-status-command.js";
vi.mock("../manager-service-status.js", () => ({ inspectManagerServiceStatus: vi.fn() }));
afterEach(() => vi.mocked(inspectManagerServiceStatus).mockReset());
function status(): ManagerServiceStatus {
    return {
        schemaVersion: 1,
        scope: "user",
        installation: "control",
        serviceRecoveryRequired: false,
        recovery: {
            serviceRecoveryRequired: false,
            readable: true,
            truncated: false,
            operations: [],
        },
        manager: { state: "running", enabled: true, loaded: true, pid: 42, ipc: "available" },
        gateway: {
            actual: "failed",
            desired: "running",
            recoveryRequired: false,
            knownConfigurationFailure: true,
        },
        diagnostic: null,
    };
}
describe("manager status CLI", () => {
    it("元数据已删除时仍显示原卸载操作，并给出匹配范围的对账命令", async () => {
        const value = status();
        value.installation = "missing";
        value.diagnostic = "not-installed";
        value.serviceRecoveryRequired = true;
        value.recovery = {
            serviceRecoveryRequired: true,
            readable: true,
            truncated: false,
            operations: [
                {
                    kind: "manager",
                    id: "original-operation",
                    action: "uninstall",
                    status: "interrupted",
                    phase: "verifying",
                },
            ],
        };
        vi.mocked(inspectManagerServiceStatus).mockResolvedValue(value);
        const result = await managerServiceStatusCommand({ system: true });
        expect(result.output).toContain("待核实操作 original-operation");
        expect(result.output).toContain("onebots recover --operation original-operation --system");
        expect(result.exitCode).toBe(1);
    });
    it("多个或不可完整读取的操作不推荐单项对账", async () => {
        const value = status();
        value.serviceRecoveryRequired = true;
        value.recovery = {
            serviceRecoveryRequired: true,
            readable: true,
            truncated: false,
            operations: ["first", "second"].map(id => ({
                kind: "manager",
                id,
                action: "stop",
                status: "interrupted",
                phase: "stopping",
            })),
        };
        vi.mocked(inspectManagerServiceStatus).mockResolvedValue(value);
        expect((await managerServiceStatusCommand({ system: false })).output).not.toContain(
            "onebots recover",
        );
        value.recovery = {
            serviceRecoveryRequired: true,
            readable: false,
            truncated: false,
            operations: [],
        };
        const result = await managerServiceStatusCommand({ system: false });
        expect(result.output).toContain("无法完整读取");
        expect(result.output).not.toContain("onebots recover");
    });
    it("系统操作待对账独立于正常网关，文本及JSON均非零退出", async () => {
        const value = {
            ...status(),
            serviceRecoveryRequired: true,
            gateway: {
                actual: "running" as const,
                desired: "running" as const,
                recoveryRequired: false,
                knownConfigurationFailure: false,
            },
        };
        vi.mocked(inspectManagerServiceStatus).mockResolvedValue(value);
        const text = await managerServiceStatusCommand({ system: false });
        expect(text.exitCode).toBe(1);
        expect(text.output).toContain("系统服务操作或迁移结果尚待核实");
        const json = await managerServiceStatusCommand({ system: false, json: true });
        expect(json.exitCode).toBe(1);
        expect(JSON.parse(json.output!).serviceRecoveryRequired).toBe(true);
    });
    it("分别显示运行manager和失败gateway，失败不是停机", async () => {
        vi.mocked(inspectManagerServiceStatus).mockResolvedValue(status());
        const result = await managerServiceStatusCommand({ system: false });
        expect(inspectManagerServiceStatus).toHaveBeenCalledExactlyOnceWith("user");
        expect(result.output).toContain("管理服务（OS）：运行中");
        expect(result.output).toContain("网关：实际失败；期望运行中");
        expect(result.output).toContain("控制台修复");
        expect(result.exitCode).toBe(1);
    });
    it("json是单一新状态摘要，system只决定scope", async () => {
        vi.mocked(inspectManagerServiceStatus).mockResolvedValue(status());
        const result = await managerServiceStatusCommand({ system: true, json: true });
        expect(inspectManagerServiceStatus).toHaveBeenCalledExactlyOnceWith("system");
        expect(JSON.parse(result.output!)).toEqual(status());
    });
    it.each(["legacy", "missing", "invalid"] as const)(
        "%s明确提示，不尝试旧status",
        async installation => {
            const diagnostic =
                installation === "legacy"
                    ? "migration-required"
                    : installation === "missing"
                      ? "not-installed"
                      : "invalid-metadata";
            vi.mocked(inspectManagerServiceStatus).mockResolvedValue({
                ...status(),
                installation,
                diagnostic,
            });
            const result = await managerServiceStatusCommand({ system: false });
            expect(result.exitCode).toBe(1);
            expect(result.output).toContain(
                installation === "legacy"
                    ? "onebots migrate"
                    : installation === "missing"
                      ? "尚未安装"
                      : "元数据无效",
            );
        },
    );
});
