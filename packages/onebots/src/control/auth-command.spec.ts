import { describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
    recover: vi.fn(async () => ({ code: "recovery-code" })),
    bootstrap: vi.fn(async () => ({ code: "bootstrap-code" })),
    output: vi.fn(),
    client: vi.fn(),
}));
vi.mock("../client/local-control.js", () => ({ createLocalControlClient: mock.client }));
vi.mock("./host.js", () => ({ startControlHost: vi.fn() }));
vi.mock("../cli-output.js", () => ({ writeCliOutput: mock.output }));
import { runControlCommand } from "./command.js";
describe("本地认证恢复命令", () => {
    it("新增设备命令只请求本地追加授权，不使用恢复重置", async () => {
        const authorizeDevice = vi.fn(async () => ({ code: "device-code" }));
        const recoverAuthentication = vi.fn();
        mock.client.mockReturnValue({ authorizeDevice, recoverAuthentication });
        await runControlCommand(["node", "onebots", "auth", "device", "--data-dir", "/tmp/private-workspace"]);
        expect(authorizeDevice).toHaveBeenCalledOnce();
        expect(recoverAuthentication).not.toHaveBeenCalled();
        expect(mock.output).toHaveBeenCalledWith("device-code");
    });
    it("recover只请求本地控制client并输出本次码，不删文件或提前撤销", async () => {
        mock.client.mockReturnValue({
            recoverAuthentication: mock.recover,
            bootstrap: mock.bootstrap,
        });
        await runControlCommand([
            "node",
            "onebots",
            "auth",
            "recover",
            "--data-dir",
            "/tmp/private-workspace",
        ]);
        expect(mock.client).toHaveBeenCalledWith("/tmp/private-workspace");
        expect(mock.recover).toHaveBeenCalledOnce();
        expect(mock.bootstrap).not.toHaveBeenCalled();
        expect(mock.output).toHaveBeenCalledWith("recovery-code");
    });
    it("帮助说明恢复期限，拒绝凭证argv且错误不回显输入", async () => {
        await expect(runControlCommand(["node", "onebots", "auth", "help"])).rejects.toThrow(
            "5 分钟",
        );
        await expect(
            runControlCommand(["node", "onebots", "auth", "recover", "--token", "secret-value"]),
        ).rejects.not.toThrow("secret-value");
    });
});
