import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import type { ServiceSpec } from "./service-manager.js";
import { pluginCandidates, tryLoadRegisteredPlugin, type PluginType } from "./plugin-loader.js";
import { parseRuntimeConfig, validateRuntimeConfig } from "./runtime-config-validator.js";

export type ServicePreflightSpec = Pick<
    ServiceSpec,
    "configPath" | "adapters" | "protocols" | "workingDirectory"
>;

/** 按守护进程实际工作目录加载插件并校验配置，但不连接平台或写入服务定义。 */
export async function preflightServiceRuntime(spec: ServicePreflightSpec): Promise<void> {
    if (!fs.existsSync(spec.workingDirectory)) {
        throw new Error(`服务工作目录不存在: ${spec.workingDirectory}`);
    }
    if (!fs.existsSync(spec.configPath)) {
        throw new Error(`配置文件不存在: ${spec.configPath}`);
    }

    const runtimeRequire = createRequire(path.join(spec.workingDirectory, "package.json"));
    const failures: string[] = [];
    for (const [type, names] of [
        ["adapter", spec.adapters],
        ["protocol", spec.protocols],
    ] as const satisfies ReadonlyArray<readonly [PluginType, readonly string[]]>) {
        for (const name of names) {
            const result = await tryLoadRegisteredPlugin(
                type,
                name,
                pluginCandidates(type, name),
                runtimeRequire,
            );
            if (result.loaded === false) failures.push(result.message);
        }
    }
    if (failures.length > 0) {
        throw new Error(`插件加载失败：${failures.join("；")}`);
    }

    const config = parseRuntimeConfig(fs.readFileSync(spec.configPath, "utf8"));
    validateRuntimeConfig(config);
}
