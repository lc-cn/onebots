import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BaseApp } from "./base-app.js";

describe("BaseApp runtime path ownership", () => {
    it("后创建的应用不能改写已有应用的配置、数据与日志路径", async () => {
        const originalConfigDir = BaseApp.configDir;
        const originalConfigFileName = BaseApp.configFileName;
        const firstDirectory = mkdtempSync(join(tmpdir(), "onebots-path-first-"));
        const secondDirectory = mkdtempSync(join(tmpdir(), "onebots-path-second-"));
        let firstApp: BaseApp | undefined;
        let secondApp: BaseApp | undefined;

        try {
            BaseApp.configDir = firstDirectory;
            BaseApp.configFileName = "first.yaml";
            firstApp = new BaseApp({ database: "first.db" });

            BaseApp.configDir = secondDirectory;
            BaseApp.configFileName = "second.yaml";
            secondApp = new BaseApp({ database: "second.db" });

            expect(firstApp).toMatchObject({
                configDir: firstDirectory,
                configFileName: "first.yaml",
                configPath: join(firstDirectory, "first.yaml"),
                dataDir: join(firstDirectory, "data"),
                logFile: join(firstDirectory, "onebots.log"),
            });
            expect(secondApp).toMatchObject({
                configDir: secondDirectory,
                configFileName: "second.yaml",
                configPath: join(secondDirectory, "second.yaml"),
                dataDir: join(secondDirectory, "data"),
                logFile: join(secondDirectory, "onebots.log"),
            });
            expect(existsSync(join(firstDirectory, "data", "first.db"))).toBe(true);
            expect(existsSync(join(secondDirectory, "data", "second.db"))).toBe(true);

            BaseApp.configDir = join(secondDirectory, "later");
            BaseApp.configFileName = "later.yaml";
            expect(firstApp.configPath).toBe(join(firstDirectory, "first.yaml"));
            expect(secondApp.configPath).toBe(join(secondDirectory, "second.yaml"));
        } finally {
            await firstApp?.stop();
            await secondApp?.stop();
            BaseApp.configDir = originalConfigDir;
            BaseApp.configFileName = originalConfigFileName;
            rmSync(firstDirectory, { recursive: true, force: true });
            rmSync(secondDirectory, { recursive: true, force: true });
        }
    });
});
