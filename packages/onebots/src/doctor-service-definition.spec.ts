import { describe, expect, it, vi } from "vitest";
import { inspectDoctorServiceDefinition } from "./doctor-service-definition.js";
import type { ServiceController, ServiceSpec } from "./service-manager.js";

const spec: ServiceSpec = {
    scope: "user",
    configPath: "/srv/onebots/config.yaml",
    adapters: [],
    protocols: [],
    nodePath: "/opt/node/bin/node",
    binPath: "/srv/onebots/lib/bin.js",
    workingDirectory: "/srv/onebots",
};

describe("doctor service platform definition", () => {
    it("保留定义与元数据一致的证据", () => {
        expect(
            inspectDoctorServiceDefinition(
                controllerFixture(() => true),
                spec,
            ),
        ).toEqual({
            current: true,
            error: null,
        });
    });

    it("将读取异常收敛为不含文件内容的路径诊断", () => {
        const inspection = inspectDoctorServiceDefinition(
            controllerFixture(() => {
                throw new Error("unit contains ACCESS_TOKEN=secret-token");
            }),
            spec,
        );

        expect(inspection).toEqual({
            current: false,
            error: "服务平台定义无法读取或验证: /state/onebots/onebots.service",
        });
        expect(inspection.error).not.toContain("secret-token");
    });
});

function controllerFixture(definitionIsCurrent: (spec: ServiceSpec) => boolean) {
    return {
        definitionIsCurrent: vi.fn(definitionIsCurrent),
        paths: vi.fn(() => ({
            stateDir: "/state/onebots",
            definition: "/state/onebots/onebots.service",
            metadata: "/state/onebots/service.json",
        })),
    } satisfies Pick<ServiceController, "definitionIsCurrent" | "paths">;
}
