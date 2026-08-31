import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";
import { runSetup } from "./setup.js";

const temporaryDirectories: string[] = [];

beforeEach(() => vi.stubEnv("ONEBOTS_ACCESS_TOKEN", ""));

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function temporaryConfigPath(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-setup-"));
    temporaryDirectories.push(directory);
    return path.join(directory, "config.yaml");
}

describe("setup workflow", () => {
    it("writes a secure first-run configuration without unloaded protocol references", async () => {
        const configPath = temporaryConfigPath();
        const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

        await runSetup(configPath);

        const config = yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
        expect(config.general).toEqual({});
        expect(config.access_token).toMatch(/^[a-f0-9]{64}$/u);
        expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
        expect(fs.existsSync(path.join(path.dirname(configPath), "data"))).toBe(true);
        const renderedOutput = output.mock.calls.map(call => String(call[0])).join("");
        expect(renderedOutput).toContain("access_token");
        expect(renderedOutput).not.toContain(String(config.access_token));
        expect(renderedOutput).toContain("尚未选择插件");
        expect(renderedOutput).toContain(`onebots capabilities -c ${configPath}`);
        expect(renderedOutput).toContain(`onebots doctor -c ${configPath}`);
        expect(renderedOutput).toContain(`onebots install -c ${configPath}`);
    });

    it("does not overwrite an existing config in a non-interactive session", async () => {
        const configPath = temporaryConfigPath();
        fs.writeFileSync(configPath, "port: 7000\n", "utf8");

        await runSetup(configPath);

        expect(fs.readFileSync(configPath, "utf8")).toBe("port: 7000\n");
        expect(fs.existsSync(`${configPath}.bak`)).toBe(false);
    });

    it("rejects a colliding data path before writing a first-run config", async () => {
        const configPath = temporaryConfigPath();
        const dataPath = path.join(path.dirname(configPath), "data");
        fs.writeFileSync(dataPath, "keep this mount evidence");

        await expect(runSetup(configPath)).rejects.toThrow(`数据存储路径不是目录: ${dataPath}`);

        expect(fs.existsSync(configPath)).toBe(false);
        expect(fs.readFileSync(dataPath, "utf8")).toBe("keep this mount evidence");
    });

    it("rejects a colliding data path before backing up or changing a forced config", async () => {
        const configPath = temporaryConfigPath();
        const dataPath = path.join(path.dirname(configPath), "data");
        const original = "port: 7000\nlog_level: info\ntimeout: 30\ngeneral: {}\n";
        fs.writeFileSync(configPath, original, { mode: 0o600 });
        fs.writeFileSync(dataPath, "keep this mount evidence");

        await expect(runSetup(configPath, { force: true })).rejects.toThrow(
            `数据存储路径不是目录: ${dataPath}`,
        );

        expect(fs.readFileSync(configPath, "utf8")).toBe(original);
        expect(fs.existsSync(`${configPath}.bak`)).toBe(false);
        expect(fs.readFileSync(dataPath, "utf8")).toBe("keep this mount evidence");
    });

    it("atomically backs up an existing config before a forced update", async () => {
        const configPath = temporaryConfigPath();
        const original = "port: 7000\nlog_level: info\ntimeout: 30\ngeneral: {}\n";
        fs.writeFileSync(configPath, original, { mode: 0o640 });

        await runSetup(configPath, { force: true });

        expect(fs.readFileSync(`${configPath}.bak`, "utf8")).toBe(original);
        expect(fs.statSync(configPath).mode & 0o777).toBe(0o640);
        expect(yaml.load(fs.readFileSync(configPath, "utf8"))).toMatchObject({
            port: 7000,
            general: {},
        });
    });

    it("强制更新时备份损坏配置并在不泄露凭据的前提下安全重建", async () => {
        const configPath = temporaryConfigPath();
        const original = "access_token: secret-never-return\nplugins: [\n";
        fs.writeFileSync(configPath, original, { mode: 0o600 });
        const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

        await runSetup(configPath, { force: true });

        expect(fs.readFileSync(`${configPath}.bak`, "utf8")).toBe(original);
        const config = parseConfig(configPath);
        expect(config.general).toEqual({});
        expect(config.access_token).toMatch(/^[a-f0-9]{64}$/u);
        const renderedOutput = output.mock.calls.map(call => String(call[0])).join("");
        expect(renderedOutput).toContain("现有配置无法解析");
        expect(renderedOutput).toContain("YAML 解析失败");
        expect(renderedOutput).not.toContain("secret-never-return");
        expect(renderedOutput).not.toContain("plugins: [");
    });

    it("keeps the first-run config secret-free when deployment auth is supplied", async () => {
        vi.stubEnv("ONEBOTS_ACCESS_TOKEN", "space-secret");
        const configPath = temporaryConfigPath();
        const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

        await runSetup(configPath);

        const config = yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
        expect(config).not.toHaveProperty("access_token");
        const renderedOutput = output.mock.calls.map(call => String(call[0])).join("");
        expect(renderedOutput).toContain("ONEBOTS_ACCESS_TOKEN");
        expect(renderedOutput).not.toContain("space-secret");
    });

    it("persists verified plugin choices so every next command can reuse them", async () => {
        const configPath = temporaryConfigPath();
        const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

        await runSetup(configPath, {
            adapters: ["mock", "mock"],
            protocols: ["onebot-v11"],
        });

        const config = yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
        expect(config.plugins).toEqual({
            adapters: ["mock"],
            protocols: ["onebot-v11"],
        });
        const renderedOutput = output.mock.calls.map(call => String(call[0])).join("");
        expect(renderedOutput).toContain("插件选择已写入配置");
        expect(renderedOutput).toContain(`onebots capabilities -c ${configPath}`);
        expect(renderedOutput).toContain(`onebots doctor -c ${configPath}`);
        expect(renderedOutput).toContain(`onebots -c ${configPath}`);
        expect(renderedOutput).toContain(`onebots install -c ${configPath}`);
        expect(renderedOutput).not.toContain("-r mock");
        expect(renderedOutput).not.toContain("-p onebot-v11");
    });
});

function parseConfig(configPath: string): Record<string, unknown> {
    return yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
}
