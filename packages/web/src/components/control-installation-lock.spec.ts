import { afterEach, expect, it, vi } from "vitest";
import { withInstallationTrackingLock } from "./control-installation-lock.js";
afterEach(() => vi.unstubAllGlobals());
it("跨标签页存储协调不可用时不执行安装记录写入", async () => {
    const action = vi.fn();
    vi.stubGlobal("indexedDB", undefined);
    await expect(withInstallationTrackingLock(action)).rejects.toThrow("不会提交新操作");
    expect(action).not.toHaveBeenCalled();
    vi.stubGlobal("indexedDB", {
        open: () => {
            throw new DOMException("Denied", "SecurityError");
        },
    });
    await expect(withInstallationTrackingLock(action)).rejects.toThrow("允许浏览器存储");
    expect(action).not.toHaveBeenCalled();
});
