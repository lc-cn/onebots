import { probeDoctorManagement } from "./doctor-management.js";
import { probeDoctorManagementPage } from "./doctor-management-page.js";
import type { DoctorCheck } from "./doctor-endpoint.js";

export interface DoctorManagementSurfaceProbeOptions {
    baseUrl: string;
    webUrl: string;
    config: Record<string, unknown>;
}

export interface DoctorManagementSurfaceProbeDependencies {
    probePage?: (webUrl: string, configuredPath: unknown) => Promise<DoctorCheck>;
    probeManagement?: (baseUrl: string, config: Record<string, unknown>) => Promise<DoctorCheck[]>;
}

/** 并行验证 Web 入口与受保护管理 API，并保持稳定的报告顺序。 */
export async function probeDoctorManagementSurface(
    options: DoctorManagementSurfaceProbeOptions,
    dependencies: DoctorManagementSurfaceProbeDependencies = {},
): Promise<DoctorCheck[]> {
    const probePage = dependencies.probePage ?? probeDoctorManagementPage;
    const probeManagement = dependencies.probeManagement ?? probeDoctorManagement;
    const [page, management] = await Promise.all([
        probePage(options.webUrl, options.config.path),
        probeManagement(options.baseUrl, options.config),
    ]);
    return [page, ...management];
}
