import * as path from "node:path";
import { inspectDoctorServiceDefinition } from "./doctor-service-definition.js";
import { ServiceController, type ServiceScope, type ServiceSpec } from "./service-manager.js";

type ServiceDefinitionController = Pick<
    ServiceController,
    "readSpec" | "definitionIsCurrent" | "definitionPath"
>;

export interface ManagedRuntimeIdentity {
    configPath: string;
    nodePath: string;
    binPath: string;
    workingDirectory: string;
}

/** 在执行任何受管服务切换前，证明平台定义仍与已保存元数据一致。 */
export function assertInstalledServiceDefinitionCurrent(
    controller: ServiceDefinitionController,
    spec: ServiceSpec,
): void {
    const inspection = inspectDoctorServiceDefinition(controller, spec);
    if (inspection.current) return;
    throw new Error(
        inspection.error ??
            `服务平台定义与服务元数据不一致: ${controller.definitionPath(spec)}；请重新执行 onebots install`,
    );
}

/**
 * 受管进程内没有依赖可伪造的 scope 环境变量，而是以当前真实运行身份匹配服务元数据。
 * 若同一身份同时安装在两个 scope，所有匹配定义都必须一致。
 */
export function assertManagedRuntimeDefinitionsCurrent(
    identity: ManagedRuntimeIdentity,
    controllers: ReadonlyArray<readonly [ServiceScope, ServiceDefinitionController]> = [
        ["user", new ServiceController("user")],
        ["system", new ServiceController("system")],
    ],
): void {
    const matches: Array<readonly [ServiceScope, ServiceDefinitionController, ServiceSpec]> = [];
    for (const [scope, controller] of controllers) {
        let spec: ServiceSpec | null;
        try {
            spec = controller.readSpec();
        } catch {
            continue;
        }
        if (spec && serviceRuntimeIdentityMatches(spec, identity)) {
            matches.push([scope, controller, spec]);
        }
    }

    if (matches.length === 0) {
        throw new Error(
            "当前受管进程的配置、Node、入口或工作目录与已安装服务元数据不一致；请重新执行 onebots install",
        );
    }

    for (const [scope, controller, spec] of matches) {
        try {
            assertInstalledServiceDefinitionCurrent(controller, spec);
        } catch (error) {
            throw new Error(
                `${scope === "system" ? "系统级" : "用户级"}服务重启定义无效：${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
}

function serviceRuntimeIdentityMatches(
    spec: ServiceSpec,
    identity: ManagedRuntimeIdentity,
): boolean {
    return (
        path.resolve(spec.configPath) === path.resolve(identity.configPath) &&
        path.resolve(spec.nodePath) === path.resolve(identity.nodePath) &&
        path.resolve(spec.binPath) === path.resolve(identity.binPath) &&
        path.resolve(spec.workingDirectory) === path.resolve(identity.workingDirectory)
    );
}
