import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import packageMetadata from "../../package.json" with { type: "json" };
import { loadRuntimeArtifacts } from "./runtime-artifacts.js";
import type { GenerationResolverConfig } from "./generation-resolver.js";

/** 可信产品自身的精确版本；未发布构建须通过本地归档覆盖，不回退 latest。 */
export function bundledRuntimeArtifacts(): GenerationResolverConfig {
    const coreEntry = fileURLToPath(import.meta.resolve("@onebots/core"));
    const metadata: unknown = JSON.parse(
        fs.readFileSync(path.resolve(path.dirname(coreEntry), "../package.json"), "utf8"),
    );
    if (
        !metadata ||
        typeof metadata !== "object" ||
        !("version" in metadata) ||
        typeof metadata.version !== "string"
    )
        throw new Error("当前核心包身份无法读取");
    const config = {
        host: { name: "onebots", version: packageMetadata.version, spec: packageMetadata.version },
        core: { name: "@onebots/core", version: metadata.version, spec: metadata.version },
    };
    return process.env.ONEBOTS_RUNTIME_ARTIFACTS
        ? loadRuntimeArtifacts(process.env.ONEBOTS_RUNTIME_ARTIFACTS, config)
        : config;
}


/** 产品自带包管理器，不依赖用户全局安装 pnpm。 */
export function bundledPnpmExecutor() {
    return {
        pnpmExecutable: process.execPath,
        pnpmScript: path.join(path.dirname(fileURLToPath(import.meta.resolve("pnpm"))), "bin/pnpm.cjs"),
    };
}
