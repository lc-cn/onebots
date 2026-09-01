import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";
import { afterEach, describe, expect, it } from "vitest";
import { CliError, listConfig, setConfig } from "./command-application.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("config command parsing", () => {
    it("按基础 Schema 和现有字段类型保留数字形式的凭据与标识符", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-config-command-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(
            configPath,
            "port: 6727\nmock:\n  bot:\n    user_id: '00123'\ngeneral: {}\n",
            { mode: 0o600 },
        );
        const options = { config: configPath, register: [], protocol: [] };

        setConfig(options, "access_token", "0012345678");
        setConfig(options, "mock.bot.user_id", "00999");
        setConfig(options, "port", "7000");

        const written = yaml.load(fs.readFileSync(configPath, "utf8")) as {
            access_token: unknown;
            port: unknown;
            mock: { bot: { user_id: unknown } };
        };
        expect(written.access_token).toBe("0012345678");
        expect(written.mock.bot.user_id).toBe("00999");
        expect(written.port).toBe(7000);
    });

    it("在类型不兼容时保持配置和备份不变", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-config-command-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        const original = "port: 6727\ngeneral: {}\n";
        fs.writeFileSync(configPath, original, { mode: 0o600 });

        expect(() =>
            setConfig({ config: configPath, register: [], protocol: [] }, "port", "invalid"),
        ).toThrow("配置项 port 需要有限数字");
        expect(fs.readFileSync(configPath, "utf8")).toBe(original);
        expect(fs.existsSync(`${configPath}.bak`)).toBe(false);
    });

    it("原子写入配置和备份，并保留私有权限", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-config-command-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "access_token: original\nport: 6727\n", { mode: 0o600 });

        expect(
            setConfig(
                { config: configPath, register: [], protocol: [] },
                "access_token",
                "rotated",
            ),
        ).toEqual({ output: "已设置 access_token" });

        expect(fs.readFileSync(configPath, "utf8")).toContain("access_token: rotated");
        expect(fs.readFileSync(`${configPath}.bak`, "utf8")).toBe(
            "access_token: original\nport: 6727\n",
        );
        expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
        expect(fs.statSync(`${configPath}.bak`).mode & 0o777).toBe(0o600);
        expect(fs.readdirSync(directory).sort()).toEqual(["config.yaml", "config.yaml.bak"]);
    });

    it("损坏配置只返回脱敏单行诊断", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-config-command-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "access_token: secret-never-return\nplugins: [\n");

        let error: unknown;
        try {
            listConfig({ config: configPath, register: [], protocol: [] });
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(CliError);
        expect(error).toMatchObject({
            exitCode: 2,
            message: expect.stringContaining("配置文件无效: YAML 解析失败"),
        });
        expect((error as Error).message).not.toContain("secret-never-return");
        expect((error as Error).message).not.toContain("plugins: [");
        expect((error as Error).message).not.toContain("\n");
    });
});
