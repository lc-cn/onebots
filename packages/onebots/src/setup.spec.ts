import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";
import { runSetup as runSetupWithEnvironment } from "./setup.js";

const temporaryDirectories: string[] = [];

const runSetup = (configPath: string, options?: Parameters<typeof runSetupWithEnvironment>[1]) =>
    runSetupWithEnvironment(configPath, options, "");

beforeEach(() => {
    vi.stubEnv("ONEBOTS_ACCESS_TOKEN", "");
});

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
        expect(renderedOutput).toContain("管理地址（启动后）: http://127.0.0.1:6727");
    });

    it("validates but does not overwrite an existing config in a non-interactive session", async () => {
        vi.stubEnv("ONEBOTS_ACCESS_TOKEN", "deployment-secret");
        const configPath = temporaryConfigPath();
        fs.writeFileSync(configPath, "port: 7000\npath: /gateway\n", "utf8");
        const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

        await runSetup(configPath);

        expect(fs.readFileSync(configPath, "utf8")).toBe("port: 7000\npath: /gateway\n");
        expect(fs.existsSync(`${configPath}.bak`)).toBe(false);
        expect(fs.statSync(path.join(path.dirname(configPath), "data")).isDirectory()).toBe(true);
        expect(output.mock.calls.map(call => String(call[0])).join("")).toContain(
            "配置文件已存在并通过验证",
        );
        expect(output.mock.calls.map(call => String(call[0])).join("")).toContain(
            "管理地址（启动后）: http://127.0.0.1:7000",
        );
    });

    it.runIf(process.platform !== "win32")(
        "拒绝把公开可读的持久化管理凭据报告为配置就绪",
        async () => {
            const configPath = temporaryConfigPath();
            const original = "port: 7000\naccess_token: configured-token\n";
            fs.writeFileSync(configPath, original, { mode: 0o644 });

            await expect(runSetup(configPath)).rejects.toThrow(
                "现有管理凭据权限不安全：配置文件权限 644",
            );

            expect(fs.readFileSync(configPath, "utf8")).toBe(original);
            expect(fs.statSync(configPath).mode & 0o777).toBe(0o644);
            expect(fs.existsSync(path.join(path.dirname(configPath), "data"))).toBe(false);
        },
    );

    it.runIf(process.platform !== "win32")(
        "保留有意设置的组只读权限并明确输出安全提示",
        async () => {
            const configPath = temporaryConfigPath();
            fs.writeFileSync(configPath, "access_token: configured-token\n", { mode: 0o640 });
            const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

            await runSetup(configPath);

            expect(fs.statSync(configPath).mode & 0o777).toBe(0o640);
            expect(output.mock.calls.map(call => String(call[0])).join("")).toContain(
                "安全提示：配置文件权限 640 允许同组用户读取",
            );
        },
    );

    it.runIf(process.platform !== "win32")("复用管理凭据时同时拒绝公开的配置备份", async () => {
        const configPath = temporaryConfigPath();
        fs.writeFileSync(configPath, "access_token: configured-token\n", { mode: 0o600 });
        fs.writeFileSync(`${configPath}.bak`, "access_token: previous-token\n", {
            mode: 0o644,
        });

        await expect(runSetup(configPath)).rejects.toThrow("配置备份权限 644");

        expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
        expect(fs.statSync(`${configPath}.bak`).mode & 0o777).toBe(0o644);
        expect(fs.existsSync(path.join(path.dirname(configPath), "data"))).toBe(false);
    });

    it("uses the listener PORT override without appending the API path or credentials", async () => {
        const configPath = temporaryConfigPath();
        fs.writeFileSync(
            configPath,
            "port: 7000\npath: /gateway\naccess_token: secret-never-return\n",
            { mode: 0o600 },
        );
        const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

        await runSetupWithEnvironment(configPath, {}, "7860");

        const renderedOutput = output.mock.calls.map(call => String(call[0])).join("");
        expect(renderedOutput).toContain("管理地址（当前 PORT 前台启动）: http://127.0.0.1:7860");
        expect(renderedOutput).toContain("管理地址（守护服务配置）: http://127.0.0.1:7000");
        expect(renderedOutput).not.toContain("/gateway");
        expect(renderedOutput).not.toContain("secret-never-return");
    });

    it("rejects an invalid listener PORT before creating first-run state", async () => {
        const configPath = temporaryConfigPath();

        await expect(runSetupWithEnvironment(configPath, {}, "invalid")).rejects.toThrow(
            "PORT 必须是 1 到 65535 之间的整数",
        );

        expect(fs.existsSync(configPath)).toBe(false);
        expect(fs.existsSync(path.join(path.dirname(configPath), "data"))).toBe(false);
    });

    it("does not report a credential-free existing config as ready without write permission", async () => {
        const configPath = temporaryConfigPath();
        const original = "port: 7000\n";
        fs.writeFileSync(configPath, original, { mode: 0o640 });

        await expect(runSetup(configPath)).rejects.toThrow(
            "现有配置缺少管理凭据，非交互环境不会自动写入",
        );

        expect(fs.readFileSync(configPath, "utf8")).toBe(original);
        expect(fs.existsSync(`${configPath}.bak`)).toBe(false);
        expect(fs.existsSync(path.join(path.dirname(configPath), "data"))).toBe(false);
    });

    it("rejects a broken existing config instead of reporting non-interactive success", async () => {
        const configPath = temporaryConfigPath();
        const original = "access_token: secret-never-return\nplugins: [\n";
        fs.writeFileSync(configPath, original, { mode: 0o600 });

        const error = await runSetup(configPath).then(
            () => null,
            error => error,
        );

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("现有配置无法读取：YAML 解析失败:");
        expect((error as Error).message).toContain("请修复配置，或使用 --force 备份并重建");
        expect((error as Error).message).not.toContain("secret-never-return");
        expect(fs.readFileSync(configPath, "utf8")).toBe(original);
        expect(fs.existsSync(`${configPath}.bak`)).toBe(false);
    });

    it("rejects an existing config whose runtime data path is a file", async () => {
        const configPath = temporaryConfigPath();
        const dataPath = path.join(path.dirname(configPath), "data");
        const original = "port: 7000\naccess_token: configured-token\n";
        fs.writeFileSync(configPath, original, { mode: 0o600 });
        fs.writeFileSync(dataPath, "keep this mount evidence");

        await expect(runSetup(configPath)).rejects.toThrow(`数据存储路径不是目录: ${dataPath}`);

        expect(fs.readFileSync(configPath, "utf8")).toBe(original);
        expect(fs.existsSync(`${configPath}.bak`)).toBe(false);
        expect(fs.readFileSync(dataPath, "utf8")).toBe("keep this mount evidence");
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

    it("backs up a forced update and makes newly generated credentials private", async () => {
        const configPath = temporaryConfigPath();
        const original = "port: 7000\nlog_level: info\ntimeout: 30\ngeneral: {}\n";
        fs.writeFileSync(configPath, original, { mode: 0o640 });

        await runSetup(configPath, { force: true });

        expect(fs.readFileSync(`${configPath}.bak`, "utf8")).toBe(original);
        expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
        expect(fs.statSync(`${configPath}.bak`).mode & 0o777).toBe(0o600);
        expect(yaml.load(fs.readFileSync(configPath, "utf8"))).toMatchObject({
            port: 7000,
            general: {},
        });
    });

    it("preserves an intentional shared mode when no credential is persisted", async () => {
        vi.stubEnv("ONEBOTS_ACCESS_TOKEN", "deployment-secret");
        const configPath = temporaryConfigPath();
        const original = "port: 7000\ngeneral: {}\n";
        fs.writeFileSync(configPath, original, { mode: 0o640 });

        await runSetup(configPath, { force: true });

        expect(parseConfig(configPath)).not.toHaveProperty("access_token");
        expect(fs.statSync(configPath).mode & 0o777).toBe(0o640);
        expect(fs.statSync(`${configPath}.bak`).mode & 0o777).toBe(0o640);
    });

    it("refuses to reset an existing config without the backup boundary", async () => {
        const configPath = temporaryConfigPath();
        const original = "port: 7000\naccess_token: keep-secret\n";
        fs.writeFileSync(configPath, original, { mode: 0o600 });

        await expect(runSetup(configPath, { reset: true })).rejects.toThrow(
            "--reset 会重建配置，必须同时使用 --force 以创建备份",
        );

        expect(fs.readFileSync(configPath, "utf8")).toBe(original);
        expect(fs.existsSync(`${configPath}.bak`)).toBe(false);
    });

    it("backs up and rebuilds a valid config that references unavailable plugins", async () => {
        const configPath = temporaryConfigPath();
        const original = [
            "port: 7000",
            "access_token: old-secret",
            "plugins:",
            "  adapters: [removed-adapter]",
            "  protocols: [removed-protocol]",
            "removed-adapter.account:",
            "  removed-protocol.v1: {}",
            "",
        ].join("\n");
        fs.writeFileSync(configPath, original, { mode: 0o600 });
        const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

        await runSetup(configPath, {
            force: true,
            reset: true,
            adapters: ["mock"],
            protocols: ["onebot-v11"],
        });

        expect(fs.readFileSync(`${configPath}.bak`, "utf8")).toBe(original);
        const config = parseConfig(configPath);
        expect(config.plugins).toEqual({
            adapters: ["mock"],
            protocols: ["onebot-v11"],
        });
        expect(config).not.toHaveProperty("removed-adapter.account");
        expect(config.access_token).toMatch(/^[a-f0-9]{64}$/u);
        expect(config.access_token).not.toBe("old-secret");
        expect(output.mock.calls.map(call => String(call[0])).join("")).toContain(
            "从安全默认值重建",
        );
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
        expect(renderedOutput).toContain("守护服务不会保存当前 shell");
        expect(renderedOutput).not.toContain(`onebots install -c ${configPath}`);
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
