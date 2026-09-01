import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { serviceStatus, type ServiceStatusReport } from "./command-application.js";
import { ServiceController, type ServiceSpec } from "../service-manager.js";
import packageMetadata from "../../package.json" with { type: "json" };

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function serviceSpec(source = "port: 7788\npath: gateway\n"): ServiceSpec {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-status-"));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, "config.yaml");
    fs.writeFileSync(configPath, source, "utf8");
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

describe("service status", () => {
    it("returns exit code 2 when no service is installed", async () => {
        vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
            installed: false,
            running: false,
            scope: "user",
            detail: "服务未安装",
        });

        await expect(serviceStatus({ system: false })).resolves.toEqual({
            output: "未安装\n进程管理器: 服务未安装",
            exitCode: 2,
        });
    });

    it("returns exit code 1 without probing when the service is stopped", async () => {
        const spec = serviceSpec();
        mockInstalledService(false, spec);
        const fetcher = vi.fn<typeof fetch>();

        await expect(serviceStatus({ system: false }, fetcher)).resolves.toEqual({
            output: `已安装，未运行\n进程管理器: inactive\n服务定义: 与元数据一致 (${path.join(spec.workingDirectory, "onebots.service")})`,
            exitCode: 1,
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("does not misreport a failed process-manager query as stopped", async () => {
        const spec = serviceSpec();
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(spec);
        vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
            installed: true,
            running: false,
            scope: "user",
            detail: "systemd bus unavailable",
            error: "进程管理器状态查询失败",
        });
        mockCurrentDefinition(spec);
        const fetcher = vi.fn<typeof fetch>();

        const result = await serviceStatus({ system: false, json: true }, fetcher);
        const report = JSON.parse(result.output ?? "{}") as ServiceStatusReport;

        expect(result).toMatchObject({ exitCode: 1, raw: true });
        expect(report).toMatchObject({
            status: "unavailable",
            ok: false,
            target: { configPath: spec.configPath, baseUrl: null },
            processManager: {
                installed: true,
                running: null,
                detail: "systemd bus unavailable",
                error: "进程管理器状态查询失败",
            },
            serviceDefinition: {
                path: path.join(spec.workingDirectory, "onebots.service"),
                current: true,
                error: null,
            },
            probe: { checks: [], error: "进程管理器状态不可用，未执行 HTTP 探测" },
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("emits stable machine-readable evidence for uninstalled and stopped services", async () => {
        const spec = serviceSpec();
        vi.spyOn(ServiceController.prototype, "readSpec")
            .mockReturnValueOnce(null)
            .mockReturnValueOnce(spec);
        mockCurrentDefinition(spec);
        vi.spyOn(ServiceController.prototype, "status")
            .mockReturnValueOnce({
                installed: false,
                running: false,
                scope: "user",
                detail: "服务未安装",
            })
            .mockReturnValueOnce({
                installed: true,
                running: false,
                scope: "user",
                detail: "inactive",
            });

        const uninstalled = await serviceStatus({ system: false, json: true });
        const stopped = await serviceStatus({ system: false, json: true });
        const uninstalledReport = JSON.parse(uninstalled.output ?? "{}") as ServiceStatusReport;
        const stoppedReport = JSON.parse(stopped.output ?? "{}") as ServiceStatusReport;

        expect(uninstalled).toMatchObject({ exitCode: 2, raw: true });
        expect(uninstalledReport).toMatchObject({
            schemaVersion: 1,
            application: { name: "onebots", version: packageMetadata.version },
            target: { scope: "user", configPath: null, baseUrl: null },
            status: "uninstalled",
            ok: false,
            processManager: {
                installed: false,
                running: false,
                detail: "服务未安装",
                error: null,
            },
            probe: { checks: [], error: null },
        });
        expect(new Date(uninstalledReport.generatedAt).toISOString()).toBe(
            uninstalledReport.generatedAt,
        );
        expect(stopped).toMatchObject({ exitCode: 1, raw: true });
        expect(stoppedReport).toMatchObject({
            status: "stopped",
            ok: false,
            processManager: {
                installed: true,
                running: false,
                detail: "inactive",
                error: null,
            },
            target: { configPath: expect.any(String) },
            serviceDefinition: { current: true, error: null },
            probe: { checks: [], error: null },
        });
    });

    it("reports liveness and readiness for a running service", async () => {
        const spec = serviceSpec();
        mockInstalledService(true, spec);
        const fetcher = vi.fn<typeof fetch>(async input => {
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
                          }
                        : {
                              ready: true,
                              application: "onebots",
                              version: packageMetadata.version,
                              instance_id: "status-instance",
                          },
                ),
                { status: 200 },
            );
        });

        const result = await serviceStatus({ system: false }, fetcher);

        expect(result).toEqual({
            output: `运行中，已就绪\n进程管理器: active\n服务定义: 与元数据一致 (${path.join(spec.workingDirectory, "onebots.service")})\nhealth: HTTP 200；状态 ok；onebots@${packageMetadata.version}；@onebots/core@1.2.5\nready: HTTP 200；onebots@${packageMetadata.version}；实例 status-instance\nhealth 与 ready 均来自 onebots@${packageMetadata.version} 实例 status-instance`,
            exitCode: undefined,
        });
        expect(fetcher).toHaveBeenCalledWith(
            "http://127.0.0.1:7788/gateway/health",
            expect.anything(),
        );
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

        const result = await serviceStatus({ system: false, json: true }, fetcher);
        const report = JSON.parse(result.output ?? "{}") as ServiceStatusReport;

        expect(result).toMatchObject({ exitCode: 1, raw: true });
        expect(report).toMatchObject({
            status: "unavailable",
            ok: false,
            target: { configPath: spec.configPath, baseUrl: null },
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

    it("archives the probe pair and target in the JSON status report", async () => {
        const spec = serviceSpec();
        mockInstalledService(true, spec);
        const fetcher = vi.fn<typeof fetch>(async input =>
            String(input).endsWith("/health")
                ? new Response(
                      JSON.stringify({
                          status: "ok",
                          application: "onebots",
                          version: packageMetadata.version,
                          instance_id: "json-instance",
                      }),
                      { status: 200 },
                  )
                : new Response(
                      JSON.stringify({
                          ready: true,
                          application: "onebots",
                          version: packageMetadata.version,
                          instance_id: "json-instance",
                      }),
                      { status: 200 },
                  ),
        );

        const result = await serviceStatus({ system: false, json: true }, fetcher);
        const report = JSON.parse(result.output ?? "{}") as ServiceStatusReport;

        expect(result).toMatchObject({ exitCode: undefined, raw: true });
        expect(report).toMatchObject({
            status: "ready",
            ok: true,
            target: {
                scope: "user",
                configPath: spec.configPath,
                baseUrl: "http://127.0.0.1:7788/gateway",
            },
            processManager: { installed: true, running: true, detail: "active" },
            serviceDefinition: {
                path: path.join(spec.workingDirectory, "onebots.service"),
                current: true,
                error: null,
            },
            probe: {
                error: null,
                checks: [
                    { name: "health", level: "ok" },
                    { name: "ready", level: "ok" },
                    {
                        name: "probe-instance",
                        level: "ok",
                        identity: {
                            application: "onebots",
                            version: packageMetadata.version,
                            instanceId: "json-instance",
                        },
                    },
                ],
            },
        });
    });

    it("keeps a reachable first-run management surface successful but pending", async () => {
        mockInstalledService(true);
        const fetcher = vi.fn<typeof fetch>(async input =>
            String(input).endsWith("/health")
                ? new Response(
                      JSON.stringify({
                          status: "ok",
                          application: "onebots",
                          version: packageMetadata.version,
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
                          configured: false,
                          summary: { online_accounts: 0, total_accounts: 0 },
                      }),
                      { status: 200 },
                  ),
        );

        const result = await serviceStatus({ system: false }, fetcher);

        expect(result.exitCode).toBeUndefined();
        expect(result.output).toContain("运行中，待配置");
        expect(result.output).toContain(
            `ready: HTTP 200；onebots@${packageMetadata.version}；实例 status-instance；未配置账号；账号 0/0 在线`,
        );

        const jsonResult = await serviceStatus({ system: false, json: true }, fetcher);
        expect(JSON.parse(jsonResult.output ?? "{}")).toMatchObject({
            status: "pending_configuration",
            ok: true,
            probe: { checks: [{ level: "ok" }, { level: "warning" }, { level: "ok" }] },
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

        const result = await serviceStatus({ system: false }, fetcher);

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
                    }),
                    { status: 200 },
                ),
        );

        const result = await serviceStatus({ system: false, json: true }, fetcher);

        expect(result).toMatchObject({ exitCode: 1, raw: true });
        expect(JSON.parse(result.output ?? "{}")).toMatchObject({
            status: "version_unverified",
            ok: false,
            probe: {
                checks: [
                    { name: "health", level: "warning" },
                    { name: "ready", level: "ok" },
                    { name: "probe-instance", level: "ok" },
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
                      }),
                      { status: 200 },
                  )
                : new Response(
                      JSON.stringify({
                          ready: true,
                          application: "onebots",
                          version: packageMetadata.version,
                          instance_id: "instance-old",
                      }),
                      { status: 200 },
                  ),
        );

        const result = await serviceStatus({ system: false }, fetcher);

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

        const result = await serviceStatus({ system: false }, fetcher);

        expect(result.exitCode).toBe(1);
        expect(result.output).toContain("运行中，不可用");
        expect(result.output).toContain("ready: HTTP 503；账号 0/1 在线；未就绪: mock(0/1)");

        const jsonResult = await serviceStatus({ system: false, json: true }, fetcher);
        expect(jsonResult).toMatchObject({ exitCode: 1, raw: true });
        expect(JSON.parse(jsonResult.output ?? "{}")).toMatchObject({
            status: "unavailable",
            ok: false,
            probe: {
                checks: [
                    { name: "health", level: "ok" },
                    { name: "ready", level: "error" },
                    { name: "probe-instance", level: "error" },
                ],
                error: null,
            },
        });
    });

    it("keeps configuration failures structured without claiming probe evidence", async () => {
        const spec = serviceSpec("port: invalid\n");
        mockInstalledService(true, spec);
        const fetcher = vi.fn<typeof fetch>();

        const result = await serviceStatus({ system: false, json: true }, fetcher);
        const report = JSON.parse(result.output ?? "{}") as ServiceStatusReport;

        expect(result).toMatchObject({ exitCode: 1, raw: true });
        expect(report).toMatchObject({
            status: "unavailable",
            ok: false,
            target: { scope: "user", configPath: spec.configPath, baseUrl: null },
            processManager: { installed: true, running: true },
            probe: {
                checks: [],
                error: "配置读取失败: 网关 port 必须是 1 到 65535 之间的整数",
            },
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("returns redacted JSON when service metadata cannot be parsed", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-status-metadata-"));
        temporaryDirectories.push(directory);
        const metadataPath = path.join(directory, "service.json");
        const status = vi.spyOn(ServiceController.prototype, "status");
        vi.spyOn(ServiceController.prototype, "readSpec").mockImplementation(() => {
            throw new SyntaxError('Unexpected token near "secret-service-token"');
        });
        vi.spyOn(ServiceController.prototype, "paths").mockReturnValue({
            stateDir: directory,
            definition: path.join(directory, "service.plist"),
            metadata: metadataPath,
        });

        const result = await serviceStatus({ system: false, json: true });
        const report = JSON.parse(result.output ?? "{}") as ServiceStatusReport;

        expect(result).toMatchObject({ exitCode: 1, raw: true });
        expect(report).toMatchObject({
            status: "unavailable",
            ok: false,
            target: { scope: "user", configPath: null, baseUrl: null },
            processManager: {
                installed: null,
                running: null,
                detail: null,
                error: `服务元数据无法读取或结构无效: ${metadataPath}`,
            },
            probe: { checks: [], error: "服务元数据不可用，未执行 HTTP 探测" },
        });
        expect(result.output).not.toContain("secret-service-token");
        expect(status).not.toHaveBeenCalled();
    });
});
