import type { ServiceController, ServiceSpec } from "./service-manager.js";

export interface DoctorServiceMetadataInspection {
    spec: ServiceSpec | null;
    error: string | null;
}

/**
 * doctor 必须能诊断损坏的服务元数据；解析器原始异常可能带 JSON 片段，因此公开结果只返回路径。
 */
export function inspectDoctorServiceMetadata(
    controller: Pick<ServiceController, "paths" | "readSpec">,
): DoctorServiceMetadataInspection {
    try {
        return { spec: controller.readSpec(), error: null };
    } catch {
        return {
            spec: null,
            error: `服务元数据无法读取或结构无效: ${controller.paths().metadata}`,
        };
    }
}
