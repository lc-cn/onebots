import { describe, expect, it } from "vitest";
import { assertInProcessPackageMutationAllowed, isContainerRuntime } from "./container-runtime.js";
describe("Docker 生命周期与扩展写入边界", () => {
    it("隔离模式拒绝在线包写入，普通宿主与 HF 原有模式保留行为", () => {
        expect(() =>
            assertInProcessPackageMutationAllowed({ ONEBOTS_EXTENSION_MODE: "isolated" }),
        ).toThrow("宿主机");
        expect(() => assertInProcessPackageMutationAllowed({})).not.toThrow();
        expect(() =>
            assertInProcessPackageMutationAllowed({ ONEBOTS_EXTENSION_MODE: "legacy" }),
        ).not.toThrow();
        expect(isContainerRuntime({ ONEBOTS_CONTAINER: "1" })).toBe(true);
    });
});
