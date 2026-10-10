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

function controlledDatabase() {
    const read = { onsuccess: undefined as (() => void) | undefined };
    const transaction = {
        oncomplete: undefined as (() => void) | undefined,
        onabort: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
        objectStore: () => ({ get: () => read }),
        abort: vi.fn(() => transaction.onabort?.()),
    };
    const database = { close: vi.fn(), transaction: () => transaction };
    const request = { result: database, onsuccess: undefined as (() => void) | undefined };
    vi.stubGlobal("indexedDB", { open: () => request });
    return { request, transaction, read, database };
}
it("锁就绪后执行动作，事务完成才返回结果并关闭连接", async () => {
    const fixture = controlledDatabase();
    const action = vi.fn(() => "original-operation");
    let resolved = false;
    const pending = withInstallationTrackingLock(action);
    void pending.then(() => {
        resolved = true;
    });
    expect(action).not.toHaveBeenCalled();
    fixture.request.onsuccess?.();
    expect(action).not.toHaveBeenCalled();
    fixture.read.onsuccess?.();
    expect(action).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(resolved).toBe(false);
    fixture.transaction.oncomplete?.();
    await expect(pending).resolves.toBe("original-operation");
    expect(fixture.database.close).toHaveBeenCalled();
});
it("动作异常原样拒绝并中止事务、关闭连接，不重试", async () => {
    const fixture = controlledDatabase();
    const failure = new Error("原操作记录已变化");
    const action = vi.fn(() => {
        throw failure;
    });
    const pending = withInstallationTrackingLock(action);
    fixture.request.onsuccess?.();
    fixture.read.onsuccess?.();
    await expect(pending).rejects.toBe(failure);
    expect(action).toHaveBeenCalledTimes(1);
    expect(fixture.transaction.abort).toHaveBeenCalledTimes(1);
    expect(fixture.database.close).toHaveBeenCalled();
});
