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
            target: { configPath: spec.configPath, baseUrl: null, webUrl: null },
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
            target: { scope: "user", configPath: null, baseUrl: null, webUrl: null },
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
            target: {
                scope: "user",
                configPath: spec.configPath,
                baseUrl: null,
                webUrl: null,
            },
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
            target: { scope: "user", configPath: null, baseUrl: null, webUrl: null },
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
