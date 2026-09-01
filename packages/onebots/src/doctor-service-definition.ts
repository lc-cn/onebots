import type { ServiceController, ServiceSpec } from "./service-manager.js";

export interface DoctorServiceDefinitionInspection {
    current: boolean;
    error: string | null;
}

/** 将平台服务定义的读取或比对异常收敛为 doctor 可持久化的脱敏证据。 */
export function inspectDoctorServiceDefinition(
    controller: Pick<ServiceController, "definitionIsCurrent" | "paths">,
    spec: ServiceSpec,
): DoctorServiceDefinitionInspection {
    try {
        return { current: controller.definitionIsCurrent(spec), error: null };
    } catch {
        return {
            current: false,
            error: `服务平台定义无法读取或验证: ${controller.paths().definition}`,
        };
    }
}
