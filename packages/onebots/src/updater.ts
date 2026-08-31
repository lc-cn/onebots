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
import { getRuntimePluginSelection } from "./runtime-plugin-selection.js";
import { parseRuntimeConfig } from "./runtime-config-validator.js";
import { detectRuntimePackageManager } from "./package-manager.js";
import { probeDoctorEndpoint, resolveGatewayBaseUrl } from "./doctor.js";

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
        ...new Set([
            "onebots",
            ...adapters.map(name => `@onebots/adapter-${name}`),
            ...protocols.map(name => `@onebots/protocol-${name}`),
        ]),
    ];
}

/** 显式更新参数优先，其次使用当前配置，最后兼容旧服务保存的启动快照。 */
export function resolveUpdatePluginSelection(
    options: Pick<UpdateOptions, "adapters" | "protocols">,
    spec: ServiceSpec | null,
): { adapters: string[]; protocols: string[] } {
    const configured =
        spec && fs.existsSync(spec.configPath)
            ? getRuntimePluginSelection(
                  parseRuntimeConfig(fs.readFileSync(spec.configPath, "utf8")),
              )
            : undefined;
    return {
        adapters: options.adapters.length
            ? options.adapters
            : (configured?.adapters ?? spec?.adapters ?? []),
        protocols: options.protocols.length
            ? options.protocols
            : (configured?.protocols ?? spec?.protocols ?? []),
    };
}

/** 检查并更新 OneBots 与当前服务使用的插件。 */
export async function runUpdate(options: UpdateOptions): Promise<void> {
    const controller = new ServiceController(options.scope);
    const spec = controller.readSpec();
    const { adapters, protocols } = resolveUpdatePluginSelection(options, spec);
    const packages = packageNamesFor(adapters, protocols);
    const runtimeRoot = spec?.workingDirectory ?? process.cwd();
    const manager = detectRuntimePackageManager(runtimeRoot);
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
        const result = await refreshServiceAfterUpdate(
            controller,
            {
                ...spec,
                nodePath: process.execPath,
                binPath: path.resolve(process.argv[1]),
            },
            {
                expectedVersion: updates.find(item => item.name === "onebots")!.latest!,
                yes: options.yes,
            },
        );
        if (result.wasRunning && !result.restarted) {
            writeCliOutput("软件包已更新，但运行中的旧实例尚未重启；请执行 onebots restart");
            return;
        }
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
    verifyOnline(spec: ServiceSpec, expectedVersion: string): Promise<void>;
}

interface RefreshServiceOptions {
    expectedVersion: string;
    yes?: boolean;
    dependencies?: RefreshServiceDependencies;
}

export interface RefreshServiceResult {
    wasRunning: boolean;
    restarted: boolean;
    onlineVerified: boolean;
}

interface OnlineVerificationDependencies {
    fetcher?: typeof fetch;
    attempts?: number;
    intervalMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
}

/** 软件包更新后先用新 CLI 子进程预检，再改写服务定义和选择性重启。 */
export async function refreshServiceAfterUpdate(
    controller: UpdateServiceController,
    spec: ServiceSpec,
    options: RefreshServiceOptions,
): Promise<RefreshServiceResult> {
    const dependencies = options.dependencies ?? {
        preflight: runUpdatedServicePreflight,
        confirmRestart,
        verifyOnline: verifyUpdatedServiceOnline,
    };
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
    if (!wasRunning) return { wasRunning, restarted: false, onlineVerified: false };
    if (!options.yes && !(await dependencies.confirmRestart())) {
        return { wasRunning, restarted: false, onlineVerified: false };
    }
    await controller.restart();
    try {
        await dependencies.verifyOnline(spec, options.expectedVersion);
    } catch (error) {
        throw new Error(
            `软件包与服务定义已更新，服务也已重启，但在线验证失败：${error instanceof Error ? error.message : String(error)}；请运行 onebots status 并检查服务日志`,
            { cause: error instanceof Error ? error : undefined },
        );
    }
    return { wasRunning, restarted: true, onlineVerified: true };
}

/** 等待服务切换到目标 OneBots 版本，并确认其运行状态至少可继续首次配置。 */
export async function verifyUpdatedServiceOnline(
    spec: ServiceSpec,
    expectedVersion: string,
    dependencies: OnlineVerificationDependencies = {},
): Promise<void> {
    const fetcher = dependencies.fetcher ?? fetch;
    const attempts = dependencies.attempts ?? 10;
    const intervalMs = dependencies.intervalMs ?? 500;
    const sleep =
        dependencies.sleep ??
        ((milliseconds: number) =>
            new Promise(resolve => {
                setTimeout(resolve, milliseconds);
            }));
    const config = parseRuntimeConfig(fs.readFileSync(spec.configPath, "utf8"));
    const base = resolveGatewayBaseUrl(config);
    let lastEvidence = "服务尚未响应";
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const checks = await Promise.all([
            probeDoctorEndpoint(base, "health", fetcher, expectedVersion),
            probeDoctorEndpoint(base, "ready", fetcher),
        ]);
        if (checks[0].level === "ok" && checks[1].level !== "error") return;
        lastEvidence = checks.map(check => check.message).join("；");
        if (attempt < attempts - 1) await sleep(intervalMs);
    }
    throw new Error(`目标版本 ${expectedVersion} 未在重试窗口内就绪（${lastEvidence}）`);
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
