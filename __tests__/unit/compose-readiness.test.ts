import { expect, it, vi } from "vitest";
import { waitForComposeState } from "../../scripts/compose-recreation-readiness.mjs";

const state = (actual: string, desired = "running", available = true) => ({
    processOwnership: { available },
    gateway: { actual, desired },
});
function clock() {
    let time = 0;
    return {
        now: () => time,
        sleep: async (delay: number) => {
            time += delay;
        },
    };
}
it("socket 先可读、网关仍在 starting 时不能提前结束等待", async () => {
    const read = vi.fn().mockReturnValueOnce(state("starting")).mockReturnValue(state("running"));
    await expect(
        waitForComposeState(
            read,
            { ownership: true, desired: "running", actual: "running" },
            clock(),
        ),
    ).resolves.toEqual(state("running"));
    expect(read).toHaveBeenCalledTimes(2);
});
it("按每次重建要求等待 stopped 和拒绝接管状态，不把管理端可用当作业务就绪", async () => {
    const read = vi
        .fn()
        .mockReturnValueOnce(state("running"))
        .mockReturnValueOnce(state("stopped", "stopped"))
        .mockReturnValue(state("failed", "stopped", false));
    await expect(
        waitForComposeState(
            read,
            { ownership: false, desired: "stopped", actual: "failed" },
            clock(),
        ),
    ).resolves.toEqual(state("failed", "stopped", false));
    expect(read).toHaveBeenCalledTimes(3);
});
it("持续未就绪仍会失败，每次命令只获得剩余超时预算", async () => {
    const read = vi.fn(() => state("starting"));
    await expect(
        waitForComposeState(
            read,
            { ownership: true, desired: "running", actual: "running" },
            { ...clock(), timeout: 450 },
        ),
    ).rejects.toThrow("预期状态");
    expect(read.mock.calls).toEqual([[450], [250], [50]]);
});
