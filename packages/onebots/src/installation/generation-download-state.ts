import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { waitForProcessGroupExit } from "../process-group-exit.js";
import { GenerationDownloadError } from "./generation-download-types.js";

export interface DownloadOwner {
    schemaVersion: 1;
    id: string;
    hostname: string;
    parentPid: number;
    workerPid: number | null;
    downloaderPid: number | null;
    phase: "allocated" | "idle" | "spawning" | "downloading";
}

export interface DownloadCredentialRecovery {
    removed: string[];
    blocked: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RECOVERY_GROUP_EXIT_TIMEOUT_MS = 10_000;
const validPid = (value: unknown): value is number =>
    Number.isInteger(value) && Number(value) > 0 && Number(value) <= 0x7fffffff;

async function privateDirectory(directory: string): Promise<void> {
    const stat = await lstat(directory);
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))
    ) {
        throw new GenerationDownloadError("CLEANUP_FAILED");
    }
}

export async function allocateDownloadCredentials(
    root: string,
): Promise<{ directory: string; owner: DownloadOwner }> {
    if (!path.isAbsolute(root)) throw new GenerationDownloadError("INVALID_INPUT");
    await mkdir(root, { recursive: true, mode: 0o700 });
    await privateDirectory(root);
    const id = randomUUID();
    const directory = path.join(root, id);
    await mkdir(directory, { mode: 0o700 });
    const owner: DownloadOwner = {
        schemaVersion: 1,
        id,
        hostname: os.hostname(),
        parentPid: process.pid,
        workerPid: null,
        downloaderPid: null,
        phase: "allocated",
    };
    await writeOwner(directory, owner);
    return { directory, owner };
}

async function writeOwner(directory: string, owner: DownloadOwner): Promise<void> {
    const temporary = path.join(directory, `owner-${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try {
        await file.writeFile(JSON.stringify(owner));
        await file.sync();
    } finally {
        await file.close();
    }
    await rename(temporary, path.join(directory, "owner.json"));
    if (process.platform !== "win32") {
        const parent = await open(directory, "r");
        try {
            await parent.sync();
        } finally {
            await parent.close();
        }
    }
}

export async function readDownloadOwner(directory: string): Promise<DownloadOwner> {
    await privateDirectory(directory);
    const filename = path.join(directory, "owner.json");
    const stat = await lstat(filename);
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > 4096 ||
        (process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))
    )
        throw new GenerationDownloadError("CLEANUP_FAILED");
    const owner = JSON.parse(await readFile(filename, "utf8")) as DownloadOwner;
    if (
        owner.schemaVersion !== 1 ||
        !UUID.test(owner.id) ||
        path.basename(directory) !== owner.id ||
        owner.hostname !== os.hostname() ||
        !validPid(owner.parentPid) ||
        (owner.workerPid !== null && !validPid(owner.workerPid)) ||
        (owner.downloaderPid !== null && !validPid(owner.downloaderPid)) ||
        !["allocated", "idle", "spawning", "downloading"].includes(owner.phase)
    )
        throw new GenerationDownloadError("CLEANUP_FAILED");
    return owner;
}

export async function updateDownloadOwner(
    directory: string,
    owner: DownloadOwner,
    update: Partial<Pick<DownloadOwner, "workerPid" | "downloaderPid" | "phase">>,
): Promise<void> {
    const current = await readDownloadOwner(directory);
    if (current.id !== owner.id || current.parentPid !== owner.parentPid)
        throw new GenerationDownloadError("CLEANUP_FAILED");
    const next = { ...current, ...update };
    await writeOwner(directory, next);
    Object.assign(owner, next);
}

function absent(pid: number, group = false): boolean {
    try {
        process.kill(group && process.platform !== "win32" ? -pid : pid, 0);
        return false;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
}

/** 当前所有者也只能清理已确认没有下载进程的目录；冷恢复绝不按旧 PID 杀进程。 */
export async function cleanupDownloadCredentials(
    directory: string,
    ownerId: string,
    activeWorker = false,
): Promise<void> {
    const owner = await readDownloadOwner(directory);
    if (owner.id !== ownerId) throw new GenerationDownloadError("CLEANUP_FAILED");
    const isOwnWorker = activeWorker && owner.workerPid === process.pid;
    if (
        owner.phase === "spawning" ||
        (owner.downloaderPid !== null && !absent(owner.downloaderPid, true)) ||
        (!isOwnWorker && owner.workerPid !== null && !absent(owner.workerPid)) ||
        (!isOwnWorker && owner.parentPid !== process.pid && !absent(owner.parentPid))
    ) {
        throw new GenerationDownloadError("CLEANUP_FAILED");
    }
    await rm(directory, { recursive: true });
}

/** 必须在控制服务工作区独占锁内执行。存活、PID重用、不同主机和损坏状态均保守阻断。 */
export async function recoverDownloadCredentials(
    root: string,
): Promise<DownloadCredentialRecovery> {
    const result: DownloadCredentialRecovery = { removed: [], blocked: [] };
    try {
        await privateDirectory(root);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
        throw new GenerationDownloadError("CLEANUP_FAILED");
    }
    for (const id of await readdir(root)) {
        const directory = path.join(root, id);
        try {
            if (!UUID.test(id)) throw new Error();
            const owner = await readDownloadOwner(directory);
            if (!absent(owner.parentPid)) throw new Error();
            // 组长可先于最后一个组成员消失；仅在这个退出过渡态有界等待组级 ESRCH。
            if (
                process.platform !== "win32" &&
                owner.downloaderPid !== null &&
                absent(owner.downloaderPid) &&
                !absent(owner.downloaderPid, true) &&
                (await waitForProcessGroupExit(
                    owner.downloaderPid,
                    RECOVERY_GROUP_EXIT_TIMEOUT_MS,
                )) !== "exited"
            )
                throw new Error();
            await cleanupDownloadCredentials(directory, id);
            result.removed.push(id);
        } catch (error) {
            result.blocked.push(id);
        }
    }
    return result;
}
