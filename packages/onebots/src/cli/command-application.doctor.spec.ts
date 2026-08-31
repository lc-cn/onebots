import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { diagnose } from "./command-application.js";
import { ServiceController, type ServiceSpec } from "../service-manager.js";
import packageMetadata from "../../package.json" with { type: "json" };

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("doctor configuration scope", () => {
    it("returns a failure exit code for warnings in strict mode", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-strict-cli-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "general: {}\n", { mode: 0o600 });
        fs.mkdirSync(path.join(directory, "data"));
        fs.writeFileSync(
            path.join(directory, "package.json"),
            JSON.stringify({ name: "onebots", version: packageMetadata.version }),
        );
        vi.stubEnv("ONEBOTS_EXTENSION_ROOT", directory);
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(null);

        const result = await diagnose({
            config: configPath,
            register: [],
            protocol: [],
            system: false,
            fix: false,
            json: true,
            strict: true,
        });
        const report = JSON.parse(result.output || "{}") as {
            schemaVersion: number;
            generatedAt: string;
            application: { name: string; version: string };
            target: {
                configPath: string;
                dataDirectory: string;
                databasePath: string | null;
                extensionRoot: string;
                workingDirectory: string;
                service: { scope: string; mode: string };
                plugins: {
                    adapters: { source: string; names: string[] };
                    protocols: { source: string; names: string[] };
                };
            };
            ok: boolean;
            strict: boolean;
            checks: Array<{ name: string; level: string }>;
        };

        expect(result.exitCode).toBe(1);
        expect(report).toMatchObject({
            schemaVersion: 1,
            application: { name: "onebots", version: packageMetadata.version },
            target: {
                configPath,
                dataDirectory: path.join(directory, "data"),
                databasePath: path.join(directory, "data", "onebots.db"),
                extensionRoot: directory,
                workingDirectory: process.cwd(),
                service: { scope: "user", mode: "standalone" },
                plugins: {
                    adapters: { source: "none", names: [] },
                    protocols: { source: "none", names: [] },
                },
            },
            ok: false,
            strict: true,
        });
        expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt);
        expect(report.checks.find(check => check.name === "extension-catalog")).toMatchObject({
            level: "ok",
        });
        expect(report.checks.find(check => check.name === "extension-root")).toMatchObject({
            level: "ok",
        });
        expect(report.checks.find(check => check.name === "plugin-selection")).toMatchObject({
            level: "warning",
        });
    });

    it("returns a redacted JSON report when managed-service metadata is corrupted", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-metadata-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        const metadataPath = path.join(directory, "state", "service.json");
        fs.writeFileSync(configPath, "general: {}\n", { mode: 0o600 });
        fs.mkdirSync(path.join(directory, "data"));
        fs.writeFileSync(
            path.join(directory, "package.json"),
            JSON.stringify({ name: "onebots", version: packageMetadata.version }),
        );
        vi.stubEnv("ONEBOTS_EXTENSION_ROOT", directory);
        vi.spyOn(process, "cwd").mockReturnValue(directory);
        const readSpec = vi
            .spyOn(ServiceController.prototype, "readSpec")
            .mockImplementation(() => {
                throw new SyntaxError('Unexpected token near "secret-service-token"');
            });
        vi.spyOn(ServiceController.prototype, "paths").mockReturnValue({
            stateDir: path.dirname(metadataPath),
            definition: path.join(directory, "state", "service.plist"),
            metadata: metadataPath,
        });
        const status = vi.spyOn(ServiceController.prototype, "status");

        const result = await diagnose({
            register: [],
            protocol: [],
            system: false,
            fix: false,
            json: true,
        });
        const report = JSON.parse(result.output || "{}") as {
            target: { service: { mode: string } };
            checks: Array<{ name: string; level: string; message: string }>;
        };

        expect(result.exitCode).toBe(1);
        expect(report.target.service.mode).toBe("invalid");
        expect(report.checks.find(check => check.name === "service-metadata")).toEqual({
            name: "service-metadata",
            level: "error",
            message: `服务元数据无法读取或结构无效: ${metadataPath}；请重新执行 onebots install 生成服务定义`,
        });
        expect(result.output).not.toContain("secret-service-token");
        expect(report.checks.find(check => check.name === "service")).toMatchObject({
            level: "error",
        });
        expect(readSpec).toHaveBeenCalledTimes(1);
        expect(status).not.toHaveBeenCalled();
    });

    it("diagnoses an explicit candidate config independently from another installed service", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-candidate-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "candidate.yaml");
        fs.writeFileSync(
            configPath,
            "port: 61998\nplugins:\n  adapters: [candidate-missing]\n  protocols: []\n",
            { mode: 0o600 },
        );
        fs.mkdirSync(path.join(directory, "data"));
        const installed: ServiceSpec = {
            scope: "user",
            configPath: path.join(directory, "installed.yaml"),
            adapters: ["installed-missing"],
            protocols: [],
            nodePath: process.execPath,
            binPath: process.argv[1],
            workingDirectory: path.join(directory, "installed-runtime"),
        };
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(installed);
        const status = vi.spyOn(ServiceController.prototype, "status");
        const install = vi.spyOn(ServiceController.prototype, "install");

        const result = await diagnose({
            config: configPath,
            register: [],
            protocol: [],
            system: false,
            fix: true,
            json: true,
        });
        const report = JSON.parse(result.output || "{}") as {
            target: {
                service: { mode: string };
                plugins: { adapters: { source: string; names: string[] } };
            };
            checks: Array<{ name: string; message: string }>;
        };

        expect(report.checks.find(check => check.name === "plugin-selection")?.message).toContain(
            "适配器 配置文件 [candidate-missing]",
        );
        expect(report.target).toMatchObject({
            service: { mode: "standalone" },
            plugins: { adapters: { source: "config", names: ["candidate-missing"] } },
        });
        expect(report.checks.some(check => check.name === "adapter:candidate-missing")).toBe(true);
        expect(report.checks.some(check => check.name === "adapter:installed-missing")).toBe(false);
        expect(report.checks.find(check => check.name === "service")?.message).toContain(
            "未读取或修改已安装服务定义",
        );
        expect(status).not.toHaveBeenCalled();
        expect(install).not.toHaveBeenCalled();
    });

    it("keeps the service definition authoritative when explicit -c resolves to its config", async () => {
        vi.stubEnv("PORT", "invalid");
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-service-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(
            configPath,
            "port: 61997\nplugins:\n  adapters: [config-missing]\n  protocols: []\n",
            { mode: 0o600 },
        );
        fs.mkdirSync(path.join(directory, "data"));
        const installed: ServiceSpec = {
            scope: "user",
            configPath,
            adapters: ["service-missing"],
            protocols: [],
            nodePath: process.execPath,
            binPath: process.argv[1],
            workingDirectory: process.cwd(),
        };
        const readSpec = vi
            .spyOn(ServiceController.prototype, "readSpec")
            .mockReturnValue(installed);
        const status = vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
            installed: true,
            running: false,
            scope: "user",
            detail: "服务已安装但未运行",
        });
        vi.spyOn(ServiceController.prototype, "paths").mockReturnValue({
            stateDir: directory,
            definition: path.join(directory, "service.plist"),
            metadata: path.join(directory, "service.json"),
        });
        vi.spyOn(ServiceController.prototype, "definitionIsCurrent").mockReturnValue(true);

        const result = await diagnose({
            config: path.join(directory, ".", "config.yaml"),
            register: [],
            protocol: [],
            system: false,
            fix: false,
            json: true,
        });
        const report = JSON.parse(result.output || "{}") as {
            target: {
                service: { mode: string };
                plugins: { adapters: { source: string; names: string[] } };
            };
            checks: Array<{ name: string; message: string }>;
        };

        expect(report.checks.find(check => check.name === "plugin-selection")?.message).toContain(
            "适配器 服务定义 [service-missing]",
        );
        expect(report.target).toMatchObject({
            service: { mode: "managed" },
            plugins: { adapters: { source: "service", names: ["service-missing"] } },
        });
        expect(readSpec).toHaveBeenCalledTimes(1);
        expect(status).toHaveBeenCalledWith(installed);
        expect(report.checks.find(check => check.name === "service-node")?.message).toContain(
            process.version,
        );
        expect(report.checks.some(check => check.name === "adapter:service-missing")).toBe(true);
        expect(report.checks.some(check => check.name === "adapter:config-missing")).toBe(false);
        expect(report.checks.some(check => check.name === "gateway-address")).toBe(false);
    });
});
