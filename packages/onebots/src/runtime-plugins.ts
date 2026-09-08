import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ApplicationRegistry } from "@onebots/core";
import { loadPlugin, pluginCandidates } from "./plugin-loader.js";
import "./framework-integration.js";

/** 扩展加载只依赖注册表；不得为使用工厂而导入或创建管理宿主。 */
export async function loadPlugins(
    adapters: string[],
    protocols: string[],
    applications: string[] = [],
): Promise<string[]> {
    const runtimeRequire = createRequire(pathToFileURL(path.join(process.cwd(), "node_modules")));
    const failures: string[] = [];
    for (const [type, names] of [
        ["adapter", adapters],
        ["protocol", protocols],
        ["application", applications],
    ] as const) {
        for (const name of names) {
            const loaded =
                type === "application" && ApplicationRegistry.has(name)
                    ? true
                    : await loadPlugin(type, name, pluginCandidates(type, name), runtimeRequire);
            if (!loaded) failures.push(`${type}:${name}`);
            else if (type === "application") ApplicationRegistry.activate(name);
        }
    }
    return failures;
}
