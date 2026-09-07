import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { ApplicationRegistry } from "@onebots/core";
import metadata from "../../package.json" with { type: "json" };
import { TRUSTED_EXTENSION_CATALOG as EXTENSION_CATALOG } from "../trusted-extension-catalog.js";
import { getExtensionPackageCatalogEntry } from "../extension-capability-catalog.js";
import { listFrameworkProfiles } from "../framework-integration.js";
import {
    buildExtensionInstallInvocation,
    PACKAGE_MANAGER_MUTATION_TIMEOUT_MS,
    type PackageInstallInvocation,
} from "../package-manager.js";
import { acquirePackageMutationLock } from "../package-mutation-lock.js";
import { inspectPlugin, pluginCandidates, tryLoadRegisteredPlugin } from "../plugin-loader.js";
import type { RuntimePluginSelection } from "../runtime-plugin-selection.js";
import { confirm, type TuiPrompt } from "./prompt.js";

export interface InstallationPlan {
    selection: RuntimePluginSelection;
    packages: string[];
}

/** 全局/npx 引导安装完本地宿主后，后续表单必须在同一份 core 注册表中执行。 */
export class TuiLocalRuntime extends Error {
    constructor(
        readonly binPath: string,
        readonly selection: RuntimePluginSelection,
    ) {
        super("切换到已安装的本地 OneBots，继续验证与配置");
    }
}

export function createInstallationPlan(selection: RuntimePluginSelection): InstallationPlan {
    const packages: string[] = [];
    for (const [type, names] of [
        ["adapter", selection.adapters],
        ["protocol", selection.protocols],
    ] as const) {
        for (const name of names) {
            const entry = EXTENSION_CATALOG.find(item => item.type === type && item.name === name);
            if (!entry) throw new Error(`安装目录中没有 ${type}:${name}`);
            const version = getExtensionPackageCatalogEntry(entry.packageName)?.packageVersion;
            if (!version) throw new Error(`缺少 ${entry.packageName} 的已验证版本`);
            packages.push(`${entry.packageName}@${version}`);
        }
    }
    for (const name of selection.applications ?? []) {
        const profile = listFrameworkProfiles().find(item => item.id === name);
        if (!profile) throw new Error(`未知框架方案：${name}`);
        const protocol = profile.protocol.replace(".", "-");
        if (!selection.protocols.includes(protocol))
            throw new Error(`${profile.displayName} 方案需要 ${protocol}，请返回协议选择页勾选`);
    }
    return { selection, packages: [...new Set(packages)] };
}

export interface InstallationDependencies {
    install(packages: string[], root: string, token: string): Promise<void>;
    verify(selection: RuntimePluginSelection, root: string): Promise<void>;
}

/** 确认之前只收集信息；验证失败时不落盘任何插件选择或账号配置。 */
export async function runInstallation(
    prompt: TuiPrompt,
    root: string,
    initial: RuntimePluginSelection,
    dependencies: InstallationDependencies = { install: installPackages, verify: loadSelection },
): Promise<RuntimePluginSelection | null> {
    let selection = structuredClone(initial);
    let token = "";
    try {
        while (true) {
            selection.adapters = await prompt.ask({
                title: "1/4 选择平台适配器",
                multiple: true,
                selected: selection.adapters,
                choices: EXTENSION_CATALOG.filter(item => item.type === "adapter").map(item => ({
                    value: item.name,
                    label: `${item.displayName} · ${item.name}`,
                })),
            });
            if (selection.adapters.includes("icqq")) {
                [token] = await prompt.ask({
                    title: "ICQQ 安装凭据：GitHub Packages Token",
                    secret: true,
                    detail: "需要有 @icqqjs 包读取权限及 read:packages 的 Token。仅用于本次安装，不写入配置或摘要。留空使用已有 npm 认证。",
                });
            } else token = "";
            selection.protocols = await prompt.ask({
                title: "2/4 选择输出协议",
                multiple: true,
                selected: selection.protocols,
                choices: EXTENSION_CATALOG.filter(item => item.type === "protocol").map(item => ({
                    value: item.name,
                    label: `${item.displayName} · ${item.description}`,
                })),
            });
            selection.applications = await prompt.ask({
                title: "3/4 选择接入框架（可不选）",
                multiple: true,
                selected: selection.applications,
                detail: "选择的是 OneBots 内置兼容方案；框架程序在下游单独部署。",
                choices: listFrameworkProfiles().map(item => ({
                    value: item.id,
                    label: `${item.displayName} · ${item.protocol} · ${item.applicationStage ?? item.verification}`,
                })),
            });
            let plan: InstallationPlan;
            try {
                plan = createInstallationPlan(selection);
            } catch (error) {
                prompt.report((error as Error).message);
                continue;
            }
            const confirmed = await confirm(
                prompt,
                "4/4 确认安装计划",
                [
                    `运行目录：${root}`,
                    `主程序：onebots@${metadata.version}（本地缺失或版本不同时安装）`,
                    `依赖：\n${plan.packages.join("\n") || "无"}`,
                    `框架方案：${selection.applications.join(", ") || "无"}`,
                    `ICQQ 凭据：${token ? "已输入（隐藏）" : "使用已有认证或不需要"}`,
                    "安装完成后检查插件加载，再进入账号与协议配置。返回可修改全部选择。",
                ].join("\n"),
            );
            if (!confirmed) continue;
            prompt.report("正在安装依赖，请等待…");
            await dependencies.install(plan.packages, root, token);
            token = "";
            prompt.report("正在验证适配器、协议及框架方案是否能加载…");
            await dependencies.verify(selection, root);
            prompt.report("依赖安装与加载验证通过，可以配置账号及协议。");
            return selection;
        }
    } finally {
        token = "";
    }
}

const execute = promisify(execFile);

type InstallExecutor = (invocation: PackageInstallInvocation, root: string) => Promise<void>;
const executeInstall: InstallExecutor = async (invocation, root) => {
    await execute(invocation.executable, invocation.args, {
        cwd: root,
        env: invocation.environment,
        timeout: PACKAGE_MANAGER_MUTATION_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
    });
};

export async function installPackages(
    packages: string[],
    root: string,
    token: string,
    executePackage: InstallExecutor = executeInstall,
): Promise<void> {
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
    const require = createRequire(path.join(root, "package.json"));
    const local = inspectPlugin(["onebots"], require);
    if (
        local.status === "ready" &&
        fs.realpathSync(local.entryPath) !==
            fs.realpathSync(path.resolve(import.meta.dirname, "../../lib/index.js"))
    ) {
        throw new TuiLocalRuntime(path.join(path.dirname(local.entryPath), "bin.js"), selection);
    }
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
