import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

export interface ConfigurationVerificationOwner {
    schemaVersion: 1;
    id: string;
    hostname: string;
    parentPid: number;
    workerPid: number | null;
    phase: "allocated" | "spawning" | "running";
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function fail(): never {
    throw new Error("配置验证私有状态不可确认");
}
function privateDirectory(directory: string): void {
    const stat = fs.lstatSync(directory);
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())
    )
        fail();
}
function syncDirectory(directory: string): void {
    const descriptor = fs.openSync(directory, "r");
    try {
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
}
export function writeConfigurationVerificationOwner(
    directory: string,
    owner: ConfigurationVerificationOwner,
): void {
    privateDirectory(directory);
    const temporary = path.join(directory, `owner-${randomUUID()}.tmp`);
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
        fs.writeFileSync(descriptor, JSON.stringify(owner));
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, path.join(directory, "owner.json"));
    syncDirectory(directory);
}
export function allocateConfigurationVerification(root: string): {
    directory: string;
    owner: ConfigurationVerificationOwner;
} {
    if (!path.isAbsolute(root)) fail();
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    privateDirectory(root);
    const id = randomUUID();
    const directory = path.join(root, id);
    fs.mkdirSync(directory, { mode: 0o700 });
    const owner: ConfigurationVerificationOwner = {
        schemaVersion: 1,
        id,
        hostname: os.hostname(),
        parentPid: process.pid,
        workerPid: null,
        phase: "allocated",
    };
    writeConfigurationVerificationOwner(directory, owner);
    syncDirectory(root);
    return { directory, owner };
}
function validPid(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 0x7fffffff;
}
export function readConfigurationVerificationOwner(
    directory: string,
): ConfigurationVerificationOwner {
    privateDirectory(directory);
    const filename = path.join(directory, "owner.json");
    const stat = fs.lstatSync(filename);
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > 4096 ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())
    )
        fail();
    const owner = JSON.parse(fs.readFileSync(filename, "utf8")) as ConfigurationVerificationOwner;
    if (
        owner.schemaVersion !== 1 ||
        !UUID.test(owner.id) ||
        path.basename(directory) !== owner.id ||
        owner.hostname !== os.hostname() ||
        !validPid(owner.parentPid) ||
        !["allocated", "spawning", "running"].includes(owner.phase) ||
        (owner.workerPid !== null && !validPid(owner.workerPid)) ||
        (owner.phase === "running" ? owner.workerPid === null : owner.workerPid !== null)
    )
        fail();
    return owner;
}
function absent(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return false;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
}
/** 调用方须持管理服务工作区独占锁；不杀任何历史 PID。PID 重用、未知阶段均保守阻断。 */
export function recoverConfigurationVerifications(root: string): {
    removed: string[];
    blocked: string[];
} {
    const result: { removed: string[]; blocked: string[] } = { removed: [], blocked: [] };
    if (process.platform === "win32" || !path.isAbsolute(root)) fail();
    try {
        privateDirectory(root);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
        throw new Error("配置验证私有状态不可确认");
    }
    for (const id of fs.readdirSync(root)) {
        try {
            if (!UUID.test(id)) fail();
            const directory = path.join(root, id);
            const owner = readConfigurationVerificationOwner(directory);
            if (
                !absent(owner.parentPid) ||
                owner.phase === "spawning" ||
                (owner.workerPid !== null &&
                    (!absent(owner.workerPid) || !absent(-owner.workerPid)))
            )
                fail();
            fs.rmSync(directory, { recursive: true });
            syncDirectory(root);
            result.removed.push(id);
        } catch {
            result.blocked.push(id);
        }
    }
    return result;
}
