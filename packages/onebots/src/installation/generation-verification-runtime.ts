import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import semver from "semver";
import type { GenerationPlan } from "./generation-plan.js";

interface Manifest {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

class MissingDependency extends Error {}

function inside(root: string, file: string): string {
    const real = fs.realpathSync(file);
    if (!real.startsWith(`${root}${path.sep}`)) throw new Error("boundary");
    return real;
}

function manifest(file: string): Manifest {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("manifest");
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value.name !== "string" || !semver.valid(value.version))
        throw new Error("identity");
    return value;
}

function resolveManifest(root: string, name: string, from: string): string {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw new Error("name");
    const require = createRequire(from);
    for (const directory of require.resolve.paths(name) ?? []) {
        const file = path.join(directory, name, "package.json");
        if (fs.existsSync(file)) {
            const real = inside(root, file);
            if (manifest(real).name !== name) throw new Error("package name");
            return real;
        }
    }
    throw new MissingDependency("missing");
}

/** 在已隔离的 worker 内执行依赖、单宿主、插件注册和 Schema 验证。 */
export async function verifyGenerationRuntime(
    directory: string,
    plan: GenerationPlan,
): Promise<string> {
    const root = fs.realpathSync(directory);
    const from = path.join(root, "package.json");
    const require = createRequire(from);
    const hosts = new Map<string, string>();
    const pending: string[] = [];
    for (const expected of [
        plan.host,
        plan.core,
        ...plan.extensions.map(extension => ({
            name: extension.packageName,
            version: extension.version,
        })),
    ]) {
        const name = expected.name;
        const file = resolveManifest(root, name, from);
        const found = manifest(file);
        if (found.name !== name || found.version !== expected.version) throw new Error("version");
        if (name === "onebots" || name === "@onebots/core") hosts.set(name, file);
        pending.push(file);
    }
    const visited = new Set<string>();
    for (const peer of plan.peerRequirements) {
        const requester = resolveManifest(root, peer.requestedBy, from);
        const resolved = resolveManifest(root, peer.packageName, requester);
        if (!semver.satisfies(manifest(resolved).version, peer.range))
            throw new Error("original peer");
        pending.push(resolved);
    }
    while (pending.length) {
        const file = pending.pop()!;
        if (visited.has(file)) continue;
        visited.add(file);
        if (visited.size > 5000) throw new Error("graph limit");
        const found = manifest(file);
        for (const [name, canonical] of hosts) {
            if (resolveManifest(root, name, file) !== canonical) throw new Error("duplicate host");
        }
        for (const [name, range] of Object.entries(found.peerDependencies ?? {})) {
            let resolved: string;
            try {
                resolved = resolveManifest(root, name, file);
            } catch (error) {
                if (
                    error instanceof MissingDependency &&
                    found.peerDependenciesMeta?.[name]?.optional
                )
                    continue;
                throw error;
            }
            if (!semver.validRange(range) || !semver.satisfies(manifest(resolved).version, range))
                throw new Error("peer");
            pending.push(resolved);
        }
        for (const name of Object.keys({ ...found.dependencies, ...found.optionalDependencies })) {
            try {
                pending.push(resolveManifest(root, name, file));
            } catch (error) {
                if (
                    error instanceof MissingDependency &&
                    Object.hasOwn(found.optionalDependencies ?? {}, name)
                )
                    continue;
                throw error;
            }
        }
    }
    const hostRoot = path.dirname(hosts.get("onebots")!);
    const gatewayEntry = inside(hostRoot, path.join(hostRoot, "lib/gateway/entry.js"));
    if (!fs.statSync(gatewayEntry).isFile()) throw new Error("gateway entry");
    const loader = await import(
        pathToFileURL(inside(hostRoot, path.join(hostRoot, "lib/plugin-loader.js"))).href
    );
    const hostEntry = loader.inspectPlugin(["onebots"], require);
    const coreEntry = loader.inspectPlugin(["@onebots/core"], require);
    if (hostEntry.status !== "ready" || coreEntry.status !== "ready") throw new Error("host entry");
    await import(pathToFileURL(inside(root, hostEntry.entryPath)).href);
    const core = await import(pathToFileURL(inside(root, coreEntry.entryPath)).href);
    for (const extension of plan.extensions) {
        const result = await loader.tryLoadRegisteredPlugin(
            extension.type,
            extension.name,
            [extension.packageName],
            require,
        );
        if (!result?.loaded) throw new Error("registration");
    }
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    const { collectRuntimeSchemas } = await import(
        new URL(`../configuration/configuration-schema-collection.${extension}`, import.meta.url)
            .href
    );
    return collectRuntimeSchemas(core, plan.selection);
}
