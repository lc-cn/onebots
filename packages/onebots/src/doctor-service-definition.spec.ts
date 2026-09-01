import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    inspectDoctorServiceDefinition,
    inspectDoctorServiceDefinitionPermissions,
} from "./doctor-service-definition.js";
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
const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

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

    it.runIf(process.platform !== "win32")("拒绝并修复可被其他用户修改的定义", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-definition-"));
        temporaryDirectories.push(directory);
        const definition = path.join(directory, "onebots.service");
        fs.writeFileSync(definition, "[Service]\n", { mode: 0o666 });
        fs.chmodSync(definition, 0o666);

        const unsafe = inspectDoctorServiceDefinitionPermissions(definition);
        expect(unsafe).toMatchObject({ name: "service-definition-mode", level: "error" });
        expect(unsafe).not.toHaveProperty("fixed");
        expect(fs.statSync(definition).mode & 0o777).toBe(0o666);

        expect(inspectDoctorServiceDefinitionPermissions(definition, true)).toEqual({
            name: "service-definition-mode",
            level: "ok",
            message: "已将服务定义权限从 666 收紧为 0644",
            fixed: true,
        });
        expect(fs.statSync(definition).mode & 0o777).toBe(0o644);
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
