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

async function verify(directory: string, plan: GenerationPlan): Promise<string> {
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
    // Overrides and changed package metadata never erase the original accepted peer contract.
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
    // Core 仅提供 import 条件导出，不能用 require.resolve 的 require 条件加载。
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
    const adapters: Record<string, unknown> = {};
    const protocols: Record<string, unknown> = {};
    const applications: Record<string, unknown> = {};
    for (const name of plan.selection.adapters) {
        if (!core.AdapterRegistry.has(name)) throw new Error("adapter");
        const schema = core.AdapterRegistry.getSchema(name);
        if (!schema) throw new Error("schema");
        adapters[name] = schema;
    }
    for (const name of plan.selection.protocols) {
        const match = /^(.*)-(v\d+)$/.exec(name);
        if (!match || !core.ProtocolRegistry.has(match[1], match[2])) throw new Error("protocol");
        const schema = core.ProtocolRegistry.getSchema(`${match[1]}.${match[2]}`);
        if (!schema) throw new Error("schema");
        protocols[name] = schema;
    }
    for (const name of plan.selection.applications) {
        if (!core.ApplicationRegistry.has(name)) throw new Error("application");
        const application = core.ApplicationRegistry.get(name);
        applications[name] = { name, displayName: application.displayName };
    }
    const runtimeOnly: string[] = [];
    const converted = serialize({ adapters, protocols, applications }, "$", runtimeOnly, new Set());
    const schemas = JSON.stringify({ schemaVersion: 1, ...(converted as object), runtimeOnly });
    if (Buffer.byteLength(schemas) > 1024 * 1024) throw new Error("schema size");
    return schemas;
}

function serialize(
    value: unknown,
    location: string,
    runtimeOnly: string[],
    ancestors: Set<object>,
): unknown {
    if (typeof value === "function" || value === undefined) {
        runtimeOnly.push(location);
        return undefined;
    }
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value instanceof RegExp) return { source: value.source, flags: value.flags };
    if (!value || typeof value !== "object" || ancestors.has(value) || ancestors.size > 50)
        throw new Error("schema serialization");
    ancestors.add(value);
    try {
        if (Array.isArray(value))
            return value.map((item, index) =>
                serialize(item, `${location}[${index}]`, runtimeOnly, ancestors),
            );
        if (
            Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null
        )
            throw new Error("schema object");
        const result: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            const converted = serialize(item, `${location}.${key}`, runtimeOnly, ancestors);
            if (converted !== undefined)
                Object.defineProperty(result, key, { value: converted, enumerable: true });
        }
        return result;
    } finally {
        ancestors.delete(value);
    }
}

if (!process.send) process.exit(1);
process.once("message", async (value: { directory: string; plan: GenerationPlan }) => {
    try {
        const schemas = await verify(value.directory, value.plan);
        process.send?.({ schemas }, () => process.exit(0));
    } catch {
        // 不输出第三方异常、包管理器内容或继承控制面凭据。
        process.send?.({ failed: true }, () => process.exit(1));
    }
});
function stopDetachedVerification(): void {
    // The parent forks this private worker as its own POSIX group leader.
    if (process.platform !== "win32" && process.env.ONEBOTS_VERIFY_PROCESS_GROUP === "1") {
        try {
            process.kill(-process.pid, "SIGKILL");
        } catch {
            /* If the group is already absent, exit this worker normally. */
        }
    }
    process.exit(1);
}
process.once("disconnect", stopDetachedVerification);
process.once("SIGTERM", stopDetachedVerification);
