import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { lstat, readFile, realpath } from "node:fs/promises";
import type { ServiceSpec } from "./service-definition.js";
import type { LegacyRuntimeRoot } from "./service-migration-runtime-forest-scan.js";
import { scanLegacyRuntimeForest } from "./service-migration-runtime-forest-scan.js";
import { within } from "./service-migration-runtime-tree-scan.js";

const invalid = () => new Error("旧安装依赖目录无法完整保留，请保留原安装，禁止自动切换");
interface Manifest {
    name: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}
const packageName = (name: string) =>
    /^(?:@[a-z0-9_-][a-z0-9_.-]*\/)?[a-z0-9_-][a-z0-9_.-]*$/iu.test(name);
async function manifest(directory: string): Promise<Manifest> {
    const file = path.join(directory, "package.json");
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw invalid();
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!value || typeof value !== "object" || !("name" in value) || typeof value.name !== "string")
        throw invalid();
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
        if (!(field in value)) continue;
        const record: unknown = value[field];
        if (
            !record ||
            typeof record !== "object" ||
            Array.isArray(record) ||
            Object.entries(record).some(
                ([name, version]) => !packageName(name) || typeof version !== "string",
            )
        )
            throw invalid();
    }
    return value as Manifest;
}
async function resolvePackage(name: string, from: string): Promise<string | undefined> {
    if (!packageName(name)) throw invalid();
    for (const directory of createRequire(path.join(from, "package.json")).resolve.paths(name) ??
        []) {
        const candidate = path.join(directory, name);
        try {
            await lstat(path.join(candidate, "package.json"));
            return candidate;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
    return undefined;
}
/** 不读取公共祖先内容；pnpm 仅保留单个虚拟仓库槽的依赖别名。 */
function packageContainer(directory: string): string {
    let modules = path.dirname(directory);
    if (path.basename(modules).startsWith("@")) modules = path.dirname(modules);
    return path.basename(modules) === "node_modules" &&
        path.basename(path.dirname(path.dirname(modules))) === ".pnpm"
        ? modules
        : directory;
}
function exclusions(spec: ServiceSpec, source: string): string[] {
    return [
        spec.configPath,
        path.join(path.dirname(spec.configPath), "data"),
        path.join(path.dirname(spec.configPath), ".control"),
    ]
        .filter(file => within(source, file))
        .map(file => path.relative(source, file).split(path.sep).join("/"));
}

/** 静态发现标准 npm/pnpm 布局；不执行插件，不重新安装，不捕获任意外部资源。 */
export async function discoverLegacyRuntimeLayout(spec: ServiceSpec): Promise<LegacyRuntimeRoot[]> {
    try {
        const cwd = await realpath(spec.workingDirectory);
        if (
            cwd !== spec.workingDirectory ||
            cwd === path.parse(cwd).root ||
            cwd === (await realpath(os.homedir()))
        )
            throw invalid();
        let host = path.dirname(await realpath(spec.binPath));
        while (true) {
            try {
                if ((await manifest(host)).name === "onebots") break;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
            const parent = path.dirname(host);
            if (parent === host) throw invalid();
            host = parent;
        }
        const sources = new Set<string>([cwd]);
        const add = async (directory: string) => {
            const source = await realpath(directory);
            if (source !== directory || source === path.parse(source).root) throw invalid();
            if ([...sources].some(root => within(root, source))) return;
            for (const root of sources) if (within(source, root)) sources.delete(root);
            sources.add(source);
            if (sources.size > 128) throw invalid();
        };
        await add(packageContainer(host));
        const queue = [host];
        const visited = new Set<string>();
        const select = async (lexical: string) => {
            const physical = await realpath(lexical);
            await add(packageContainer(physical));
            if (![...sources].some(root => within(root, lexical))) {
                const container = packageContainer(lexical);
                if (container === lexical && physical !== lexical) throw invalid();
                await add(container);
            }
            queue.push(physical);
            return physical;
        };
        const hostCore = await resolvePackage("@onebots/core", host);
        if (!hostCore) throw invalid();
        const core = await realpath(hostCore);
        for (const [kind, names] of [
            ["adapter", spec.adapters],
            ["protocol", spec.protocols],
        ] as const) {
            for (const name of names) {
                let plugin: string | undefined;
                for (const candidate of [
                    `@onebots/${kind}-${name}`,
                    `onebots-${kind}-${name}`,
                    name,
                ]) {
                    if (!packageName(candidate)) continue;
                    plugin = await resolvePackage(candidate, cwd);
                    if (plugin) break;
                }
                if (!plugin) throw invalid();
                const physical = await select(plugin);
                for (const [name, expected] of [
                    ["onebots", host],
                    ["@onebots/core", core],
                ]) {
                    const dependency = await resolvePackage(name!, physical);
                    if (dependency && (await realpath(dependency)) !== expected) throw invalid();
                }
            }
        }
        // 框架可能内置；外部应用按同一包名规则纳入，缺失项由既有预检负责判定。
        for (const name of spec.applications ?? []) {
            for (const candidate of [
                `@onebots/application-${name}`,
                `onebots-application-${name}`,
                name,
            ]) {
                if (!packageName(candidate)) continue;
                const application = await resolvePackage(candidate, cwd);
                if (application) {
                    const physical = await select(application);
                    for (const [dependencyName, expected] of [
                        ["onebots", host],
                        ["@onebots/core", core],
                    ] as const) {
                        const dependency = await resolvePackage(dependencyName, physical);
                        if (dependency && (await realpath(dependency)) !== expected)
                            throw invalid();
                    }
                    break;
                }
            }
        }
        while (queue.length) {
            const directory = queue.shift()!;
            if (visited.has(directory)) continue;
            visited.add(directory);
            if (visited.size > 10000) throw invalid();
            const value = await manifest(directory);
            const optional = value.optionalDependencies ?? {};
            const required = value.dependencies ?? {};
            for (const name of new Set([
                ...Object.keys(required),
                ...Object.keys(optional),
                ...Object.keys(value.peerDependencies ?? {}),
            ])) {
                const dependency = await resolvePackage(name, directory);
                if (!dependency) {
                    if (
                        (name in required && !(name in optional)) ||
                        (name in (value.peerDependencies ?? {}) &&
                            value.peerDependenciesMeta?.[name]?.optional !== true)
                    )
                        throw invalid();
                    continue;
                }
                await select(dependency);
            }
        }
        const roots = [...sources]
            .sort()
            .map(source => ({ source, excludedPaths: exclusions(spec, source) }));
        await scanLegacyRuntimeForest(roots);
        return roots;
    } catch (error) {
        // 不将旧目录或 manifest 中的敏感内容透传到管理端。
        throw invalid();
    }
}
