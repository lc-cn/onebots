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

function serviceSpec(source = "port: 7788\npath: gateway\n"): ServiceSpec {
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

describe("service status", () => {
    it("archives the probe pair and target in the JSON status report", async () => {
        const spec = serviceSpec();
        mockInstalledService(true, spec);
        const fetcher = createStatusFetcher(async input =>
            String(input).endsWith("/health")
                ? new Response(
                      JSON.stringify({
                          status: "ok",
                          application: "onebots",
                          version: packageMetadata.version,
                          instance_id: "json-instance",
                          runtime_contract_id: activeRuntimeContractId,
                      }),
                      { status: 200 },
                  )
                : new Response(
                      JSON.stringify({
                          ready: true,
                          application: "onebots",
                          version: packageMetadata.version,
                          instance_id: "json-instance",
                          runtime_contract_id: activeRuntimeContractId,
                      }),
                      { status: 200 },
                  ),
        );

        const result = await runServiceStatus({ system: false, json: true }, fetcher);
        const report = JSON.parse(result.output ?? "{}") as ServiceStatusReport;

        expect(result).toMatchObject({ exitCode: undefined, raw: true });
        expect(report).toMatchObject({
            status: "ready",
            ok: true,
            target: {
                scope: "user",
                configPath: spec.configPath,
                baseUrl: "http://127.0.0.1:7788/gateway",
                webUrl: "http://127.0.0.1:7788",
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
                    { name: "service-runtime-contract", level: "ok" },
                    { name: "management-page", level: "ok" },
                ],
            },
        });
    });

    it("does not report a ready service when its Web management page is unavailable", async () => {
        const spec = serviceSpec();
        mockInstalledService(true, spec);
        const fetcher = createStatusFetcher(
            async input =>
                String(input).endsWith("/health")
                    ? new Response(
                          JSON.stringify({
                              status: "ok",
                              application: "onebots",
                              version: packageMetadata.version,
                              instance_id: "page-failure-instance",
                              runtime_contract_id: activeRuntimeContractId,
                          }),
                          { status: 200 },
                      )
                    : new Response(
                          JSON.stringify({
                              ready: true,
                              application: "onebots",
                              version: packageMetadata.version,
                              instance_id: "page-failure-instance",
                              runtime_contract_id: activeRuntimeContractId,
                          }),
                          { status: 200 },
                      ),
            () => managementPageResponse("/gateway", 404),
        );

        const result = await runServiceStatus({ system: false, json: true }, fetcher);
        const report = JSON.parse(result.output ?? "{}") as ServiceStatusReport;

        expect(result).toMatchObject({ exitCode: 1, raw: true });
        expect(report).toMatchObject({
            status: "unavailable",
            ok: false,
            target: { webUrl: "http://127.0.0.1:7788" },
            probe: {
                checks: [
                    { name: "health", level: "ok" },
                    { name: "ready", level: "ok" },
                    { name: "probe-instance", level: "ok" },
                    { name: "service-runtime-contract", level: "ok" },
                    {
                        name: "management-page",
                        level: "error",
                        message: "Web 管理页不可验证: HTTP 404",
                    },
                ],
            },
        });
    });
});
