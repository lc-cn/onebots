import { probeDoctorManagement, type DoctorManagementExpectedPaths } from "./doctor-management.js";
import { probeDoctorManagementPage } from "./doctor-management-page.js";
import type { DoctorCheck, DoctorEndpointIdentity } from "./doctor-endpoint.js";

export interface DoctorManagementSurfaceProbeOptions {
    baseUrl: string;
    webUrl: string;
    config: Record<string, unknown>;
    expectedIdentity?: DoctorEndpointIdentity;
    expectedPaths?: DoctorManagementExpectedPaths;
}

export interface DoctorManagementSurfaceProbeDependencies {
    probePage?: (webUrl: string, configuredPath: unknown) => Promise<DoctorCheck>;
    probeManagement?: (
        baseUrl: string,
        config: Record<string, unknown>,
        expectedIdentity?: DoctorEndpointIdentity,
        expectedPaths?: DoctorManagementExpectedPaths,
    ) => Promise<DoctorCheck[]>;
}

/** 并行验证 Web 入口与受保护管理 API，并保持稳定的报告顺序。 */
export async function probeDoctorManagementSurface(
    options: DoctorManagementSurfaceProbeOptions,
    dependencies: DoctorManagementSurfaceProbeDependencies = {},
): Promise<DoctorCheck[]> {
    const probePage = dependencies.probePage ?? probeDoctorManagementPage;
    const probeManagement =
        dependencies.probeManagement ??
        ((baseUrl, config, expectedIdentity, expectedPaths) =>
            probeDoctorManagement(baseUrl, config, { expectedIdentity, expectedPaths }));
    const [page, management] = await Promise.all([
        probePage(options.webUrl, options.config.path),
        probeManagement(
            options.baseUrl,
            options.config,
            options.expectedIdentity,
            options.expectedPaths,
        ),
    ]);
    return [page, ...management];
}
