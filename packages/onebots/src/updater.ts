import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { execFileSync } from "node:child_process";
import {
    buildServiceArgs,
    ServiceController,
    type ServiceScope,
    type ServiceSpec,
} from "./service-manager.js";
import { writeCliOutput } from "./cli-output.js";
import { getRuntimePluginSelection } from "./runtime-plugin-selection.js";
import { parseRuntimeConfig } from "./runtime-config-validator.js";
import {
    buildPackageManagerInvocation,
    buildPackageUpdateInvocation,
    detectRuntimePackageManager,
} from "./package-manager.js";
import { readServiceInstanceId, verifyServiceOnline } from "./service-online-verification.js";

export interface UpdateOptions {
    adapters: string[];
    protocols: string[];
    scope: ServiceScope;
    check?: boolean;
    yes?: boolean;
}

interface PackageUpdateEvidence {
    name: string;
    target: string;
}

export interface PackageUpdateChange extends PackageUpdateEvidence {
    current: string | null;
}

export type UpdateRunResult =
    | { status: "current"; changes: [] }
    | { status: "updates_available" | "updated" | "cancelled"; changes: PackageUpdateChange[] };

interface ExtensionVersionCatalogSnapshot {
    schemaVersion?: unknown;
    packages?: unknown;
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

/** 使用目标 OneBots 随包发布的目录解析一组共同验证过的精确更新版本。 */
export function resolveVerifiedUpdateTargets(
    packageNames: readonly string[],
    onebotsVersion: string,
    snapshot: ExtensionVersionCatalogSnapshot,
): PackageUpdateEvidence[] {
    if (snapshot.schemaVersion !== 2 || !isRecord(snapshot.packages)) {
        throw new Error("目标 OneBots 的扩展版本目录格式无效");
    }
    return packageNames.map(name => {
        if (name === "onebots") return { name, target: onebotsVersion };
        const entry = snapshot.packages[name];
        const version = isRecord(entry) ? entry.version : undefined;
        if (typeof version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u.test(version)) {
            throw new Error(`目标 OneBots 的扩展版本目录缺少 ${name}`);
        }
        return { name, target: version };
    });
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
export async function runUpdate(options: UpdateOptions): Promise<UpdateRunResult> {
    const controller = new ServiceController(options.scope);
    const spec = controller.readSpec();
    const { adapters, protocols } = resolveUpdatePluginSelection(options, spec);
    const packages = packageNamesFor(adapters, protocols);
    const runtimeRoot = spec?.workingDirectory ?? process.cwd();
    const manager = detectRuntimePackageManager(runtimeRoot);
    const targetOnebotsVersion = latestVersion(manager, "onebots");
    if (!targetOnebotsVersion) throw new Error("无法查询包版本: onebots");
    const targetCatalog = loadTargetExtensionVersionCatalog(
        manager,
        runtimeRoot,
        targetOnebotsVersion,
    );
    const updates = resolveVerifiedUpdateTargets(packages, targetOnebotsVersion, targetCatalog).map(
        item => ({
            ...item,
            current: resolveInstalledPackageVersion(item.name, runtimeRoot),
        }),
    );
    for (const item of updates) {
        writeCliOutput(`${item.name}: ${item.current ?? "未安装"} -> ${item.target}`);
    }
    const changed = updates.filter(item => item.current !== item.target);
    if (!changed.length) {
        writeCliOutput("已是最新稳定版本");
        return { status: "current", changes: [] };
    }
    if (options.check) return { status: "updates_available", changes: changed };

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
                return { status: "cancelled", changes: changed };
            }
        } finally {
            prompt.close();
        }
    }

    if (isEphemeralNpx()) {
        const command =
            manager === "pnpm"
                ? `pnpm add ${changed.map(item => `${item.name}@${item.target}`).join(" ")}`
                : `npm install ${changed.map(item => `${item.name}@${item.target}`).join(" ")}`;
        throw new Error(`当前从 npx 临时缓存运行，无法安全自更新。请在项目中执行: ${command}`);
    }
    const names = changed.map(item => `${item.name}@${item.target}`);
    const projectRoot = findProjectRoot(runtimeRoot);
    const invocation = buildPackageUpdateInvocation(runtimeRoot, names, projectRoot);
    execFileSync(invocation.executable, invocation.args, {
        cwd: invocation.cwd,
        env: invocation.environment,
        stdio: "inherit",
    });
    assertUpdatedPackageVersions(updates, runtimeRoot);
    if (spec) {
        const result = await refreshServiceAfterUpdate(
            controller,
            {
                ...spec,
                nodePath: process.execPath,
                binPath: path.resolve(process.argv[1]),
            },
            {
                expectedVersion: targetOnebotsVersion,
                yes: options.yes,
            },
        );
        if (result.wasRunning && !result.restarted) {
            writeCliOutput("软件包已更新，但运行中的旧实例尚未重启；请执行 onebots restart");
            return { status: "updated", changes: changed };
        }
    }
    writeCliOutput("OneBots 及插件更新完成");
    return { status: "updated", changes: changed };
}

/** 包管理器成功退出后，逐包确认实际清单版本，再允许服务预检与切换。 */
export function assertUpdatedPackageVersions(
    updates: readonly PackageUpdateEvidence[],
    runtimeRoot: string,
    resolveVersion: (name: string, root: string) => string | null = resolveInstalledPackageVersion,
): void {
    const mismatches = updates.flatMap(item => {
        const actual = resolveVersion(item.name, runtimeRoot);
        return actual === item.target ? [] : [{ ...item, actual }];
    });
    if (!mismatches.length) return;
    const evidence = mismatches
        .map(item => `${item.name} 期望 ${item.target}，实际 ${item.actual ?? "未安装"}`)
        .join("；");
    throw new Error(`包更新版本校验失败：${evidence}。服务预检、定义改写与重启均未执行`);
}

interface UpdateServiceController {
    status(): { running: boolean };
    install(spec: ServiceSpec): Promise<void>;
    restart(): Promise<void>;
}

interface RefreshServiceDependencies {
    preflight(spec: ServiceSpec): void | Promise<void>;
    confirmRestart(): Promise<boolean>;
    readInstanceId(spec: ServiceSpec): Promise<string | null>;
    verifyOnline(
        spec: ServiceSpec,
        expectedVersion: string,
        previousInstanceId: string | null,
    ): Promise<void>;
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

/** 软件包更新后先用新 CLI 子进程预检，再改写服务定义和选择性重启。 */
export async function refreshServiceAfterUpdate(
    controller: UpdateServiceController,
    spec: ServiceSpec,
    options: RefreshServiceOptions,
): Promise<RefreshServiceResult> {
    const dependencies = options.dependencies ?? {
        preflight: runUpdatedServicePreflight,
        confirmRestart,
        readInstanceId: readServiceInstanceId,
        verifyOnline: (targetSpec, expectedVersion, previousInstanceId) =>
            verifyServiceOnline(targetSpec, expectedVersion, { previousInstanceId }),
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
    const previousInstanceId = await dependencies.readInstanceId(spec);
    await controller.restart();
    try {
        await dependencies.verifyOnline(spec, options.expectedVersion, previousInstanceId);
    } catch (error) {
        throw new Error(
            `软件包与服务定义已更新，服务也已重启，但在线验证失败：${error instanceof Error ? error.message : String(error)}；请运行 onebots status 并检查服务日志`,
            { cause: error instanceof Error ? error : undefined },
        );
    }
    return { wasRunning, restarted: true, onlineVerified: true };
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

export function resolveInstalledPackageVersion(
    name: string,
    runtimeRoot: string,
    cliEntry = process.argv[1],
): string | null {
    const packageParts = name.split("/");
    const origins = [runtimeRoot];
    if (cliEntry) {
        try {
            origins.push(fs.realpathSync(cliEntry));
        } catch {
            origins.push(path.resolve(cliEntry));
        }
    }
    const visited = new Set<string>();
    for (const origin of origins) {
        let current =
            fs.existsSync(origin) && fs.statSync(origin).isDirectory()
                ? path.resolve(origin)
                : path.dirname(path.resolve(origin));
        while (!visited.has(current)) {
            visited.add(current);
            for (const manifest of [
                path.join(current, "node_modules", ...packageParts, "package.json"),
                path.join(current, ...packageParts, "package.json"),
                path.join(current, "package.json"),
            ]) {
                const version = readPackageVersion(manifest, name);
                if (version) return version;
            }
            const parent = path.dirname(current);
            if (parent === current) break;
            current = parent;
        }
    }
    return null;
}

function readPackageVersion(manifest: string, expectedName: string): string | null {
    if (!fs.existsSync(manifest)) return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as {
            name?: unknown;
            version?: unknown;
        };
        return parsed.name === expectedName &&
            typeof parsed.version === "string" &&
            parsed.version.trim()
            ? parsed.version.trim()
            : null;
    } catch {
        return null;
    }
}

/** 从当前安装或隔离暂存的目标 OneBots 包读取版本目录。 */
export function loadTargetExtensionVersionCatalog(
    manager: "npm" | "pnpm",
    runtimeRoot: string,
    onebotsVersion: string,
): ExtensionVersionCatalogSnapshot {
    const installedVersion = resolveInstalledPackageVersion("onebots", runtimeRoot);
    const installedCatalog = findInstalledOnebotsCatalog(runtimeRoot);
    if (installedVersion === onebotsVersion && installedCatalog) {
        return readExtensionVersionCatalog(installedCatalog);
    }

    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-update-catalog-"));
    try {
        fs.writeFileSync(
            path.join(stagingRoot, "package.json"),
            '{"name":"onebots-update-catalog","private":true}\n',
            "utf8",
        );
        const invocation = buildPackageManagerInvocation(
            manager,
            manager === "pnpm"
                ? ["add", "--ignore-scripts", "--save-prod", `onebots@${onebotsVersion}`]
                : [
                      "install",
                      "--ignore-scripts",
                      "--no-save",
                      "--omit=dev",
                      `onebots@${onebotsVersion}`,
                  ],
        );
        execFileSync(invocation.executable, invocation.args, {
            cwd: stagingRoot,
            env: invocation.environment,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 10 * 60 * 1000,
            maxBuffer: 4 * 1024 * 1024,
        });
        return readExtensionVersionCatalog(
            path.join(
                stagingRoot,
                "node_modules",
                "onebots",
                "lib",
                "extension-capability-catalog.json",
            ),
        );
    } catch (error) {
        const detail =
            error && typeof error === "object" && "stderr" in error
                ? String(error.stderr).trim()
                : error instanceof Error
                  ? error.message
                  : String(error);
        throw new Error(`无法读取 onebots@${onebotsVersion} 的扩展版本目录：${detail}`, {
            cause: error instanceof Error ? error : undefined,
        });
    } finally {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
}

function findInstalledOnebotsCatalog(runtimeRoot: string): string | null {
    const candidates = [runtimeRoot];
    if (process.argv[1]) candidates.push(path.dirname(path.resolve(process.argv[1])));
    const visited = new Set<string>();
    for (const origin of candidates) {
        let current = path.resolve(origin);
        while (!visited.has(current)) {
            visited.add(current);
            for (const candidate of [
                path.join(
                    current,
                    "node_modules",
                    "onebots",
                    "lib",
                    "extension-capability-catalog.json",
                ),
                path.join(current, "lib", "extension-capability-catalog.json"),
            ]) {
                if (fs.existsSync(candidate)) return candidate;
            }
            const parent = path.dirname(current);
            if (parent === current) break;
            current = parent;
        }
    }
    return null;
}

function readExtensionVersionCatalog(file: string): ExtensionVersionCatalogSnapshot {
    if (!fs.existsSync(file)) throw new Error(`扩展版本目录不存在: ${file}`);
    return JSON.parse(fs.readFileSync(file, "utf8")) as ExtensionVersionCatalogSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function latestVersion(manager: "npm" | "pnpm", name: string): string | null {
    const invocation = buildPackageManagerInvocation(manager, ["view", name, "version"]);
    try {
        return execFileSync(invocation.executable, invocation.args, {
            encoding: "utf8",
            env: invocation.environment,
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
