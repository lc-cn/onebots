import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { serviceStatus, type ServiceStatusReport } from "./command-application.js";
import { ServiceController, type ServiceSpec } from "../service-manager.js";
import packageMetadata from "../../package.json" with { type: "json" };
import { resolveServiceRuntimeContractId } from "../service-runtime-contract.js";
import { renderManagementIndexHtml } from "../management-index.js";

const temporaryDirectories: string[] = [];
let activeRuntimeContractId = "";
const validStatusDependencies = {
    inspectNode: (nodePath: string) => ({
        supported: true,
        check: {
            name: "service-node",
            level: "ok" as const,
            message: `服务 Node 可用: ${nodePath}`,
        },
    }),
    inspectEntry: (binPath: string) => ({
        valid: true,
        check: { name: "service-entry", level: "ok" as const, message: `服务入口有效: ${binPath}` },
    }),
};

function runServiceStatus(
    options: Parameters<typeof serviceStatus>[0],
    fetcher: typeof fetch = fetch,
) {
    return serviceStatus(options, fetcher, validStatusDependencies);
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function serviceSpec(
    source = "port: 7788\npath: gateway\naccess_token: status-secret\n",
): ServiceSpec {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-status-"));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, "config.yaml");
    fs.writeFileSync(configPath, source, { encoding: "utf8", mode: 0o600 });
    return {
        scope: "user",
        configPath,
        adapters: [],
        protocols: [],
        nodePath: process.execPath,
        binPath: process.argv[1],
        workingDirectory: directory,
    };
}

function mockInstalledService(running: boolean, spec = serviceSpec()): void {
    activeRuntimeContractId = resolveServiceRuntimeContractId(spec);
    vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
        installed: true,
        running,
        scope: "user",
        detail: running ? "active" : "inactive",
    });
    vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(spec);
    mockCurrentDefinition(spec);
}

function mockCurrentDefinition(spec: ServiceSpec): void {
    vi.spyOn(ServiceController.prototype, "definitionPath").mockReturnValue(
        path.join(spec.workingDirectory, "onebots.service"),
    );
    vi.spyOn(ServiceController.prototype, "definitionIsCurrent").mockReturnValue(true);
}

function managementPageResponse(prefix = "/gateway", status = 200): Response {
    return new Response(
        renderManagementIndexHtml("<html><head></head><body></body></html>", prefix),
        {
            status,
            headers: {
                "content-type": "text/html; charset=utf-8",
                "referrer-policy": "no-referrer",
                "cache-control": "no-store",
            },
        },
    );
}

function createStatusFetcher(
    endpointFetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    pageResponse: () => Response = () => managementPageResponse(),
) {
    return vi.fn<typeof fetch>(async (input, init) =>
        new URL(String(input)).pathname === "/" ? pageResponse() : endpointFetcher(input, init),
    );
}

function expectedPermissionOutput(): string {
    return process.platform === "win32"
        ? ""
        : "\n配置文件权限 600 未向组或其他用户开放\n配置目录权限 700 不允许组或其他用户替换配置路径";
}

function expectedPermissionChecks() {
    return process.platform === "win32"
        ? []
        : [
              { name: "config-mode", level: "ok" },
              { name: "config-dir-mode", level: "ok" },
          ];
}

const expectedCredentialCheck = { name: "service-credentials", level: "ok" };

describe("service status", () => {
    it("reports liveness and readiness for a running service", async () => {
        const spec = serviceSpec();
        mockInstalledService(true, spec);
        const fetcher = createStatusFetcher(async input => {
            const endpoint = String(input).endsWith("/health") ? "health" : "ready";
            return new Response(
                JSON.stringify(
                    endpoint === "health"
                        ? {
                              status: "ok",
                              application: "onebots",
                              version: packageMetadata.version,
                              core_version: "1.2.5",
                              instance_id: "status-instance",
                              runtime_contract_id: activeRuntimeContractId,
                          }
                        : {
                              ready: true,
                              application: "onebots",
                              version: packageMetadata.version,
                              instance_id: "status-instance",
                              runtime_contract_id: activeRuntimeContractId,
                          },
                ),
                { status: 200 },
            );
        });

        const result = await runServiceStatus({ system: false }, fetcher);

        expect(result).toEqual({
            output: `运行中，已就绪\n进程管理器: active\n服务定义: 与元数据一致 (${path.join(spec.workingDirectory, "onebots.service")})\n服务 Node 可用: ${spec.nodePath}\n服务入口有效: ${spec.binPath}\n服务配置包含持久化管理凭据${expectedPermissionOutput()}\nhealth: HTTP 200；状态 ok；onebots@${packageMetadata.version}；@onebots/core@1.2.5\nready: HTTP 200；onebots@${packageMetadata.version}；实例 status-instance\nhealth 与 ready 均来自 onebots@${packageMetadata.version} 实例 status-instance\n在线进程的启动契约与服务元数据一致\nWeb 管理页可访问，Router 前缀为 /gateway`,
            exitCode: undefined,
        });
        expect(fetcher).toHaveBeenCalledWith(
            "http://127.0.0.1:7788/gateway/health",
            expect.anything(),
        );
    });

    it("保存的 OneBots 入口失效时不把健康旧进程报告为已就绪", async () => {
        const spec = serviceSpec();
        mockInstalledService(true, spec);
        const fetcher = createStatusFetcher(
            async input =>
                new Response(
                    JSON.stringify({
                        ...(String(input).endsWith("/health") ? { status: "ok" } : { ready: true }),
                        application: "onebots",
                        version: packageMetadata.version,
                        instance_id: "status-instance",
                        runtime_contract_id: activeRuntimeContractId,
                    }),
                    { status: 200 },
                ),
        );

        const result = await serviceStatus({ system: false, json: true }, fetcher, {
            ...validStatusDependencies,
            inspectEntry: binPath => ({
                valid: false,
                check: {
                    name: "service-entry",
                    level: "error",
                    message: `服务入口不可读取: ${binPath}`,
                },
            }),
        });
        const report = JSON.parse(result.output ?? "{}") as ServiceStatusReport;

        expect(result).toMatchObject({ exitCode: 1, raw: true });
        expect(report).toMatchObject({
            status: "unavailable",
            ok: false,
            serviceRuntime: {
                valid: false,
                checks: [
                    { name: "service-node", level: "ok" },
                    {
                        name: "service-entry",
                        level: "error",
                        message: `服务入口不可读取: ${spec.binPath}`,
                    },
                    expectedCredentialCheck,
                    ...expectedPermissionChecks(),
                ],
            },
            probe: {
                checks: [
                    { name: "health", level: "ok" },
                    { name: "ready", level: "ok" },
                    { name: "probe-instance", level: "ok" },
                    { name: "service-runtime-contract", level: "ok" },
                    { name: "management-page", level: "ok" },
                ],
            },
        });
    });

    it.runIf(process.platform !== "win32")(
        "配置权限在启动后漂移时不再把健康进程报告为已就绪",
        async () => {
            const spec = serviceSpec();
            fs.chmodSync(spec.configPath, 0o644);
            mockInstalledService(true, spec);
            const fetcher = createStatusFetcher(
                async input =>
                    new Response(
                        JSON.stringify({
                            ...(String(input).endsWith("/health")
                                ? { status: "ok" }
                                : { ready: true }),
                            application: "onebots",
                            version: packageMetadata.version,
                            instance_id: "permission-drift-instance",
                            runtime_contract_id: activeRuntimeContractId,
                        }),
                        { status: 200 },
                    ),
            );

            const result = await runServiceStatus({ system: false, json: true }, fetcher);
            const report = JSON.parse(result.output ?? "{}") as ServiceStatusReport;

            expect(result).toMatchObject({ exitCode: 1, raw: true });
            expect(report).toMatchObject({
                status: "unavailable",
                ok: false,
                serviceRuntime: { valid: false },
            });
            expect(report.serviceRuntime.checks).toContainEqual({
                name: "config-mode",
                level: "error",
                message: expect.stringContaining("配置文件权限 644"),
            });
            expect(report.probe.checks).toContainEqual(
                expect.objectContaining({ name: "health", level: "ok" }),
            );
        },
    );

    it("持久化凭据在启动后被删除时不再把健康进程报告为可安全重启", async () => {
        const spec = serviceSpec("port: 7788\npath: gateway\n");
        mockInstalledService(true, spec);
        const fetcher = createStatusFetcher(
            async input =>
                new Response(
                    JSON.stringify({
                        ...(String(input).endsWith("/health") ? { status: "ok" } : { ready: true }),
                        application: "onebots",
                        version: packageMetadata.version,
                        instance_id: "credential-drift-instance",
                        runtime_contract_id: activeRuntimeContractId,
                    }),
                    { status: 200 },
                ),
        );

        const result = await runServiceStatus({ system: false, json: true }, fetcher);
        const report = JSON.parse(result.output ?? "{}") as ServiceStatusReport;

        expect(result).toMatchObject({ exitCode: 1, raw: true });
        expect(report).toMatchObject({
            status: "unavailable",
            ok: false,
            serviceRuntime: { valid: false },
        });
        expect(report.serviceRuntime.checks).toContainEqual({
            name: "service-credentials",
            level: "error",
            message: expect.stringContaining("服务配置缺少持久化管理凭据"),
        });
        expect(report.probe.checks).toContainEqual(
            expect.objectContaining({ name: "health", level: "ok" }),
        );
    });

    it.runIf(process.platform !== "win32")(
        "组只读配置保留可见警告但不破坏健康服务状态",
        async () => {
            const spec = serviceSpec();
            fs.chmodSync(spec.configPath, 0o640);
            mockInstalledService(true, spec);
            const fetcher = createStatusFetcher(
                async input =>
                    new Response(
                        JSON.stringify({
                            ...(String(input).endsWith("/health")
                                ? { status: "ok" }
                                : { ready: true }),
                            application: "onebots",
                            version: packageMetadata.version,
                            instance_id: "group-readable-instance",
                            runtime_contract_id: activeRuntimeContractId,
                        }),
                        { status: 200 },
                    ),
            );

            const result = await runServiceStatus({ system: false, json: true }, fetcher);
            const report = JSON.parse(result.output ?? "{}") as ServiceStatusReport;

            expect(result.exitCode).toBeUndefined();
            expect(report).toMatchObject({ status: "ready", ok: true });
            expect(report.serviceRuntime).toMatchObject({ valid: true });
            expect(report.serviceRuntime.checks).toContainEqual({
                name: "config-mode",
                level: "warning",
                message: expect.stringContaining("配置文件权限 640"),
            });
        },
    );

    it("拒绝把同版本但启动契约不同的进程报告为当前服务", async () => {
        const spec = serviceSpec();
        mockInstalledService(true, spec);
        const fetcher = vi.fn<typeof fetch>(
            async input =>
                new Response(
                    JSON.stringify({
                        ...(String(input).endsWith("/health") ? { status: "ok" } : { ready: true }),
                        application: "onebots",
                        version: packageMetadata.version,
                        instance_id: "foreign-contract-instance",
                        runtime_contract_id: "sha256:foreign-contract",
                    }),
                    { status: 200 },
                ),
        );

        const result = await runServiceStatus({ system: false, json: true }, fetcher);
        const report = JSON.parse(result.output ?? "{}") as ServiceStatusReport;

        expect(result).toMatchObject({ exitCode: 1, raw: true });
        expect(report).toMatchObject({
            status: "unavailable",
            ok: false,
            probe: {
                checks: [
                    { name: "health", level: "ok" },
                    { name: "ready", level: "ok" },
                    { name: "probe-instance", level: "ok" },
                    {
                        name: "service-runtime-contract",
                        level: "error",
                        message: expect.stringContaining("启动契约与服务元数据不一致"),
                    },
                ],
            },
        });
    });

    it("拒绝用漂移的平台定义拼接进程与 HTTP 证据", async () => {
        const spec = serviceSpec();
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(spec);
        vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
            installed: true,
            running: true,
            scope: "user",
            detail: "active",
        });
        vi.spyOn(ServiceController.prototype, "definitionPath").mockReturnValue(
            path.join(spec.workingDirectory, "onebots.service"),
        );
        vi.spyOn(ServiceController.prototype, "definitionIsCurrent").mockReturnValue(false);
        const fetcher = vi.fn<typeof fetch>();

        const result = await runServiceStatus({ system: false, json: true }, fetcher);
        const report = JSON.parse(result.output ?? "{}") as ServiceStatusReport;

        expect(result).toMatchObject({ exitCode: 1, raw: true });
        expect(report).toMatchObject({
            status: "unavailable",
            ok: false,
            target: { configPath: spec.configPath, baseUrl: null, webUrl: null },
            serviceDefinition: {
                path: path.join(spec.workingDirectory, "onebots.service"),
                current: false,
                error: "服务平台定义与服务元数据不一致，请重新执行 onebots install",
            },
            probe: {
                checks: [],
                error: "服务平台定义与服务元数据不一致，请重新执行 onebots install，未执行 HTTP 探测",
            },
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("keeps a reachable first-run management surface successful but pending", async () => {
        mockInstalledService(true);
        const fetcher = createStatusFetcher(async input =>
            String(input).endsWith("/health")
                ? new Response(
                      JSON.stringify({
                          status: "ok",
                          application: "onebots",
                          version: packageMetadata.version,
                          instance_id: "status-instance",
                          runtime_contract_id: activeRuntimeContractId,
                      }),
                      { status: 200 },
                  )
                : new Response(
                      JSON.stringify({
                          ready: true,
                          application: "onebots",
                          version: packageMetadata.version,
                          instance_id: "status-instance",
                          runtime_contract_id: activeRuntimeContractId,
                          configured: false,
                          summary: { online_accounts: 0, total_accounts: 0 },
                      }),
                      { status: 200 },
                  ),
        );

        const result = await runServiceStatus({ system: false }, fetcher);

        expect(result.exitCode).toBeUndefined();
        expect(result.output).toContain("运行中，待配置");
        expect(result.output).toContain(
            `ready: HTTP 200；onebots@${packageMetadata.version}；实例 status-instance；未配置账号；账号 0/0 在线`,
        );

        const jsonResult = await runServiceStatus({ system: false, json: true }, fetcher);
        expect(JSON.parse(jsonResult.output ?? "{}")).toMatchObject({
            status: "pending_configuration",
            ok: true,
            probe: {
                checks: [
                    { level: "ok" },
                    { level: "warning" },
                    { level: "ok" },
                    { name: "service-runtime-contract", level: "ok" },
                    { name: "management-page", level: "ok" },
                ],
            },
        });
    });

    it("returns exit code 1 when the running service version differs from the current CLI", async () => {
        mockInstalledService(true);
        const fetcher = vi.fn<typeof fetch>(async input =>
            String(input).endsWith("/health")
                ? new Response(
                      JSON.stringify({
                          status: "ok",
                          application: "onebots",
                          version: "0.0.0",
                          instance_id: "status-instance",
                      }),
                      { status: 200 },
                  )
                : new Response(
                      JSON.stringify({
                          ready: true,
                          application: "onebots",
                          version: packageMetadata.version,
                          instance_id: "status-instance",
                      }),
                      { status: 200 },
                  ),
        );

        const result = await runServiceStatus({ system: false }, fetcher);

        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("运行中，不可用");
        expect(result.output).toContain(
            `在线 OneBots 0.0.0 与当前 CLI ${packageMetadata.version} 不一致`,
        );
        expect(result.output).toContain("拒绝拼接不一致的探针证据");
    });

    it("distinguishes a consistently routed old instance as version unverified", async () => {
        mockInstalledService(true);
        const fetcher = vi.fn<typeof fetch>(
            async input =>
                new Response(
                    JSON.stringify({
                        ...(String(input).endsWith("/health") ? { status: "ok" } : { ready: true }),
                        application: "onebots",
                        version: "0.0.0",
                        instance_id: "old-instance",
                        runtime_contract_id: activeRuntimeContractId,
                    }),
                    { status: 200 },
                ),
        );

        const result = await runServiceStatus({ system: false, json: true }, fetcher);

        expect(result).toMatchObject({ exitCode: 1, raw: true });
        expect(JSON.parse(result.output ?? "{}")).toMatchObject({
            status: "version_unverified",
            ok: false,
            probe: {
                checks: [
                    { name: "health", level: "warning" },
                    { name: "ready", level: "ok" },
                    { name: "probe-instance", level: "ok" },
                    { name: "service-runtime-contract", level: "ok" },
                ],
                error: null,
            },
        });
    });

    it("rejects health and readiness routed to different service instances", async () => {
        mockInstalledService(true);
        const fetcher = vi.fn<typeof fetch>(async input =>
            String(input).endsWith("/health")
                ? new Response(
                      JSON.stringify({
                          status: "ok",
                          application: "onebots",
                          version: packageMetadata.version,
                          instance_id: "instance-new",
                          runtime_contract_id: activeRuntimeContractId,
                      }),
                      { status: 200 },
                  )
                : new Response(
                      JSON.stringify({
                          ready: true,
                          application: "onebots",
                          version: packageMetadata.version,
                          instance_id: "instance-old",
                          runtime_contract_id: activeRuntimeContractId,
                      }),
                      { status: 200 },
                  ),
        );

        const result = await runServiceStatus({ system: false }, fetcher);

        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("运行中，不可用");
        expect(result.output).toContain(
            `health 来自 onebots@${packageMetadata.version} 实例 instance-new，ready 来自 onebots@${packageMetadata.version} 实例 instance-old`,
        );
    });

    it("returns exit code 1 when the process runs but readiness fails", async () => {
        mockInstalledService(true);
        const fetcher = vi.fn<typeof fetch>(async input =>
            String(input).endsWith("/health")
                ? new Response(
                      JSON.stringify({
                          status: "ok",
                          application: "onebots",
                          version: packageMetadata.version,
                          instance_id: "status-instance",
                          runtime_contract_id: activeRuntimeContractId,
                      }),
                      { status: 200 },
                  )
                : new Response(
                      JSON.stringify({
                          ready: false,
                          adapters: { mock: { online: 0, offline: 1, total: 1 } },
                          summary: { online_accounts: 0, total_accounts: 1 },
                      }),
                      { status: 503 },
                  ),
        );

        const result = await runServiceStatus({ system: false }, fetcher);

        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("运行中，不可用");
        expect(result.output).toContain("ready: HTTP 503；账号 0/1 在线；未就绪: mock(0/1)");

        const jsonResult = await runServiceStatus({ system: false, json: true }, fetcher);
        expect(jsonResult).toMatchObject({ exitCode: 1, raw: true });
        expect(JSON.parse(jsonResult.output ?? "{}")).toMatchObject({
            status: "unavailable",
            ok: false,
            probe: {
                checks: [
                    { name: "health", level: "ok" },
                    { name: "ready", level: "error" },
                    { name: "probe-instance", level: "error" },
                    { name: "service-runtime-contract", level: "error" },
                ],
                error: null,
            },
        });
    });
});
