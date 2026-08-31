import * as fs from "node:fs";
import * as path from "node:path";

export type SupportedPackageManager = "npm" | "pnpm";

export interface PackageInstallInvocation {
    executable: string;
    args: string[];
    environment: NodeJS.ProcessEnv;
}

export interface PackageUpdateInvocation extends PackageInstallInvocation {
    cwd: string;
}

export interface RuntimePackageManagerInspection {
    manager: SupportedPackageManager;
    executable: string;
    resolvedPath: string | null;
    error: string | null;
}

/**
 * 根据运行目录及其最近项目根的清单和锁文件选择包管理器。
 *
 * pnpm workspace 成员通常没有自己的锁文件或 packageManager；即使由 `node` 直接启动，
 * 也必须沿目录向上识别 workspace，避免把含 workspace:/catalog: 的项目交给 npm。
 */
export function detectRuntimePackageManager(
    runtimeRoot: string,
    environment: NodeJS.ProcessEnv = process.env,
): SupportedPackageManager {
    let directory = path.resolve(runtimeRoot);
    while (true) {
        if (
            fs.existsSync(path.join(directory, "pnpm-lock.yaml")) ||
            fs.existsSync(path.join(directory, "pnpm-workspace.yaml"))
        ) {
            return "pnpm";
        }
        if (fs.existsSync(path.join(directory, "package-lock.json"))) return "npm";

        try {
            const manifest = JSON.parse(
                fs.readFileSync(path.join(directory, "package.json"), "utf8"),
            ) as { packageManager?: string };
            if (manifest.packageManager?.startsWith("pnpm@")) return "pnpm";
            if (manifest.packageManager?.startsWith("npm@")) return "npm";
        } catch {
            // 当前层没有可用清单时继续查找最近的项目根。
        }

        const parent = path.dirname(directory);
        if (parent === directory) break;
        directory = parent;
    }

    return environment.npm_execpath?.includes("pnpm") ? "pnpm" : "npm";
}

/** 验证运行目录选出的包管理器能由当前进程实际启动。 */
export function inspectRuntimePackageManager(
    runtimeRoot: string,
    environment: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
    access: (target: string, mode: number) => void = fs.accessSync,
): RuntimePackageManagerInspection {
    const manager = detectRuntimePackageManager(runtimeRoot, environment);
    const executable = platform === "win32" ? `${manager}.cmd` : manager;
    const searchPath = getEnvironmentPath(environment, platform);
    const mode = platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK;

    const delimiter = platform === "win32" ? ";" : ":";
    for (const entry of searchPath.split(delimiter)) {
        const directory = unquotePathEntry(entry) || ".";
        const candidate = path.resolve(runtimeRoot, directory, executable);
        try {
            access(candidate, mode);
            return { manager, executable, resolvedPath: candidate, error: null };
        } catch {
            // 与 execFile 相同，继续搜索 PATH 中的下一个入口。
        }
    }

    const remedy =
        manager === "pnpm"
            ? "请安装 pnpm 或通过 corepack 激活后重启 OneBots。"
            : "请安装包含 npm 的 Node.js 发行版后重启 OneBots。";
    return {
        manager,
        executable,
        resolvedPath: null,
        error: `扩展运行目录需要 ${manager}，但当前进程的 PATH 中找不到可执行入口。${remedy}`,
    };
}

function getEnvironmentPath(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
    const pathEntry = Object.entries(environment).find(
        ([key]) => key.toLowerCase() === "path",
    )?.[1];
    if (pathEntry !== undefined) return pathEntry;
    return platform === "win32" ? "" : "/usr/bin:/bin";
}

function unquotePathEntry(entry: string): string {
    const trimmed = entry.trim();
    return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
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

/** 统一生成跨平台包管理器进程调用，并隔离 npm 不认识的 pnpm 环境配置。 */
export function buildPackageManagerInvocation(
    manager: SupportedPackageManager,
    args: string[],
    platform: NodeJS.Platform = process.platform,
    environment: NodeJS.ProcessEnv = process.env,
): PackageInstallInvocation {
    return {
        executable: platform === "win32" ? `${manager}.cmd` : manager,
        args,
        environment: manager === "npm" ? sanitizeNpmEnvironment(environment) : environment,
    };
}

/** 生成可直接执行的扩展安装命令；pnpm workspace 根目录必须显式使用 workspace-root。 */
export function buildExtensionInstallInvocation(
    runtimeRoot: string,
    packageSpec: string,
    platform: NodeJS.Platform = process.platform,
    environment: NodeJS.ProcessEnv = process.env,
): PackageInstallInvocation {
    const manager = detectRuntimePackageManager(runtimeRoot, environment);
    return buildPackageManagerInvocation(
        manager,
        manager === "pnpm"
            ? [
                  "add",
                  "--save-prod",
                  ...(fs.existsSync(path.join(runtimeRoot, "pnpm-workspace.yaml"))
                      ? ["--workspace-root"]
                      : []),
                  packageSpec,
              ]
            : ["install", "--save", "--omit=dev", packageSpec],
        platform,
        environment,
    );
}

/** 生成扩展安装失败后的反向恢复命令；旧版本为空时移除新依赖。 */
export function buildExtensionRestoreInvocation(
    runtimeRoot: string,
    packageName: string,
    previousVersion: string | null,
    platform: NodeJS.Platform = process.platform,
    environment: NodeJS.ProcessEnv = process.env,
): PackageInstallInvocation {
    const manager = detectRuntimePackageManager(runtimeRoot, environment);
    const workspaceRoot =
        manager === "pnpm" && fs.existsSync(path.join(runtimeRoot, "pnpm-workspace.yaml"))
            ? ["--workspace-root"]
            : [];
    const args = previousVersion
        ? manager === "pnpm"
            ? ["add", "--save-prod", ...workspaceRoot, `${packageName}@${previousVersion}`]
            : ["install", "--save", "--omit=dev", `${packageName}@${previousVersion}`]
        : manager === "pnpm"
          ? ["remove", ...workspaceRoot, packageName]
          : ["uninstall", "--save", "--omit=dev", packageName];
    return buildPackageManagerInvocation(manager, args, platform, environment);
}

/** 生成项目或全局运行时的批量更新调用；项目更新不恢复开发依赖。 */
export function buildPackageUpdateInvocation(
    runtimeRoot: string,
    packageSpecs: string[],
    projectRoot: string | null,
    platform: NodeJS.Platform = process.platform,
    environment: NodeJS.ProcessEnv = process.env,
): PackageUpdateInvocation {
    const manager = detectRuntimePackageManager(runtimeRoot, environment);
    const invocation = buildPackageManagerInvocation(
        manager,
        manager === "pnpm"
            ? projectRoot
                ? ["up", ...packageSpecs]
                : ["add", "--global", ...packageSpecs]
            : [
                  "install",
                  ...(projectRoot ? ["--save", "--omit=dev"] : ["--global"]),
                  ...packageSpecs,
              ],
        platform,
        environment,
    );
    return { ...invocation, cwd: projectRoot ?? runtimeRoot };
}

/** 生成项目或全局运行时的批量依赖移除调用，用于更新事务恢复。 */
export function buildPackageRemovalInvocation(
    runtimeRoot: string,
    packageNames: string[],
    projectRoot: string | null,
    platform: NodeJS.Platform = process.platform,
    environment: NodeJS.ProcessEnv = process.env,
): PackageUpdateInvocation {
    const manager = detectRuntimePackageManager(runtimeRoot, environment);
    const invocation = buildPackageManagerInvocation(
        manager,
        manager === "pnpm"
            ? ["remove", ...(projectRoot ? [] : ["--global"]), ...packageNames]
            : [
                  "uninstall",
                  ...(projectRoot ? ["--save", "--omit=dev"] : ["--global"]),
                  ...packageNames,
              ],
        platform,
        environment,
    );
    return { ...invocation, cwd: projectRoot ?? runtimeRoot };
}
