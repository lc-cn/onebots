import { describe, expect, it, vi } from "vitest";
import {
    assertInstalledServiceDefinitionCurrent,
    assertManagedRuntimeDefinitionsCurrent,
} from "./service-definition-preflight.js";
import type { ServiceSpec } from "./service-manager.js";

const spec: ServiceSpec = {
    scope: "user",
    configPath: "/srv/onebots/config.yaml",
    adapters: [],
    protocols: [],
    nodePath: "/opt/node/bin/node",
    binPath: "/srv/onebots/bin.js",
    workingDirectory: "/srv/onebots",
};

function controller(current: boolean, value: ServiceSpec | null = spec) {
    return {
        readSpec: vi.fn(() => value),
        definitionIsCurrent: vi.fn(() => current),
        definitionPath: vi.fn(() => "/state/onebots.service"),
    };
}

describe("service definition preflight", () => {
    it("拒绝漂移的平台定义并只公开定义路径", () => {
        const target = controller(false);

        expect(() => assertInstalledServiceDefinitionCurrent(target, spec)).toThrow(
            "服务平台定义与服务元数据不一致: /state/onebots.service",
        );
    });

    it("以完整运行身份匹配受管服务，不接受相邻安装", () => {
        const user = controller(true, { ...spec, configPath: "/srv/other/config.yaml" });
        const system = controller(true, spec);

        expect(() =>
            assertManagedRuntimeDefinitionsCurrent(
                {
                    configPath: spec.configPath,
                    nodePath: spec.nodePath,
                    binPath: spec.binPath,
                    workingDirectory: spec.workingDirectory,
                },
                [
                    ["user", user],
                    ["system", system],
                ],
            ),
        ).not.toThrow();
        expect(user.definitionIsCurrent).not.toHaveBeenCalled();
        expect(system.definitionIsCurrent).toHaveBeenCalledWith(spec);
    });

    it("同一运行身份存在多个 scope 时拒绝任一漂移定义", () => {
        const user = controller(true);
        const system = controller(false, { ...spec, scope: "system" });

        expect(() =>
            assertManagedRuntimeDefinitionsCurrent(
                {
                    configPath: spec.configPath,
                    nodePath: spec.nodePath,
                    binPath: spec.binPath,
                    workingDirectory: spec.workingDirectory,
                },
                [
                    ["user", user],
                    ["system", system],
                ],
            ),
        ).toThrow("系统级服务重启定义无效");
    });
});
