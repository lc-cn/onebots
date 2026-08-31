import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseServiceRuntimeInvocation, resolveServiceRuntimeOptions } from "./cli.js";

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("internal service runtime", () => {
    it("parses isolated preflight options without exposing a public route", () => {
        expect(
            parseServiceRuntimeInvocation([
                "node",
                "onebots",
                "preflight",
                "-c",
                "config.yaml",
                "-r",
                "mock",
                "-p",
                "onebot-v11",
            ]),
        ).toEqual({
            command: "preflight",
            options: {
                configPath: path.resolve("config.yaml"),
                adapters: ["mock"],
                protocols: ["onebot-v11"],
            },
        });
    });

    it("使用持久化插件选择覆盖服务安装时的旧快照", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-runtime-"));
        directories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "plugins:\n  adapters: [slack]\n  protocols: [onebot-v12]\n");

        expect(
            resolveServiceRuntimeOptions({
                configPath,
                adapters: ["mock"],
                protocols: ["onebot-v11"],
            }),
        ).toEqual({
            configPath,
            adapters: ["slack"],
            protocols: ["onebot-v12"],
        });
    });

    it("旧配置继续使用服务定义中的插件快照", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-runtime-"));
        directories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "general: {}\n");
        const options = {
            configPath,
            adapters: ["mock"],
            protocols: ["onebot-v11"],
        };

        expect(resolveServiceRuntimeOptions(options)).toEqual(options);
    });
});
