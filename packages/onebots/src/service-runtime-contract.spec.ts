import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ServiceSpec } from "./service-manager.js";
import {
    createServiceRuntimeContractId,
    resolveServiceRuntimeContractId,
} from "./service-runtime-contract.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function serviceSpec(configSource: string): ServiceSpec {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-runtime-contract-"));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, "config.yaml");
    fs.writeFileSync(configPath, configSource, "utf8");
    return {
        scope: "user",
        configPath,
        adapters: ["legacy-adapter"],
        protocols: ["legacy-protocol"],
        nodePath: "/opt/node/bin/node",
        binPath: path.join(directory, "bin.js"),
        workingDirectory: directory,
    };
}

describe("service runtime contract", () => {
    it("生成稳定且不公开原始启动路径的 SHA-256 标识", () => {
        const spec = serviceSpec("general: {}\n");
        const first = createServiceRuntimeContractId(spec);
        const second = createServiceRuntimeContractId({ ...spec });

        expect(first).toBe(second);
        expect(first).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(first).not.toContain(spec.configPath);
        expect(
            createServiceRuntimeContractId({ ...spec, workingDirectory: "/srv/other" }),
        ).not.toBe(first);
    });

    it("以配置中实际生效的插件选择覆盖安装时兼容快照", () => {
        const spec = serviceSpec(
            "plugins:\n  adapters: [mock]\n  protocols: [onebot-v11]\ngeneral: {}\n",
        );

        expect(resolveServiceRuntimeContractId(spec)).toBe(
            createServiceRuntimeContractId({
                ...spec,
                adapters: ["mock"],
                protocols: ["onebot-v11"],
            }),
        );
        expect(resolveServiceRuntimeContractId(spec)).not.toBe(
            createServiceRuntimeContractId(spec),
        );
    });
});
