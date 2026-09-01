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
    manager: SupportedPackageManager | null;
    executable: string | null;
    resolvedPath: string | null;
    error: string | null;
}

interface RuntimePackageManagerResolution {
    manager: SupportedPackageManager | null;
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
    const resolution = resolveRuntimePackageManager(runtimeRoot, environment);
    if (resolution.error || !resolution.manager) {
        throw new Error(resolution.error ?? "无法确定扩展运行目录的包管理器");
    }
    return resolution.manager;
}

function resolveRuntimePackageManager(
    runtimeRoot: string,
    environment: NodeJS.ProcessEnv,
): RuntimePackageManagerResolution {
    const resolvedRoot = path.resolve(runtimeRoot);
    let directory: string;
    try {
        directory = fs.realpathSync(resolvedRoot);
    } catch {
        // 由后续运行目录检查报告缺失或不可访问；包管理器检测仍保留原路径诊断。
        directory = resolvedRoot;
    }
    while (true) {
        const evidence = inspectPackageManagerEvidence(directory);
        if (evidence.error || evidence.manager) return evidence;

        const parent = path.dirname(directory);
        if (parent === directory) break;
        directory = parent;
    }

    return resolveInvokingPackageManager(environment);
}

/** 验证运行目录选出的包管理器能由当前进程实际启动。 */
export function inspectRuntimePackageManager(
    runtimeRoot: string,
    environment: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
    access: (target: string, mode: number) => void = fs.accessSync,
): RuntimePackageManagerInspection {
    const resolution = resolveRuntimePackageManager(runtimeRoot, environment);
    if (resolution.error || !resolution.manager) {
        return {
            manager: null,
            executable: null,
            resolvedPath: null,
            error: resolution.error ?? "无法确定扩展运行目录的包管理器",
        };
    }
    const manager = resolution.manager;
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

function inspectPackageManagerEvidence(directory: string): RuntimePackageManagerResolution {
    const npmEvidence: string[] = [];
    const pnpmEvidence: string[] = [];
    const unsupportedEvidence: string[] = [];

    if (fs.existsSync(path.join(directory, "package-lock.json")))
        npmEvidence.push("package-lock.json");
    if (fs.existsSync(path.join(directory, "pnpm-lock.yaml"))) pnpmEvidence.push("pnpm-lock.yaml");
    if (fs.existsSync(path.join(directory, "pnpm-workspace.yaml")))
        pnpmEvidence.push("pnpm-workspace.yaml");
    for (const lockfile of ["yarn.lock", "bun.lock", "bun.lockb"]) {
        if (fs.existsSync(path.join(directory, lockfile))) unsupportedEvidence.push(lockfile);
    }

    const manifestPath = path.join(directory, "package.json");
    if (fs.existsSync(manifestPath)) {
        let manifest: Record<string, unknown>;
        try {
            const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                return { manager: null, error: `包管理器清单根节点无效: ${manifestPath}` };
            }
            manifest = parsed as Record<string, unknown>;
        } catch {
            return { manager: null, error: `包管理器清单无法读取或不是有效 JSON: ${manifestPath}` };
        }
        if ("packageManager" in manifest) {
            const declared = manifest.packageManager;
            if (typeof declared !== "string" || !declared.trim()) {
                return { manager: null, error: `packageManager 声明无效: ${manifestPath}` };
            }
            const declaration = declared.match(/^([a-z0-9._-]+)@([^\s]+)$/iu);
            if (!declaration) {
                return { manager: null, error: `packageManager 声明无效: ${manifestPath}` };
            }
            if (declaration[1] === "npm") npmEvidence.push(`packageManager=${declared}`);
            else if (declaration[1] === "pnpm") pnpmEvidence.push(`packageManager=${declared}`);
            else unsupportedEvidence.push(`packageManager=${declared}`);
        }
    }

    if (unsupportedEvidence.length) {
        return {
            manager: null,
            error: `扩展运行目录使用 OneBots 尚不支持的包管理器（${unsupportedEvidence.join("、")}）: ${directory}。请改用 npm 或 pnpm，并只保留对应锁文件。`,
        };
    }
    if (npmEvidence.length && pnpmEvidence.length) {
        return {
            manager: null,
            error: `扩展运行目录的包管理器证据冲突（npm: ${npmEvidence.join("、")}；pnpm: ${pnpmEvidence.join("、")}）: ${directory}。请确认实际使用的包管理器并只保留对应锁文件与 packageManager 声明。`,
        };
    }
    if (pnpmEvidence.length) return { manager: "pnpm", error: null };
    if (npmEvidence.length) return { manager: "npm", error: null };
    return { manager: null, error: null };
}

function resolveInvokingPackageManager(
    environment: NodeJS.ProcessEnv,
): RuntimePackageManagerResolution {
    const userAgentManager = environment.npm_config_user_agent?.split(/[\s/]/u)[0]?.toLowerCase();
    const executable = environment.npm_execpath
        ?.replaceAll("\\", "/")
        .split("/")
        .at(-1)
        ?.toLowerCase();
    const executableManager = executable?.startsWith("pnpm")
        ? "pnpm"
        : executable?.startsWith("npm")
          ? "npm"
          : executable?.startsWith("yarn")
            ? "yarn"
            : executable?.startsWith("bun")
              ? "bun"
              : executable?.replace(/\.(?:c?js|cmd)$/u, "");
    const invoked = userAgentManager || executableManager;
    if (invoked === "pnpm") return { manager: "pnpm", error: null };
    if (invoked === "npm" || !invoked) return { manager: "npm", error: null };
    return {
        manager: null,
        error: `当前进程由 OneBots 尚不支持的包管理器 ${invoked} 启动，且项目没有明确的 npm/pnpm 证据。请改用 npm 或 pnpm 启动。`,
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
