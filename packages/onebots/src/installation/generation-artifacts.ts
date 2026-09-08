import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
    chmod,
    lstat,
    mkdir,
    open,
    realpath,
    rename,
    unlink,
    type FileHandle,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { GenerationArtifact } from "./generation-plan.js";
import type { GenerationResolverConfig } from "./generation-resolver.js";

const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const pending = new Map<string, Promise<string>>();

/**
 * Called under the control workspace's lifetime lock, before resolving any user plan.
 * Pins the bytes consumed by pnpm, not just a hash checked on a mutable source pathname.
 * This private file store is not an isolation boundary against malicious same-user code.
 */
export async function freezeGenerationArtifacts(
    config: GenerationResolverConfig,
    directory: string,
): Promise<GenerationResolverConfig> {
    try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const directoryStat = await lstat(directory);
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
            throw new ArtifactFreezeError("工件快照目录必须是私有常规目录");
        const root = await realpath(directory);
        await chmod(root, 0o700);
        const freeze = async (artifact: GenerationArtifact): Promise<GenerationArtifact> => {
            if (!artifact.spec.startsWith("file:")) return { ...artifact };
            const source = artifact.spec.slice(5);
            if (
                !isAbsolute(source) ||
                !source.endsWith(".tgz") ||
                /[\r\n\0?#]/.test(source) ||
                typeof artifact.sha256 !== "string" ||
                !/^[a-f0-9]{64}$/.test(artifact.sha256)
            )
                throw new ArtifactFreezeError("本地工件必须提供绝对 tgz 路径和 sha256");
            const target = join(root, `${artifact.sha256}.tgz`);
            let work = pending.get(target);
            if (!work) {
                work = freezeOne(source, target, root, artifact.sha256);
                pending.set(target, work);
            }
            try {
                return { ...artifact, spec: `file:${await work}` };
            } finally {
                if (pending.get(target) === work) pending.delete(target);
            }
        };
        const host = await freeze(config.host);
        const core = await freeze(config.core);
        const artifacts: Record<string, GenerationArtifact> | undefined = config.artifacts
            ? {}
            : undefined;
        if (artifacts) {
            for (const [name, artifact] of Object.entries(config.artifacts!))
                artifacts[name] = await freeze(artifact);
        }
        return { ...config, host, core, ...(artifacts ? { artifacts } : {}) };
    } catch (error) {
        if (error instanceof ArtifactFreezeError) throw error;
        // fs errors include local paths; keep diagnostics crossing the control API path-free.
        throw new ArtifactFreezeError("本地工件快照无法读取或写入，请检查私有存储权限");
    }
}

async function freezeOne(
    source: string,
    target: string,
    root: string,
    expected: string,
): Promise<string> {
    if (await verifyCached(target, expected)) return target;
    const temporary = join(root, `.${expected}.${randomUUID()}.tmp`);
    try {
        if ((await lstat(source)).isSymbolicLink())
            throw new ArtifactFreezeError("源工件不能是符号链接");
        const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
            await checkFile(input);
            const output = await open(temporary, "wx+", 0o600);
            try {
                const buffer = Buffer.allocUnsafe(64 * 1024);
                let position = 0;
                while (true) {
                    const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
                    if (!bytesRead) break;
                    position += bytesRead;
                    if (position > MAX_ARTIFACT_BYTES)
                        throw new ArtifactFreezeError("本地工件超过大小限制");
                    await output.writeFile(buffer.subarray(0, bytesRead));
                }
                // Hash the actual copied bytes, not a source check performed before pnpm reads it.
                if ((await fileDigest(output)) !== expected)
                    throw new ArtifactFreezeError("本地工件内容与声明摘要不一致");
                await output.chmod(0o400);
                await output.sync();
            } finally {
                await output.close();
            }
        } finally {
            await input.close();
        }
        // Calls in this process coalesce per digest; the host excludes another workspace writer.
        if (!(await verifyCached(target, expected))) await rename(temporary, target);
        if (process.platform !== "win32") {
            const folder = await open(root, "r");
            try {
                await folder.sync();
            } finally {
                await folder.close();
            }
        }
        return target;
    } finally {
        await unlink(temporary).catch(error => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
    }
}

async function verifyCached(target: string, expected: string): Promise<boolean> {
    let file: FileHandle;
    try {
        file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
    try {
        await checkFile(file);
        if ((await lstat(target)).isSymbolicLink())
            throw new ArtifactFreezeError("工件快照不能是符号链接");
        if ((await fileDigest(file)) !== expected)
            throw new ArtifactFreezeError("已有工件快照摘要不一致，禁止覆盖或使用");
        await file.chmod(0o400);
        await file.sync();
        return true;
    } finally {
        await file.close();
    }
}

async function checkFile(file: FileHandle): Promise<void> {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_ARTIFACT_BYTES)
        throw new ArtifactFreezeError("本地工件必须是独立常规文件且大小未超限");
}

async function fileDigest(file: FileHandle): Promise<string> {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (true) {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        position += bytesRead;
        if (position > MAX_ARTIFACT_BYTES) throw new ArtifactFreezeError("本地工件超过大小限制");
        hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
}

class ArtifactFreezeError extends Error {}
