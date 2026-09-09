import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export type RuntimeTreeEntry =
    | { path: string; type: "directory"; mode: number }
    | { path: string; type: "file"; mode: number; size: number; sha256: string }
    | { path: string; type: "link"; target: string };
export const runtimeTreeError = () =>
    new Error("旧运行目录快照不可验证，请保留原安装并检查目录与依赖边界");
export function within(root: string, file: string): boolean {
    const relative = path.relative(root, file);
    return (
        relative === "" ||
        (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    );
}
export function sameFile(before: Stats, after: Stats): boolean {
    return (
        before.dev === after.dev &&
        before.ino === after.ino &&
        before.mode === after.mode &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs
    );
}
function safeMode(stat: Stats): number {
    if ((stat.mode & 0o7022) !== 0) throw runtimeTreeError();
    return stat.mode & 0o777;
}
/** 有界、无链接跟随的读取；复制硬链接时只采用当前内容，不沿用共享inode。 */
export async function hashRuntimeFile(
    file: string,
    chunk?: (buffer: Buffer) => Promise<void>,
): Promise<{ size: number; sha256: string; mode: number }> {
    const original = await lstat(file);
    if (!original.isFile() || original.isSymbolicLink() || original.size > 512 * 1024 * 1024)
        throw runtimeTreeError();
    const mode = safeMode(original);
    const handle = await open(
        file,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
        if (!sameFile(original, await handle.stat())) throw runtimeTreeError();
        const hash = createHash("sha256");
        const buffer = Buffer.alloc(64 * 1024);
        let total = 0;
        while (total < original.size) {
            const { bytesRead } = await handle.read(
                buffer,
                0,
                Math.min(buffer.length, original.size - total),
                total,
            );
            if (!bytesRead) throw runtimeTreeError();
            const part = buffer.subarray(0, bytesRead);
            hash.update(part);
            if (chunk) await chunk(part);
            total += bytesRead;
        }
        if (!sameFile(original, await handle.stat()) || !sameFile(original, await lstat(file)))
            throw runtimeTreeError();
        return { mode, size: total, sha256: hash.digest("hex") };
    } finally {
        await handle.close();
    }
}
/** 不遍历链接目标；目标必须完整位于同一棵物理树内。 */
export async function scanRuntimeTree(
    root: string,
    snapshot = false,
    excludedPaths: string[] = [],
): Promise<RuntimeTreeEntry[]> {
    const excluded = new Set(excludedPaths);
    if (
        (snapshot && excluded.size) ||
        excluded.size !== excludedPaths.length ||
        [...excluded].some(
            item =>
                !item ||
                item === "." ||
                item === ".." ||
                item.startsWith("../") ||
                path.isAbsolute(item) ||
                path.posix.normalize(item) !== item ||
                /[\u0000-\u001f\u007f\\]/u.test(item),
        )
    )
        throw runtimeTreeError();
    const original = await lstat(root);
    if (!original.isDirectory() || original.isSymbolicLink() || (await realpath(root)) !== root)
        throw runtimeTreeError();
    const entries: RuntimeTreeEntry[] = [];
    let total = 0;
    const visit = async (relative: string): Promise<void> => {
        if (excluded.has(relative)) return;
        if (entries.length >= 100000 || relative.length > 4096) throw runtimeTreeError();
        const absolute = relative === "." ? root : path.join(root, relative);
        const stat = await lstat(absolute);
        if (stat.isSymbolicLink()) {
            const raw = await readlink(absolute);
            const resolved = path.resolve(path.dirname(absolute), raw);
            if (!within(root, resolved) || !within(root, await realpath(absolute)))
                throw runtimeTreeError();
            const target =
                path.relative(path.dirname(absolute), resolved).split(path.sep).join("/") || ".";
            if (snapshot && raw !== target) throw runtimeTreeError();
            if (!sameFile(stat, await lstat(absolute)) || raw !== (await readlink(absolute)))
                throw runtimeTreeError();
            entries.push({ path: relative, type: "link", target });
        } else if (stat.isDirectory()) {
            entries.push({ path: relative, type: "directory", mode: safeMode(stat) });
            const names = (await readdir(absolute)).sort();
            for (const name of names) {
                if (/[\u0000-\u001f\u007f\\]/u.test(name) || name === "." || name === "..")
                    throw runtimeTreeError();
                await visit(relative === "." ? name : `${relative}/${name}`);
            }
            if (!sameFile(stat, await lstat(absolute))) throw runtimeTreeError();
        } else if (stat.isFile()) {
            total += stat.size;
            if (total > 2 * 1024 * 1024 * 1024 || (snapshot && stat.nlink !== 1))
                throw runtimeTreeError();
            entries.push({ path: relative, type: "file", ...(await hashRuntimeFile(absolute)) });
        } else throw runtimeTreeError();
    };
    await visit(".");
    if (!sameFile(original, await lstat(root))) throw runtimeTreeError();
    return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
