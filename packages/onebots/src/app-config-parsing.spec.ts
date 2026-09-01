import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BaseApp } from "@onebots/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOnebots } from "./app.js";

const temporaryDirectories: string[] = [];
const originalConfigDir = BaseApp.configDir;
const originalConfigFileName = BaseApp.configFileName;

afterEach(() => {
    vi.unstubAllEnvs();
    BaseApp.configDir = originalConfigDir;
    BaseApp.configFileName = originalConfigFileName;
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("createOnebots config parsing", () => {
    it("自动生成鉴权码时收紧已有配置与备份权限", async () => {
        vi.stubEnv("ONEBOTS_ACCESS_TOKEN", "");
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-app-credentials-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        const original = "port: 7000\ngeneral: {}\n";
        fs.writeFileSync(configPath, original, { mode: 0o640 });

        const app = createOnebots(configPath);

        expect(fs.readFileSync(configPath, "utf8")).toMatch(/access_token: [a-f0-9]{64}/u);
        expect(fs.readFileSync(`${configPath}.bak`, "utf8")).toBe(original);
        expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
        expect(fs.statSync(`${configPath}.bak`).mode & 0o777).toBe(0o600);
        await app.stop();
    });

    it("前台启动在生成默认配置前拒绝冲突的数据路径", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-app-data-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        const dataPath = path.join(directory, "data");
        fs.writeFileSync(dataPath, "keep this mount evidence");

        expect(() => createOnebots(configPath)).toThrow(`数据存储路径不是目录: ${dataPath}`);
        expect(fs.existsSync(configPath)).toBe(false);
        expect(fs.readFileSync(dataPath, "utf8")).toBe("keep this mount evidence");
    });

    it("前台创建入口不把损坏 YAML 附近的凭据带入错误", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-app-config-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "production.custom.yaml");
        const defaultConfigPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "access_token: secret-never-return\nplugins: [\n");

        let error: unknown;
        try {
            createOnebots(configPath);
        } catch (caught) {
            error = caught;
        }

        expect(error).toMatchObject({ message: expect.stringContaining("YAML 解析失败") });
        expect((error as Error).message).not.toContain("secret-never-return");
        expect((error as Error).message).not.toContain("plugins: [");
        expect((error as Error).message).not.toContain("\n");
        expect(BaseApp.configPath).toBe(configPath);
        expect(fs.existsSync(defaultConfigPath)).toBe(false);
    });
});
