import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlInstallPlan } from "@onebots/core/control";
import {
    persistInstallationTracking,
    readInstallationTracking,
    installationStorageKey,
} from "./control-installation-tracking.js";

afterEach(() => vi.unstubAllGlobals());
describe("安装操作持久化", () => {
    it("HTTP 页面创建 UUID 并持久化，重读与重试复用原操作", () => {
        vi.stubGlobal("crypto", {
            getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
        });
        const values = new Map<string, string>();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => {
                values.set(key, value);
            },
        };
        const plan = { id: "a".repeat(64), planDigest: "b".repeat(64) } as ControlInstallPlan;
        const next = persistInstallationTracking(storage, undefined, plan);
        expect(next.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        const restored = readInstallationTracking(storage);
        expect(restored).toMatchObject(next);
        vi.stubGlobal("crypto", undefined);
        expect(persistInstallationTracking(storage, restored, undefined)).toEqual(restored);
        expect(JSON.parse(values.get(installationStorageKey)!)).toEqual(restored);
    });

    it("安全随机数或本地存储不可用时拒绝提交，不遗留操作记录", () => {
        const storage = { setItem: vi.fn() };
        const plan = { id: "a".repeat(64), planDigest: "b".repeat(64) } as ControlInstallPlan;
        const crypto = globalThis.crypto;
        vi.stubGlobal("crypto", undefined);
        expect(() => persistInstallationTracking(storage, undefined, plan)).toThrow("安全操作编号");
        expect(storage.setItem).not.toHaveBeenCalled();
        vi.stubGlobal("crypto", crypto);
        storage.setItem.mockImplementation(() => {
            throw new Error("quota");
        });
        expect(() => persistInstallationTracking(storage, undefined, plan)).toThrow("本地存储");
    });
});
