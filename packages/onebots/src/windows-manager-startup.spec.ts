import { afterEach, expect, it, vi } from "vitest";
import { publishWindowsManagerStartup } from "./windows-manager-startup.js";
afterEach(() => vi.useRealTimers());
it("拒绝态沿用正常 manager 的 native pipe 启动窗口，不改变50次/100ms边界", async () => {
    vi.useFakeTimers();
    const publish = vi
        .fn()
        .mockRejectedValueOnce(new Error("pipe not created yet"))
        .mockResolvedValue(undefined);
    const result = publishWindowsManagerStartup(publish);
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(publish).toHaveBeenCalledTimes(2);
    const failure = vi.fn().mockRejectedValue(new Error("unavailable"));
    const failed = publishWindowsManagerStartup(failure);
    const assertion = expect(failed).rejects.toThrow("原生宿主状态发布失败");
    await vi.runAllTimersAsync();
    await assertion;
    expect(failure).toHaveBeenCalledTimes(50);
});
