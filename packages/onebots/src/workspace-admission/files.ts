import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ConfigurationFile } from "../configuration/configuration-file.js";
import { acquireWindowsWorkspaceIdentity } from "../windows-workspace-identity.js";
import { inspectWindowsPrivateFile, replaceWindowsPrivateFile } from "../windows-private-file.js";
import type { PhysicalIdentity } from "./types.js";

export const digest = (bytes: string | Uint8Array): string =>
    createHash("sha256").update(bytes).digest("hex");

/** 同为FUSE magic的本地virtiofs与对象存储fuse.*不能混为一个provider。 */
export function isLocalVirtiofsMount(directory: string, mountinfo: string): boolean {
    let longest = -1;
    const matches = new Set<string>();
    for (const line of mountinfo.split("\n")) {
        if (!line) continue;
        const separator = line.indexOf(" - ");
        if (separator < 0) return false;
        const fields = line.slice(0, separator).split(" ");
        if (fields.length < 6) return false;
        const mount = fields[4].replace(/\\(040|011|012|134)/g, (_match, octal: string) =>
            String.fromCharCode(Number.parseInt(octal, 8)),
        );
        if (!(directory === mount || directory.startsWith(mount === "/" ? "/" : mount + "/")))
            continue;
        const type = line.slice(separator + 3).split(" ")[0];
        if (mount.length > longest) {
            longest = mount.length;
            matches.clear();
        }
        if (mount.length === longest) matches.add(type);
    }
    // 叠加挂载或未知格式不猜测；只接受kernel明确报告的本地virtiofs。
    return matches.size === 1 && matches.has("virtiofs");
}

export function exists(filename: string): boolean {
    try {
        fs.lstatSync(filename);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}

/** 所有者可信的本地目录；返回的句柄在 lease 结束前保持对象存活。 */
export function openPhysicalDirectory(directory: string, privateDirectory = true) {
    if (process.platform === "win32") {
        const value = acquireWindowsWorkspaceIdentity(directory);
        return {
            identity: {
                provider: "windows",
                volume: value.volumeSerial,
                object: value.fileId,
            } as PhysicalIdentity,
            close: value.close,
        };
    }
    const descriptor = fs.openSync(
        directory,
        fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
    );
    try {
        const stat = fs.fstatSync(descriptor, { bigint: true });
        const current = fs.lstatSync(directory, { bigint: true });
        if (
            !stat.isDirectory() ||
            current.isSymbolicLink() ||
            current.dev !== stat.dev ||
            current.ino !== stat.ino ||
            (process.getuid && stat.uid !== BigInt(process.getuid())) ||
            (privateDirectory && (stat.mode & 0o077n) !== 0n)
        )
            throw new Error("来源目录权限或对象身份无效");
        const storage = fs.statfsSync(directory, { bigint: true });
        if ([0x6969n, 0xff534d42n, 0xfe534d42n].includes(storage.type))
            throw Object.assign(new Error("来源证明不支持网络共享文件系统"), { code: "ENOTSUP" });
        if (
            storage.type === 0x65735546n &&
            !(
                process.platform === "linux" &&
                isLocalVirtiofsMount(directory, fs.readFileSync("/proc/self/mountinfo", "utf8"))
            )
        )
            throw Object.assign(new Error("来源证明尚未验收此 FUSE/对象存储 provider"), {
                code: "ENOTSUP",
            });
        let closed = false;
        return {
            identity: {
                provider: "posix",
                volume: stat.dev.toString(),
                object: stat.ino.toString(),
            } as PhysicalIdentity,
            close() {
                if (!closed) {
                    closed = true;
                    fs.closeSync(descriptor);
                }
            },
        };
    } catch (error) {
        fs.closeSync(descriptor);
        throw error;
    }
}

export function physicalIdentity(directory: string, privateDirectory = true): PhysicalIdentity {
    const opened = openPhysicalDirectory(directory, privateDirectory);
    try {
        return opened.identity;
    } finally {
        opened.close();
    }
}
export function sameIdentity(left: PhysicalIdentity, right: PhysicalIdentity): boolean {
    return (
        left.provider === right.provider &&
        left.volume === right.volume &&
        left.object === right.object
    );
}
export function readPrivate(filename: string): { bytes: Buffer; revision: string } | null {
    if (!exists(filename)) return null;
    const stat = fs.lstatSync(filename);
    if (process.platform === "win32") inspectWindowsPrivateFile(filename);
    else if ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid()))
        throw new Error("来源文件权限无效");
    return new ConfigurationFile(filename).readRaw();
}
export function fileDigest(filename: string): string | null {
    return readPrivate(filename)?.revision ?? null;
}
export function syncDirectory(directory: string): void {
    if (process.platform === "win32") throw new Error("Windows 来源写入须使用原生持久化替换");
    const descriptor = fs.openSync(directory, "r");
    try {
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
}

/** 持工作区/身份锁；只接受确认旧状态或同一固定目标，不恢复旧字节。 */
export function applyPrivateTarget(
    filename: string,
    previousDigest: string | null,
    target: string,
): void {
    const wanted = digest(target);
    const current = fileDigest(filename);
    if (current === wanted && process.platform !== "win32") {
        syncDirectory(path.dirname(filename));
        return;
    }
    if (process.platform === "win32") {
        if (current !== wanted && current !== previousDigest) throw new Error("来源登记目标已变化");
        replaceWindowsPrivateFile({
            directory: path.dirname(filename),
            fileName: path.basename(filename),
            expectedDigest: current,
            bytes: Buffer.from(target),
        });
        return;
    }
    if (current !== previousDigest) throw new Error("来源登记目标已变化，结果未知，保留现场");
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
        const descriptor = fs.openSync(temporary, "wx", 0o600);
        try {
            fs.writeFileSync(descriptor, target);
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        if (fileDigest(filename) !== previousDigest) throw new Error("来源登记目标已变化");
        if (previousDigest === null) {
            fs.linkSync(temporary, filename);
            fs.unlinkSync(temporary);
        } else fs.renameSync(temporary, filename);
        syncDirectory(path.dirname(filename));
        if (fileDigest(filename) !== wanted) throw new Error("来源登记写入未确认");
    } finally {
        if (exists(temporary)) fs.unlinkSync(temporary);
    }
}

export function separatedPaths(workspace: string, authority: string): void {
    const canonical = (value: string): string => {
        if (exists(value)) return fs.realpathSync(value);
        return path.join(canonical(path.dirname(value)), path.basename(value));
    };
    const root = canonical(path.resolve(workspace));
    const outside = canonical(path.resolve(authority));
    if (
        root === outside ||
        root.startsWith(outside + path.sep) ||
        outside.startsWith(root + path.sep)
    )
        throw new Error("authority 必须在工作区之外，且两者不能互为祖先");
}
