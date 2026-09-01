import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CliError, listConfig, setConfig } from "./command-application.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("config command parsing", () => {
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
