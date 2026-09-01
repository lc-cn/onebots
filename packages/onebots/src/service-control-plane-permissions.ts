import type { DoctorCheck } from "./doctor-endpoint.js";
import {
    inspectDoctorServiceDefinitionPermissions,
    inspectServiceDefinitionDirectoryPermissions,
} from "./doctor-service-definition.js";
import { inspectSensitiveFilePermissions } from "./doctor-permissions.js";
import { inspectDoctorServiceStateDirectory } from "./doctor-service-state.js";
import type { ServiceController, ServiceSpec } from "./service-manager.js";

type ServiceControlPlaneController = Pick<ServiceController, "definitionPath" | "paths">;

/** 汇总服务生命周期与状态报告共用的控制面权限证据。 */
export function inspectServiceControlPlanePermissions(
    controller: ServiceControlPlaneController,
    spec: ServiceSpec,
): DoctorCheck[] {
    const paths = controller.paths();
    const checks = [inspectDoctorServiceStateDirectory(paths.stateDir)];
    if (process.platform === "win32") return checks;
    return [
        ...checks,
        inspectServiceMetadataPermissions(paths.metadata),
        inspectDoctorServiceDefinitionPermissions(controller.definitionPath(spec)),
        inspectServiceDefinitionDirectoryPermissions(controller.definitionPath(spec)),
    ];
}

function inspectServiceMetadataPermissions(metadataPath: string): DoctorCheck {
    try {
        return inspectSensitiveFilePermissions(metadataPath, "service-metadata-mode", "服务元数据");
    } catch {
        return {
            name: "service-metadata-mode",
            level: "error",
            message: `服务元数据权限无法验证: ${metadataPath}`,
        };
    }
}
