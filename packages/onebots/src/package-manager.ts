import * as fs from "node:fs";
import * as path from "node:path";

export type SupportedPackageManager = "npm" | "pnpm";

export interface PackageInstallInvocation {
    executable: string;
    args: string[];
    environment: NodeJS.ProcessEnv;
}

/** 根据运行目录自己的清单和锁文件选择包管理器，避免被启动 OneBots 的外层命令误导。 */
export function detectRuntimePackageManager(runtimeRoot: string): SupportedPackageManager {
    if (
        fs.existsSync(path.join(runtimeRoot, "pnpm-lock.yaml")) ||
        fs.existsSync(path.join(runtimeRoot, "pnpm-workspace.yaml"))
    ) {
        return "pnpm";
    }
    if (fs.existsSync(path.join(runtimeRoot, "package-lock.json"))) return "npm";

    try {
        const manifest = JSON.parse(
            fs.readFileSync(path.join(runtimeRoot, "package.json"), "utf8"),
        ) as { packageManager?: string };
        if (manifest.packageManager?.startsWith("pnpm@")) return "pnpm";
        if (manifest.packageManager?.startsWith("npm@")) return "npm";
    } catch {
        // 调用方会单独校验 package.json；这里只回退到启动环境和 npm。
    }

    return process.env.npm_execpath?.includes("pnpm") ? "pnpm" : "npm";
}

const PNPM_ONLY_NPM_CONFIGS = new Set([
    "_icqqjs-registry",
    "global-bin-dir",
    "node-version",
    "only-built-dependencies",
    "recursive",
    "store-dir",
]);

/** pnpm 会把自身配置注入 npm_config_*；转调 npm 时移除会触发 npm 警告的字段。 */
export function sanitizeNpmEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const environment = { ...source };
    for (const key of Object.keys(environment)) {
        if (!key.toLowerCase().startsWith("npm_config_")) continue;
        const normalized = key
            .slice("npm_config_".length)
            .toLowerCase()
            .replaceAll("_", "-")
            .replace(/^-+/, "_");
        if (PNPM_ONLY_NPM_CONFIGS.has(normalized)) delete environment[key];
    }
    return environment;
}

/** 生成可直接执行的扩展安装命令；pnpm workspace 根目录必须显式使用 workspace-root。 */
export function buildExtensionInstallInvocation(
    runtimeRoot: string,
    packageName: string,
    platform: NodeJS.Platform = process.platform,
    environment: NodeJS.ProcessEnv = process.env,
): PackageInstallInvocation {
    const manager = detectRuntimePackageManager(runtimeRoot);
    return {
        executable: platform === "win32" ? `${manager}.cmd` : manager,
        args:
            manager === "pnpm"
                ? [
                      "add",
                      "--save-prod",
                      ...(fs.existsSync(path.join(runtimeRoot, "pnpm-workspace.yaml"))
                          ? ["--workspace-root"]
                          : []),
                      `${packageName}@latest`,
                  ]
                : ["install", "--save", "--omit=dev", `${packageName}@latest`],
        environment: manager === "npm" ? sanitizeNpmEnvironment(environment) : environment,
    };
}
