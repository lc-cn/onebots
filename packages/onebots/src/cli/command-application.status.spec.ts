import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { serviceStatus, type ServiceStatusReport } from "./command-application.js";
import { ServiceController, type ServiceSpec } from "../service-manager.js";
import packageMetadata from "../../package.json" with { type: "json" };

const temporaryDirectories: string[] = [];
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
    const definition = path.join(spec.workingDirectory, "onebots.service");
    const metadata = path.join(spec.workingDirectory, "service.json");
    fs.writeFileSync(definition, "service definition", { mode: 0o644 });
    fs.writeFileSync(metadata, JSON.stringify(spec), { mode: 0o600 });
    vi.spyOn(ServiceController.prototype, "paths").mockReturnValue({
        stateDir: spec.workingDirectory,
        definition,
        metadata,
    });
    vi.spyOn(ServiceController.prototype, "definitionPath").mockReturnValue(definition);
    vi.spyOn(ServiceController.prototype, "definitionIsCurrent").mockReturnValue(true);
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

function expectedControlPlaneOutput(spec: ServiceSpec): string {
    return process.platform === "win32"
        ? `\n服务状态目录可读写: ${spec.workingDirectory}`
        : `\n服务状态目录可读写: ${spec.workingDirectory}\n服务元数据权限 600 未向组或其他用户开放\n服务定义权限 644 未向组或其他用户开放写入`;
}

function expectedControlPlaneChecks() {
    return process.platform === "win32"
        ? [{ name: "service-permissions", level: "ok" }]
        : [
              { name: "service-permissions", level: "ok" },
              { name: "service-metadata-mode", level: "ok" },
              { name: "service-definition-mode", level: "ok" },
          ];
}

describe("service status", () => {
    it("returns exit code 2 when no service is installed", async () => {
        vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
            installed: false,
            running: false,
            scope: "user",
            detail: "服务未安装",
        });

        await expect(runServiceStatus({ system: false })).resolves.toEqual({
            output: "未安装\n进程管理器: 服务未安装",
            exitCode: 2,
        });
    });

    it("returns exit code 1 without probing when the service is stopped", async () => {
        const spec = serviceSpec();
        mockInstalledService(false, spec);
        const fetcher = vi.fn<typeof fetch>();

        await expect(runServiceStatus({ system: false }, fetcher)).resolves.toEqual({
            output: `已安装，未运行\n进程管理器: inactive\n服务定义: 与元数据一致 (${path.join(spec.workingDirectory, "onebots.service")})\n服务 Node 可用: ${spec.nodePath}\n服务入口有效: ${spec.binPath}\n服务配置包含持久化管理凭据${expectedPermissionOutput()}${expectedControlPlaneOutput(spec)}`,
            exitCode: 1,
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("停止状态也会解释下一次启动缺少持久化管理凭据", async () => {
        const spec = serviceSpec("port: 7788\npath: gateway\n");
        mockInstalledService(false, spec);
        const fetcher = vi.fn<typeof fetch>();

        const result = await runServiceStatus({ system: false, json: true }, fetcher);
        const report = JSON.parse(result.output ?? "{}") as ServiceStatusReport;

        expect(result).toMatchObject({ exitCode: 1, raw: true });
        expect(report).toMatchObject({
            status: "stopped",
            ok: false,
            serviceRuntime: { valid: false },
        });
        expect(report.serviceRuntime.checks).toContainEqual({
            name: "service-credentials",
            level: "error",
            message: expect.stringContaining("服务配置缺少持久化管理凭据"),
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it.runIf(process.platform !== "win32")(
        "服务元数据在读取后消失时返回结构化权限错误",
        async () => {
            const spec = serviceSpec();
            mockInstalledService(false, spec);
            const paths = new ServiceController("user").paths();
            fs.unlinkSync(paths.metadata);

            const result = await runServiceStatus({ system: false, json: true });
            const report = JSON.parse(result.output ?? "{}") as ServiceStatusReport;

            expect(result).toMatchObject({ exitCode: 1, raw: true });
            expect(report.serviceRuntime).toMatchObject({ valid: false });
            expect(report.serviceRuntime.checks).toContainEqual({
                name: "service-metadata-mode",
                level: "error",
                message: `服务元数据权限无法验证: ${paths.metadata}`,
            });
        },
    );

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

        const result = await runServiceStatus({ system: false, json: true }, fetcher);
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

        const uninstalled = await runServiceStatus({ system: false, json: true });
        const stopped = await runServiceStatus({ system: false, json: true });
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
            serviceRuntime: { valid: null, checks: [] },
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
            serviceRuntime: {
                valid: true,
                checks: [
                    { name: "service-node", level: "ok" },
                    { name: "service-entry", level: "ok" },
                    expectedCredentialCheck,
                    ...expectedPermissionChecks(),
                    ...expectedControlPlaneChecks(),
                ],
            },
            probe: { checks: [], error: null },
        });
    });

    it("keeps configuration failures structured without claiming probe evidence", async () => {
        const spec = serviceSpec("port: invalid\n");
        mockInstalledService(true, spec);
        const fetcher = vi.fn<typeof fetch>();

        const result = await runServiceStatus({ system: false, json: true }, fetcher);
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

        const result = await runServiceStatus({ system: false, json: true });
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
