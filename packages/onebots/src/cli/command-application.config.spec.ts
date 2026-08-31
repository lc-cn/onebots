import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CliError, listConfig } from "./command-application.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("config command parsing", () => {
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
