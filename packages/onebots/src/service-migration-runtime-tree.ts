import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, realpath, rename, symlink, chmod } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { closedServiceObject } from "./service-operation-storage.js";
import {
    scanRuntimeTree,
    hashRuntimeFile,
    sameFile,
    within,
    runtimeTreeError,
    type RuntimeTreeEntry,
} from "./service-migration-runtime-tree-scan.js";

export interface LegacyRuntimeTreeReceipt {
    schemaVersion: 1;
    id: string;
    root: string;
    digest: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (entries: RuntimeTreeEntry[]) =>
    createHash("sha256").update(JSON.stringify(entries)).digest("hex");
async function privateDirectory(directory: string): Promise<void> {
    const stat = await lstat(directory);
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (await realpath(directory)) !== directory ||
        (process.getuid && stat.uid !== process.getuid()) ||
        (process.platform !== "win32" && (stat.mode & 0o7777) !== 0o700)
    )
        throw runtimeTreeError();
}
async function syncDirectory(directory: string): Promise<void> {
    if (process.platform === "win32") return;
    const handle = await open(directory, constants.O_RDONLY);
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}
/** 调用方持服务锁；只捕获完整目录，不安装依赖、不触发脚本、不改变运行中的旧服务。 */
export async function captureLegacyRuntimeTree(
    sourceRoot: string,
    storeDirectory: string,
    id: string,
): Promise<LegacyRuntimeTreeReceipt> {
    try {
        if (!uuid.test(id) || !path.isAbsolute(sourceRoot) || !path.isAbsolute(storeDirectory))
            throw runtimeTreeError();
        const source = await realpath(sourceRoot);
        if ((await lstat(sourceRoot)).isSymbolicLink()) throw runtimeTreeError();
        // 先拒绝嵌套目标，不能在源目录内创建快照工件。
        if (within(source, path.resolve(storeDirectory))) throw runtimeTreeError();
        await mkdir(storeDirectory, { recursive: true, mode: 0o700 });
        const store = await realpath(storeDirectory);
        if ((await lstat(storeDirectory)).isSymbolicLink() || within(source, store))
            throw runtimeTreeError();
        await privateDirectory(store);
        const storeIdentity = await lstat(store);
        const target = path.join(store, id);
        try {
            await lstat(target);
            throw runtimeTreeError();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const entries = await scanRuntimeTree(source);
        const expectedDigest = digest(entries);
        // 失败时保留私有候选用于显式清理；绝不递归删除可能已交付或归属不明的目录。
        const staging = await mkdtemp(path.join(store, `.${id}-`));
        await chmod(staging, 0o700);
        const runtime = path.join(staging, "runtime");
        for (const entry of entries
            .filter(entry => entry.type === "directory")
            .sort((a, b) => a.path.length - b.path.length)) {
            await mkdir(path.join(runtime, entry.path), { mode: 0o700 });
        }
        for (const entry of entries) {
            const destination = path.join(runtime, entry.path);
            if (entry.type === "file") {
                const output = await open(destination, "wx", 0o600);
                try {
                    const copied = await hashRuntimeFile(
                        path.join(source, entry.path),
                        async bytes => {
                            let offset = 0;
                            while (offset < bytes.length) {
                                const { bytesWritten } = await output.write(
                                    bytes,
                                    offset,
                                    bytes.length - offset,
                                );
                                if (!bytesWritten) throw runtimeTreeError();
                                offset += bytesWritten;
                            }
                        },
                    );
                    if (
                        JSON.stringify({ path: entry.path, type: "file", ...copied }) !==
                        JSON.stringify(entry)
                    )
                        throw runtimeTreeError();
                    await output.chmod(entry.mode);
                    await output.sync();
                } finally {
                    await output.close();
                }
            } else if (entry.type === "link") await symlink(entry.target, destination);
        }
        for (const entry of entries.filter(entry => entry.type === "directory").reverse()) {
            if (entry.type !== "directory") continue;
            await chmod(path.join(runtime, entry.path), entry.mode);
            await syncDirectory(path.join(runtime, entry.path));
        }
        if (
            digest(await scanRuntimeTree(source)) !== expectedDigest ||
            digest(await scanRuntimeTree(runtime, true)) !== expectedDigest
        )
            throw runtimeTreeError();
        const manifest = await open(path.join(staging, "manifest.json"), "wx", 0o600);
        try {
            await manifest.writeFile(
                JSON.stringify({ schemaVersion: 1, id, digest: expectedDigest }),
            );
            await manifest.sync();
        } finally {
            await manifest.close();
        }
        await syncDirectory(staging);
        // 服务锁负责同ID串行；目录身份变化则不发布候选。
        const current = await lstat(store);
        if (current.dev !== storeIdentity.dev || current.ino !== storeIdentity.ino)
            throw runtimeTreeError();
        await privateDirectory(store);
        // 捕获可能耗时较长；不能覆盖期间出现的同编号目录。
        try {
            await lstat(target);
            throw runtimeTreeError();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await rename(staging, target);
        await syncDirectory(store);
        const receipt: LegacyRuntimeTreeReceipt = {
            schemaVersion: 1,
            id,
            root: path.join(target, "runtime"),
            digest: expectedDigest,
        };
        await verifyLegacyRuntimeTree(receipt);
        return receipt;
    } catch {
        throw runtimeTreeError();
    }
}
export async function verifyLegacyRuntimeTree(input: LegacyRuntimeTreeReceipt): Promise<void> {
    try {
        const receipt = closedServiceObject(input, ["schemaVersion", "id", "root", "digest"]);
        if (
            receipt.schemaVersion !== 1 ||
            typeof receipt.id !== "string" ||
            !uuid.test(receipt.id) ||
            typeof receipt.root !== "string" ||
            !path.isAbsolute(receipt.root) ||
            typeof receipt.digest !== "string" ||
            !/^[0-9a-f]{64}$/.test(receipt.digest)
        )
            throw runtimeTreeError();
        const parent = path.dirname(receipt.root);
        if (path.basename(parent) !== receipt.id || path.basename(receipt.root) !== "runtime")
            throw runtimeTreeError();
        await privateDirectory(parent);
        await privateDirectory(path.dirname(parent));
        const file = path.join(parent, "manifest.json");
        const stat = await lstat(file);
        if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.nlink !== 1 ||
            (process.getuid && stat.uid !== process.getuid()) ||
            stat.size > 1024 ||
            (process.platform !== "win32" && (stat.mode & 0o7777) !== 0o600)
        )
            throw runtimeTreeError();
        const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let value: unknown;
        try {
            if (!sameFile(stat, await handle.stat())) throw runtimeTreeError();
            value = JSON.parse(await handle.readFile("utf8"));
            if (!sameFile(stat, await handle.stat()) || !sameFile(stat, await lstat(file)))
                throw runtimeTreeError();
        } finally {
            await handle.close();
        }
        const manifest = closedServiceObject(value, ["schemaVersion", "id", "digest"]);
        if (
            manifest.schemaVersion !== 1 ||
            manifest.id !== receipt.id ||
            manifest.digest !== receipt.digest ||
            digest(await scanRuntimeTree(receipt.root, true)) !== receipt.digest
        )
            throw runtimeTreeError();
    } catch {
        throw runtimeTreeError();
    }
}
