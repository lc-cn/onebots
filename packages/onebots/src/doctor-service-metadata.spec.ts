import { describe, expect, it, vi } from "vitest";
import { inspectDoctorServiceMetadata } from "./doctor-service-metadata.js";
import type { ServiceController, ServiceSpec } from "./service-manager.js";

describe("doctor service metadata", () => {
    it("保留有效服务定义", () => {
        const spec: ServiceSpec = {
            scope: "user",
            configPath: "/srv/onebots/config.yaml",
            adapters: ["mock"],
            protocols: ["onebot-v11"],
            nodePath: "/opt/node/bin/node",
            binPath: "/srv/onebots/bin.js",
            workingDirectory: "/srv/onebots",
        };
        const controller = controllerFixture(() => spec);

        expect(inspectDoctorServiceMetadata(controller)).toEqual({ spec, error: null });
    });

    it("将解析失败收敛为不含原始 JSON 的路径诊断", () => {
        const controller = controllerFixture(() => {
            throw new SyntaxError('Unexpected token near "secret-service-token"');
        });

        const inspection = inspectDoctorServiceMetadata(controller);

        expect(inspection).toEqual({
            spec: null,
            error: "服务元数据无法读取或结构无效: /state/onebots/service.json",
        });
        expect(inspection.error).not.toContain("secret-service-token");
    });
});

function controllerFixture(readSpec: () => ServiceSpec | null) {
    return {
        readSpec: vi.fn(readSpec),
        paths: vi.fn(() => ({
            stateDir: "/state/onebots",
            definition: "/state/onebots/service.plist",
            metadata: "/state/onebots/service.json",
        })),
    } satisfies Pick<ServiceController, "paths" | "readSpec">;
}
