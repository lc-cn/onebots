import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import {
    runtimeTreeError,
    sameFile,
    scanRuntimeTree,
    within,
    type RuntimeTreeEntry,
} from "./service-migration-runtime-tree-scan.js";

export interface LegacyRuntimeRoot {
    source: string;
    excludedPaths: string[];
}

/** 在单一 fs 镜像中保留原路径关系，不复制链接目标或扫描未选择的祖先内容。 */
export async function scanLegacyRuntimeForest(
    roots: LegacyRuntimeRoot[],
): Promise<{ entries: RuntimeTreeEntry[]; files: Map<string, string> }> {
    if (!Array.isArray(roots) || roots.length === 0 || roots.length > 128) throw runtimeTreeError();
    const states = [];
    for (const root of roots) {
        if (
            !root ||
            typeof root.source !== "string" ||
            !Array.isArray(root.excludedPaths) ||
            !path.isAbsolute(root.source) ||
            root.source === path.parse(root.source).root ||
            path.normalize(root.source) !== root.source ||
            /[\u0000-\u001f\u007f\\]/u.test(root.source) ||
            (await realpath(root.source)) !== root.source ||
            roots.some(other => other !== root && within(root.source, other.source))
        )
            throw runtimeTreeError();
        const stat = await lstat(root.source);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw runtimeTreeError();
        states.push(stat);
    }
    // 同一对象重复出现也属于重叠，不能依赖对象身份做重复判断。
    if (new Set(roots.map(root => root.source)).size !== roots.length) throw runtimeTreeError();
    const virtual = (absolute: string) => `fs/${absolute.slice(1)}`;
    const included = (absolute: string) =>
        roots.some(
            root =>
                within(root.source, absolute) &&
                !root.excludedPaths.some(excluded =>
                    within(path.join(root.source, excluded), absolute),
                ),
        );
    const projectLink = (absolute: string, lexicalTarget: string, realTarget: string) => {
        if (!included(lexicalTarget) || !included(realTarget)) throw runtimeTreeError();
        return (
            path.posix.relative(path.posix.dirname(virtual(absolute)), virtual(lexicalTarget)) ||
            "."
        );
    };
    const indexed = new Map<string, RuntimeTreeEntry>([
        [".", { path: ".", type: "directory", mode: 0o700 }],
        ["fs", { path: "fs", type: "directory", mode: 0o700 }],
    ]);
    const files = new Map<string, string>();
    let total = 0;
    const add = (entry: RuntimeTreeEntry) => {
        if (entry.path.length > 4096 || indexed.has(entry.path) || indexed.size >= 100000)
            throw runtimeTreeError();
        indexed.set(entry.path, entry);
    };
    for (const root of roots) {
        const prefix = virtual(root.source);
        const ancestors: string[] = [];
        for (
            let parent = path.posix.dirname(prefix);
            parent !== ".";
            parent = path.posix.dirname(parent)
        )
            ancestors.push(parent);
        for (const parent of ancestors.reverse()) {
            if (!indexed.has(parent)) add({ path: parent, type: "directory", mode: 0o700 });
        }
        const entries = await scanRuntimeTree(root.source, false, root.excludedPaths, projectLink);
        for (const entry of entries) {
            const projected = entry.path === "." ? prefix : `${prefix}/${entry.path}`;
            if (entry.type === "file") {
                total += entry.size;
                if (total > 2 * 1024 * 1024 * 1024) throw runtimeTreeError();
                files.set(projected, path.join(root.source, entry.path));
            }
            add({ ...entry, path: projected });
        }
    }
    for (let index = 0; index < roots.length; index++) {
        if (!sameFile(states[index]!, await lstat(roots[index]!.source))) throw runtimeTreeError();
    }
    return {
        entries: [...indexed.values()].sort((a, b) =>
            a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
        ),
        files,
    };
}
