import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
    source: vi.fn(),
    plan: vi.fn(),
    output: vi.fn(),
    client: vi.fn(),
}));
vi.mock("../client/local-control.js", () => ({ createLocalControlClient: mock.client }));
vi.mock("./host.js", () => ({ startControlHost: vi.fn() }));
vi.mock("../cli-output.js", () => ({ writeCliOutput: mock.output }));
import { runControlCommand } from "./command.js";
const base = { generationId: null, configRevision: "a".repeat(64) };
beforeEach(() => {
    vi.clearAllMocks();
    mock.client.mockReturnValue({ configurationSource: mock.source, planUpdate: mock.plan });
    mock.source.mockResolvedValue({ state: "ready", base });
    mock.plan.mockResolvedValue({ state: "current", base });
});
it("CLI检查只向管理服务提交其当前基线，输出可供后续确认的计划", async () => {
    await runControlCommand([
        "node",
        "onebots",
        "control",
        "plan-update",
        "--data-dir",
        "/tmp/update-workspace",
    ]);
    expect(mock.client).toHaveBeenCalledWith("/tmp/update-workspace");
    expect(mock.plan).toHaveBeenCalledExactlyOnceWith(base);
    expect(JSON.parse(mock.output.mock.calls[0][0])).toEqual({ state: "current", base });
});
it.each(["--version", "--url", "--token", "--auth-stdin", "--yes"])(
    "拒绝升级检查参数%s且不请求计划",
    async flag => {
        await expect(
            runControlCommand(["node", "onebots", "control", "plan-update", flag, "secret"]),
        ).rejects.not.toThrow("secret");
        expect(mock.source).not.toHaveBeenCalled();
        expect(mock.plan).not.toHaveBeenCalled();
    },
);
it("损坏配置不能创建升级计划", async () => {
    mock.source.mockResolvedValue({ state: "damaged", base });
    await expect(runControlCommand(["node", "onebots", "control", "plan-update"])).rejects.toThrow(
        "修复配置",
    );
    expect(mock.plan).not.toHaveBeenCalled();
});
