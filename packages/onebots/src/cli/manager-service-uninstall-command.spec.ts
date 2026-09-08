import { afterEach, describe, expect, it, vi } from "vitest";
import { uninstallManagerService } from "../manager-service-uninstall.js";
import type { ManagerServiceRecord } from "../manager-service-journal.js";
import { managerServiceUninstallCommand } from "./manager-service-uninstall-command.js";

vi.mock("../manager-service-uninstall.js", () => ({ uninstallManagerService: vi.fn() }));
vi.mock("../service-manager.js", () => { throw new Error("禁止导入旧服务实现"); });
afterEach(() => vi.mocked(uninstallManagerService).mockReset());
const secret = "synthetic-secret-must-not-appear";
function record(): ManagerServiceRecord {
    const file = { path: `/private/${secret}`, sha256: "a".repeat(64), dev: "1", ino: "2",
        uid: 501, mode: 0o600, size: 8, ctimeNs: "1", mtimeNs: "1" };
    return {
        schemaVersion: 1, id: "uninstall-test-id", action: "uninstall", phase: "completed",
        status: "succeeded", recoveryRequired: false, desiredEnabled: false,
        managerSpecDigest: "b".repeat(64),
        managerSpec: { schemaVersion: 1, runtimeKind: "control", scope: "user", workspace: `/private/${secret}`,
            nodePath: "/bin/node", binPath: "/app/bin.js", workingDirectory: "/app", host: "127.0.0.1", port: 6727 },
        removal: { platform: "darwin", files: { definition: file, metadata: file },
            initial: { enabled: true, processId: 4321, identity: secret } },
    };
}
function safe(output: string | undefined): void {
    expect(output).not.toContain(secret);
    expect(output).not.toContain("managerSpec");
    expect(output).not.toContain("removal");
    expect(output).not.toContain("4321");
}
describe("管理服务卸载 CLI", () => {
    it.each([false, true])("成功仅输出操作摘要和保留数据说明，system=%s", async system => {
        vi.mocked(uninstallManagerService).mockResolvedValue(record());
        const result = await managerServiceUninstallCommand({ system });
        expect(uninstallManagerService).toHaveBeenCalledExactlyOnceWith(system ? "system" : "user");
        expect(result).toEqual({ exitCode: 0, output:
            "操作 uninstall-test-id：succeeded（completed）\n系统托管已卸载，工作区、认证、配置、账号数据及日志全部保留。" });
        safe(result.output);
    });
    it.each(["running", "failed", "interrupted", "succeeded"] as const)(
        "%s 且待对账时非零退出，不声称卸载成功", async status => {
            vi.mocked(uninstallManagerService).mockResolvedValue({ ...record(), status,
                phase: "removing-metadata", recoveryRequired: true });
            const result = await managerServiceUninstallCommand({ system: false });
            expect(result.exitCode).toBe(1);
            expect(result.output).toContain("尚待对账");
            expect(result.output).toContain("请勿重复卸载或重新安装");
            expect(result.output).not.toContain("系统托管已卸载");
            safe(result.output);
        },
    );
    it.each([
        ["旧服务须先执行 onebots migrate", "检测到旧服务，请先执行 onebots migrate；未使用旧卸载路径。"],
        ["系统级服务需要管理员权限", "系统级服务需要管理员权限，未执行卸载。"],
        [secret, "管理服务卸载未完成，请检查本机服务记录；不会根据元数据缺失猜测已卸载。"],
    ])("失败使用固定提示：%s", async (message, expected) => {
        vi.mocked(uninstallManagerService).mockRejectedValue(new Error(message));
        const result = await managerServiceUninstallCommand({ system: true });
        expect(result).toEqual({ exitCode: 1, output: expected });
        expect(uninstallManagerService).toHaveBeenCalledExactlyOnceWith("system");
        safe(result.output);
    });
});
