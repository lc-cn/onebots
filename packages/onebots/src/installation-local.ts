export {
    createInstallationPlan,
    type InstallationPlan,
    type InstallationBackend,
} from "./installation.js";
import { assertInProcessPackageMutationAllowed } from "./container-runtime.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { ApplicationRegistry } from "@onebots/core";
import metadata from "../package.json" with { type: "json" };
import {
    buildExtensionInstallInvocation,
    PACKAGE_MANAGER_MUTATION_TIMEOUT_MS,
    type PackageInstallInvocation,
} from "./package-manager.js";
import { acquirePackageMutationLock } from "./package-mutation-lock.js";
import { inspectPlugin, pluginCandidates, tryLoadRegisteredPlugin } from "./plugin-loader.js";
import type { RuntimePluginSelection } from "./runtime-plugin-selection.js";

/** 全局/npx 引导安装完本地宿主后，后续表单必须在同一份 core 注册表中执行。 */
export class TuiLocalRuntime extends Error {
    constructor(
        readonly binPath: string,
        readonly selection: RuntimePluginSelection,
    ) {
        super("切换到已安装的本地 OneBots，继续验证与配置");
    }
}

const execute = promisify(execFile);

type InstallExecutor = (invocation: PackageInstallInvocation, root: string) => Promise<void>;
const executeInstall: InstallExecutor = async (invocation, root) => {
    await execute(invocation.executable, invocation.args, {
        cwd: root,
        env: invocation.environment,
        // Windows 的 npm/pnpm 入口是 .cmd；参数仅来自已确认的可信包目录。
        shell: process.platform === "win32",
        timeout: PACKAGE_MANAGER_MUTATION_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
    });
};

export async function installPackages(
    packages: string[],
    root: string,
    token: string,
    executePackage: InstallExecutor = executeInstall,
    progress?: (message: string) => void,
): Promise<void> {
    assertInProcessPackageMutationAllowed();
    fs.mkdirSync(root, { recursive: true });
    const lock = acquirePackageMutationLock(root, {
        operation: "package_update",
        operationId: randomUUID(),
        token: randomUUID(),
    });
    let temporary: string | undefined;
    try {
        const manifestPath = path.join(root, "package.json");
        if (!fs.existsSync(manifestPath)) {
            fs.writeFileSync(
                manifestPath,
                JSON.stringify(
                    {
                        name: "onebots-runtime",
                        private: true,
                        type: "module",
                        dependencies: { onebots: metadata.version },
                    },
                    null,
                    2,
                ) + "\n",
                { flag: "wx" },
            );
        }
        const environment = { ...process.env };
        if (token) {
            temporary = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-install-"));
            fs.chmodSync(temporary, 0o700);
            const userconfig = path.join(temporary, "npmrc");
            fs.writeFileSync(
                userconfig,
                "@icqqjs:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${ONEBOTS_INSTALL_GITHUB_TOKEN}\n",
                { mode: 0o600 },
            );
            for (const key of Object.keys(environment)) {
                if (key.toLowerCase() === "npm_config_userconfig") delete environment[key];
            }
            environment.NPM_CONFIG_USERCONFIG = userconfig;
            environment.ONEBOTS_INSTALL_GITHUB_TOKEN = token;
            // 源码部署的项目 npmrc 也会通过此变量读取 GitHub Packages 认证。
            environment.NODE_AUTH_TOKEN = token;
        }
        const require = createRequire(path.join(root, "package.json"));
        const local = inspectPlugin(["onebots"], require);
        const bootstrap = local.status !== "ready" || local.version !== metadata.version;
        for (const spec of [...(bootstrap ? [`onebots@${metadata.version}`] : []), ...packages]) {
            progress?.(`正在安装 ${spec}`);
            const invocation = buildExtensionInstallInvocation(
                root,
                spec,
                process.platform,
                environment,
            );
            invocation.args.splice(1, 0, "--save-exact");
            try {
                await executePackage(invocation, root);
            } catch (error) {
                // npm 的原始输出可能包含安装凭据，仅报告包名及可操作的分类诊断。
                const output = error instanceof Error ? error.message : "";
                const hint = /E401|E403|401|403|unauthorized|forbidden/i.test(output)
                    ? "检查包读取权限和 read:packages Token 后重试"
                    : /ERESOLVE|ERR_PNPM_PEER_DEP_ISSUES|ERR_PNPM_NO_MATCHING_VERSION/i.test(output)
                      ? "检查适配器及 peerDependencies 的版本要求，修复冲突后重试"
                      : "检查网络、包管理器及 registry 配置后重试";
                throw new Error(`${spec} 安装失败：${hint}。已完成的依赖保留，账号配置尚未更新。`);
            }
            const separator = spec.lastIndexOf("@");
            const installed = inspectPlugin([spec.slice(0, separator)], require);
            if (installed.status !== "ready" || installed.version !== spec.slice(separator + 1))
                throw new Error(
                    `${spec} 安装后入口或版本不匹配，请修复依赖后重试；账号配置尚未更新`,
                );
        }
    } finally {
        if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
        lock.release();
    }
}

export async function loadSelection(
    selection: RuntimePluginSelection,
    root: string,
): Promise<void> {
    const localBin = localRuntimeBin(root);
    if (localBin) throw new TuiLocalRuntime(localBin, selection);
    const require = createRequire(path.join(root, "package.json"));
    for (const [type, names] of [
        ["adapter", selection.adapters],
        ["protocol", selection.protocols],
    ] as const) {
        for (const name of names) {
            const result = await tryLoadRegisteredPlugin(
                type,
                name,
                pluginCandidates(type, name),
                require,
            );
            if (!result.loaded)
                throw new Error(`${type}:${name} 加载验证失败，请运行 onebots doctor 检查依赖`);
        }
    }
    for (const name of selection.applications ?? []) {
        if (!ApplicationRegistry.has(name)) throw new Error(`框架方案 ${name} 未注册`);
        ApplicationRegistry.activate(name);
    }
}

export function localRuntimeBin(root: string): string | undefined {
    const require = createRequire(path.join(root, "package.json"));
    const local = inspectPlugin(["onebots"], require);
    if (
        local.status === "ready" &&
        fs.realpathSync(local.entryPath) !==
            fs.realpathSync(path.resolve(import.meta.dirname, "../lib/index.js"))
    ) {
        return path.join(path.dirname(local.entryPath), "bin.js");
    }
}

export function createLocalInstallationBackend(): import("./installation.js").InstallationBackend {
    return {
        install: (packages, root, token, progress) =>
            installPackages(packages, root, token, undefined, progress),
        verify: loadSelection,
    };
}
