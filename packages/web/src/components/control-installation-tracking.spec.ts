import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlInstallPlan } from "@onebots/core/control";
import {
    persistInstallationTracking,
    persistInstallationActivation,
    clearInstallationTracking,
    installationTrackingError,
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
        expect(JSON.parse(values.get(installationStorageKey)!)).toEqual(next);
    });

    it("安全随机数或本地存储不可用时拒绝提交，不遗留操作记录", () => {
        const storage = { getItem: () => null, setItem: vi.fn() };
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

const fixturePlan = { id: "a".repeat(64), planDigest: "b".repeat(64) } as ControlInstallPlan;
function fixtureStorage() {
    let value: string | null = null;
    return {
        getItem: () => value,
        setItem: (_key: string, next: string) => {
            value = next;
        },
        removeItem: () => {
            value = null;
        },
    };
}
describe("多页面安装记录边界", () => {
    it("第二个页面复用相同计划的编号，不覆盖其他计划", () => {
        const storage = fixtureStorage();
        const first = persistInstallationTracking(storage, undefined, fixturePlan);
        vi.stubGlobal("crypto", undefined);
        expect(persistInstallationTracking(storage, undefined, fixturePlan).id).toBe(first.id);
        expect(() =>
            persistInstallationTracking(storage, undefined, {
                ...fixturePlan,
                id: "c".repeat(64),
            }),
        ).toThrow("其他页面");
        expect(readInstallationTracking(storage)?.id).toBe(first.id);
    });
    it.each([
        "{",
        "null",
        "[]",
        "{}",
        '"bad"',
        JSON.stringify({
            id: "op",
            planId: fixturePlan.id,
            planDigest: fixturePlan.planDigest,
            activationRequested: "true",
        }),
    ])("损坏记录 %s 保留原文并拒绝新安装", value => {
        const storage = fixtureStorage();
        storage.setItem(installationStorageKey, value);
        expect(() => readInstallationTracking(storage)).toThrow("安装记录");
        expect(() => persistInstallationTracking(storage, undefined, fixturePlan)).toThrow(
            "安装记录",
        );
        expect(storage.getItem()).toBe(value);
    });
    it("过期页面不能覆盖或清除新操作，也不能重复应用", () => {
        const storage = fixtureStorage();
        const first = persistInstallationTracking(storage, undefined, fixturePlan);
        const requested = persistInstallationActivation(storage, first);
        expect(() => persistInstallationActivation(storage, first)).toThrow("已请求应用");
        expect(persistInstallationTracking(storage, first, fixturePlan).activationRequested).toBe(
            true,
        );
        expect(() => clearInstallationTracking(storage, first)).toThrow("已请求应用");
        clearInstallationTracking(storage, requested);
        expect(() => persistInstallationTracking(storage, first, fixturePlan)).toThrow("其他页面");
        const second = persistInstallationTracking(storage, undefined, fixturePlan);
        expect(second.id).not.toBe(first.id);
        expect(() => clearInstallationTracking(storage, first)).toThrow("其他页面");
        expect(readInstallationTracking(storage)?.id).toBe(second.id);
    });
    it("浏览器存储安全异常使用中文提示", () => {
        const denied = new DOMException("Access denied", "SecurityError");
        const storage = {
            getItem: () => {
                throw denied;
            },
            setItem: vi.fn(),
        };
        expect(() => persistInstallationTracking(storage, undefined, fixturePlan)).toThrow(
            "本地存储",
        );
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(installationTrackingError(denied)).toContain("本地存储");
        expect(installationTrackingError(denied)).not.toContain("Access denied");
    });
});
