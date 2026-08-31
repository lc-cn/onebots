import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { diagnose } from "./command-application.js";
import { ServiceController, type ServiceSpec } from "../service-manager.js";

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
            ok: boolean;
            strict: boolean;
            checks: Array<{ name: string; level: string }>;
        };

        expect(result.exitCode).toBe(1);
        expect(report).toMatchObject({ ok: false, strict: true });
        expect(report.checks.find(check => check.name === "extension-catalog")).toMatchObject({
            level: "ok",
        });
        expect(report.checks.find(check => check.name === "plugin-selection")).toMatchObject({
            level: "warning",
        });
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
            checks: Array<{ name: string; message: string }>;
        };

        expect(report.checks.find(check => check.name === "plugin-selection")?.message).toContain(
            "适配器 配置文件 [candidate-missing]",
        );
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
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(installed);
        vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
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
            checks: Array<{ name: string; message: string }>;
        };

        expect(report.checks.find(check => check.name === "plugin-selection")?.message).toContain(
            "适配器 服务定义 [service-missing]",
        );
        expect(report.checks.some(check => check.name === "adapter:service-missing")).toBe(true);
        expect(report.checks.some(check => check.name === "adapter:config-missing")).toBe(false);
        expect(report.checks.some(check => check.name === "gateway-address")).toBe(false);
    });
});
