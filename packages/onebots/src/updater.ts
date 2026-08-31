import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
    buildServiceArgs,
    ServiceController,
    type ServiceScope,
    type ServiceSpec,
} from "./service-manager.js";
import { writeCliOutput } from "./cli-output.js";

export interface UpdateOptions {
    adapters: string[];
    protocols: string[];
    scope: ServiceScope;
    check?: boolean;
    yes?: boolean;
}

/** 将 adapter/protocol 短名转换为可更新的 npm 包名列表。 */
export function packageNamesFor(adapters: string[], protocols: string[]): string[] {
    return [
        "onebots",
        ...adapters.map(name => `@onebots/adapter-${name}`),
        ...protocols.map(name => `@onebots/protocol-${name}`),
    ];
}

/** 检查并更新 OneBots 与当前服务使用的插件。 */
export async function runUpdate(options: UpdateOptions): Promise<void> {
    const controller = new ServiceController(options.scope);
    const spec = controller.readSpec();
    const adapters = options.adapters.length ? options.adapters : (spec?.adapters ?? []);
    const protocols = options.protocols.length ? options.protocols : (spec?.protocols ?? []);
    const packages = packageNamesFor(adapters, protocols);
    const runtimeRoot = spec?.workingDirectory ?? process.cwd();
    const manager = detectPackageManager(runtimeRoot);
    const updates = packages.map(name => ({
        name,
        current: installedVersion(name, runtimeRoot),
        latest: latestVersion(manager, name),
    }));
    for (const item of updates) {
        writeCliOutput(`${item.name}: ${item.current ?? "未安装"} -> ${item.latest ?? "无法查询"}`);
    }
    const unavailable = updates.filter(item => !item.latest);
    if (unavailable.length)
        throw new Error(`无法查询包版本: ${unavailable.map(item => item.name).join(", ")}`);
    const changed = updates.filter(item => item.current !== item.latest);
    if (!changed.length) {
        writeCliOutput("已是最新稳定版本");
        return;
    }
    if (options.check) return;

    if (!options.yes) {
        if (!process.stdin.isTTY) throw new Error("非交互环境执行更新需要 --yes");
        const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
            const answer = (
                await prompt.question(`更新 ${changed.length} 个包并修改锁文件？ [y/N] `)
            )
                .trim()
                .toLowerCase();
            if (answer !== "y" && answer !== "yes") {
                writeCliOutput("已取消");
                return;
            }
        } finally {
            prompt.close();
        }
    }

    if (isEphemeralNpx()) {
        const command =
            manager === "pnpm"
                ? `pnpm add ${changed.map(item => `${item.name}@latest`).join(" ")}`
                : `npm install ${changed.map(item => `${item.name}@latest`).join(" ")}`;
        throw new Error(`当前从 npx 临时缓存运行，无法安全自更新。请在项目中执行: ${command}`);
    }
    const names = changed.map(item => `${item.name}@latest`);
    const projectRoot = findProjectRoot(runtimeRoot);
    if (manager === "pnpm") {
        execFileSync("pnpm", projectRoot ? ["up", ...names] : ["add", "--global", ...names], {
            cwd: projectRoot ?? runtimeRoot,
            stdio: "inherit",
        });
    } else {
        execFileSync("npm", ["install", ...(projectRoot ? [] : ["--global"]), ...names], {
            cwd: projectRoot ?? runtimeRoot,
            stdio: "inherit",
        });
    }
    if (spec) {
        await refreshServiceAfterUpdate(
            controller,
            {
                ...spec,
                nodePath: process.execPath,
                binPath: path.resolve(process.argv[1]),
            },
            options.yes,
        );
    }
    writeCliOutput("OneBots 及插件更新完成");
}

interface UpdateServiceController {
    status(): { running: boolean };
    install(spec: ServiceSpec): Promise<void>;
    restart(): Promise<void>;
}

interface RefreshServiceDependencies {
    preflight(spec: ServiceSpec): void | Promise<void>;
    confirmRestart(): Promise<boolean>;
}

/** 软件包更新后先用新 CLI 子进程预检，再改写服务定义和选择性重启。 */
export async function refreshServiceAfterUpdate(
    controller: UpdateServiceController,
    spec: ServiceSpec,
    yes = false,
    dependencies: RefreshServiceDependencies = {
        preflight: runUpdatedServicePreflight,
        confirmRestart,
    },
): Promise<void> {
    const wasRunning = controller.status().running;
    try {
        await dependencies.preflight(spec);
    } catch (error) {
        throw new Error(
            `软件包已更新，但新运行环境预检失败；服务定义与当前运行实例保持不变：${error instanceof Error ? error.message : String(error)}`,
            { cause: error instanceof Error ? error : undefined },
        );
    }
    await controller.install(spec);
    if (wasRunning && (yes || (await dependencies.confirmRestart()))) {
        await controller.restart();
    }
}

/** 使用更新后的 Node/CLI 路径，在服务实际工作目录中运行隔离预检。 */
export function runUpdatedServicePreflight(spec: ServiceSpec): void {
    try {
        execFileSync(spec.nodePath, buildServiceArgs(spec, "preflight"), {
            cwd: spec.workingDirectory,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch (error) {
        const stderr =
            error && typeof error === "object" && "stderr" in error
                ? String(error.stderr).trim()
                : "";
        throw new Error(stderr || (error instanceof Error ? error.message : String(error)), {
            cause: error instanceof Error ? error : undefined,
        });
    }
}

function detectPackageManager(runtimeRoot: string): "npm" | "pnpm" {
    if (process.env.npm_execpath?.includes("pnpm")) return "pnpm";
    if (fs.existsSync(path.join(runtimeRoot, "pnpm-lock.yaml"))) return "pnpm";
    return "npm";
}

function installedVersion(name: string, runtimeRoot: string): string | null {
    try {
        const require = createRequire(path.join(runtimeRoot, "package.json"));
        let current = path.dirname(require.resolve(name));
        while (current !== path.dirname(current)) {
            const manifest = path.join(current, "package.json");
            if (fs.existsSync(manifest)) {
                const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as {
                    name?: string;
                    version?: string;
                };
                if (parsed.name === name && parsed.version) return parsed.version;
            }
            current = path.dirname(current);
        }
        return null;
    } catch {
        return null;
    }
}

function latestVersion(manager: "npm" | "pnpm", name: string): string | null {
    try {
        return execFileSync(manager, ["view", name, "version"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        }).trim();
    } catch {
        return null;
    }
}

function isEphemeralNpx(): boolean {
    return /[\\/]_npx[\\/]/.test(process.argv[1] || "");
}

function findProjectRoot(from: string): string | null {
    let current = path.resolve(from);
    while (current !== path.dirname(current)) {
        const manifest = path.join(current, "package.json");
        if (fs.existsSync(manifest)) {
            const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as {
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
            };
            if (
                parsed.dependencies?.onebots ||
                parsed.devDependencies?.onebots ||
                parsed.dependencies?.["@onebots/core"]
            )
                return current;
        }
        current = path.dirname(current);
    }
    return null;
}

async function confirmRestart(): Promise<boolean> {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = (await prompt.question("服务正在运行，立即重启？ [y/N] "))
            .trim()
            .toLowerCase();
        return answer === "y" || answer === "yes";
    } finally {
        prompt.close();
    }
}
