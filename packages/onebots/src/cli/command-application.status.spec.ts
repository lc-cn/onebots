import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { serviceStatus } from "./command-application.js";
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
        mockInstalledService(false);
        const fetcher = vi.fn<typeof fetch>();

        await expect(serviceStatus({ system: false }, fetcher)).resolves.toEqual({
            output: "已安装，未运行\n进程管理器: inactive",
            exitCode: 1,
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("reports liveness and readiness for a running service", async () => {
        mockInstalledService(true);
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
            output: `运行中，已就绪\n进程管理器: active\nhealth: HTTP 200；状态 ok；onebots@${packageMetadata.version}；@onebots/core@1.2.5\nready: HTTP 200；onebots@${packageMetadata.version}；实例 status-instance\nhealth 与 ready 均来自 onebots@${packageMetadata.version} 实例 status-instance`,
            exitCode: undefined,
        });
        expect(fetcher).toHaveBeenCalledWith(
            "http://127.0.0.1:7788/gateway/health",
            expect.anything(),
        );
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
    });
});
