import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import { renderInstalledManagerService } from "./manager-service-definition.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import {
    inspectWindowsServiceDirectorySecurity,
    inspectWindowsServiceFileSecurity,
} from "./windows-service-security.js";
import { serviceAncestorPaths } from "./service-path-ancestors.js";

import type {
    ManagerServiceRemovalSnapshot,
    RemovalFileSnapshot,
} from "./manager-service-removal-snapshot.js";
export interface ManagerServiceRemoval {
    readonly snapshot: Readonly<ManagerServiceRemovalSnapshot>;
    verifyRemaining(): boolean;
    /** 单文件锚点检查；升级写入定义后仍须验证尚未替换的元数据。 */
    verifyFile(file: "definition" | "metadata"): boolean;
    removeDefinition(): void;
    removeMetadata(): void;
    dispose(): void;
}
interface CapturedFile {
    file: string;
    platform: NodeJS.Platform;
    descriptor?: number;
    stat: fs.BigIntStats;
    bytes: Buffer;
    digest: string;
    removed: boolean;
    windowsAclDigest?: string;
    verifyWindowsDirectoryAcl?: () => boolean;
    verifyWindowsFileAcl?: () => boolean;
}
const failure = () => new Error("管理服务卸载文件身份不明、已变化或权限不安全");
/** @internal */
export function validRemovedAnchorLinkCount(platform: NodeJS.Platform, links: bigint): boolean {
    return platform === "win32" ? links === 0n || links === 1n : links === 0n;
}
function parents(file: string, platform: NodeJS.Platform): void {
    if (!path.isAbsolute(file) || path.normalize(file) !== file) throw failure();
    const directory = path.dirname(file);
    for (const current of serviceAncestorPaths(directory, platform)) {
        const stat = fs.lstatSync(current);
        if (platform === "win32") {
            if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure();
            continue;
        }
        const stickyAncestor =
            current !== directory && stat.uid === 0 && Boolean(stat.mode & 0o1000);
        if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            (stat.uid !== 0 && stat.uid !== process.getuid?.()) ||
            ((stat.mode & 0o022) !== 0 && !stickyAncestor)
        )
            throw failure();
    }
}
function release(file: CapturedFile): void {
    const descriptor = file.descriptor;
    file.descriptor = undefined;
    if (descriptor !== undefined) fs.closeSync(descriptor);
}
function capture(
    file: string,
    modes: readonly number[],
    platform: NodeJS.Platform,
    windowsAclDigest?: string,
    verifyWindowsDirectoryAcl?: () => boolean,
    verifyWindowsFileAcl?: () => boolean,
): CapturedFile {
    parents(file, platform);
    const descriptor = fs.openSync(
        file,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    try {
        const stat = fs.fstatSync(descriptor, { bigint: true });
        if (
            !stat.isFile() ||
            stat.nlink !== 1n ||
            (platform !== "win32" && !modes.includes(Number(stat.mode & 0o7777n))) ||
            (platform !== "win32" && stat.uid !== BigInt(process.getuid!()))
        )
            throw failure();
        const raw = new ConfigurationFile(file).readRaw();
        const captured = {
            file,
            platform,
            descriptor,
            stat,
            bytes: raw.bytes,
            digest: raw.revision,
            removed: false,
            ...(windowsAclDigest
                ? {
                      windowsAclDigest,
                      verifyWindowsDirectoryAcl,
                      verifyWindowsFileAcl,
                  }
                : {}),
        };
        if (!equal(captured)) throw failure();
        return captured;
    } catch {
        fs.closeSync(descriptor);
        throw failure();
    }
}
function equal(file: CapturedFile): boolean {
    try {
        parents(file.file, file.platform);
        if (file.descriptor === undefined) return false;
        if (file.verifyWindowsDirectoryAcl && !file.verifyWindowsDirectoryAcl()) return false;
        if (!file.removed && file.verifyWindowsFileAcl && !file.verifyWindowsFileAcl())
            return false;
        const anchor = fs.fstatSync(file.descriptor, { bigint: true });
        if (file.removed) {
            // Windows keeps the link count at one while an open, delete-sharing handle
            // anchors a file whose directory entry is already delete-pending. The path
            // must still be absent; dispose closes the handle and completes deletion.
            if (!validRemovedAnchorLinkCount(file.platform, anchor.nlink)) return false;
            try {
                fs.lstatSync(file.file);
                return false;
            } catch (error) {
                return (error as NodeJS.ErrnoException).code === "ENOENT";
            }
        }
        const current = fs.lstatSync(file.file, { bigint: true });
        if (
            !current.isFile() ||
            current.isSymbolicLink() ||
            current.nlink !== 1n ||
            anchor.nlink !== 1n ||
            current.dev !== file.stat.dev ||
            current.ino !== file.stat.ino ||
            anchor.dev !== file.stat.dev ||
            anchor.ino !== file.stat.ino ||
            current.uid !== file.stat.uid ||
            current.mode !== file.stat.mode ||
            current.size !== file.stat.size ||
            current.mtimeNs !== file.stat.mtimeNs ||
            current.ctimeNs !== file.stat.ctimeNs
        )
            return false;
        return new ConfigurationFile(file.file).readRaw().bytes.equals(file.bytes);
    } catch {
        return false;
    }
}
function snapshot(file: CapturedFile): RemovalFileSnapshot {
    const stat = file.stat;
    return Object.freeze({
        path: file.file,
        sha256: file.digest,
        dev: String(stat.dev),
        ino: String(stat.ino),
        uid: file.platform === "win32" ? 0 : Number(stat.uid),
        mode:
            file.platform === "win32"
                ? file.file.endsWith("service.json")
                    ? 0o600
                    : 0o644
                : Number(stat.mode & 0o7777n),
        size: Number(stat.size),
        ctimeNs: String(stat.ctimeNs),
        mtimeNs: String(stat.mtimeNs),
        ...(file.windowsAclDigest ? { windowsAclDigest: file.windowsAclDigest } : {}),
    });
}
/** 调用者持服务锁；捕获可在停机前，删除前须证明 OS 服务及所有工作进程静止。本端口不调用 OS、不恢复文件。 */
export function captureManagerServiceRemoval(
    input: ManagerServiceSpec,
    host: ServiceHost,
): ManagerServiceRemoval {
    const spec = parseManagerServiceSpec(input);
    if (
        !["linux", "darwin", "win32"].includes(host.platform) ||
        (host.platform === "win32"
            ? spec.scope !== "system" || host.isElevated !== true
            : spec.scope === "system" && host.uid !== 0)
    )
        throw failure();
    const files = getServiceFiles(spec.scope, host);
    const windowsDirectoryAclDigest =
        host.platform === "win32"
            ? inspectWindowsServiceDirectorySecurity(host, files.stateDir)
            : undefined;
    const captured: CapturedFile[] = [];
    try {
        for (const [file, modes] of [
            [files.definition, [0o600, 0o644]],
            [files.metadata, [0o600]],
        ] as const) {
            const fileAclDigest = windowsDirectoryAclDigest
                ? inspectWindowsServiceFileSecurity(host, file)
                : undefined;
            const aclDigest =
                windowsDirectoryAclDigest && fileAclDigest
                    ? createHash("sha256")
                          .update(`${windowsDirectoryAclDigest}:${fileAclDigest}`)
                          .digest("hex")
                    : undefined;
            const verifyWindowsDirectoryAcl = windowsDirectoryAclDigest
                ? () =>
                      inspectWindowsServiceDirectorySecurity(host, files.stateDir) ===
                      windowsDirectoryAclDigest
                : undefined;
            const verifyWindowsFileAcl = fileAclDigest
                ? () => inspectWindowsServiceFileSecurity(host, file) === fileAclDigest
                : undefined;
            captured.push(
                capture(
                    file,
                    modes,
                    host.platform,
                    aclDigest,
                    verifyWindowsDirectoryAcl,
                    verifyWindowsFileAcl,
                ),
            );
        }
        if (
            !captured[0].bytes.equals(
                Buffer.from(renderInstalledManagerService(spec, host.platform, files.stateDir)),
            )
        )
            throw failure();
        const metadata = parseManagerServiceSpec(JSON.parse(captured[1].bytes.toString("utf8")));
        if (JSON.stringify(metadata) !== JSON.stringify(spec)) throw failure();
    } catch {
        for (const file of captured) {
            try {
                release(file);
            } catch {
                /* 不重试可能已关闭的 FD；仍释放其他锚点。 */
            }
        }
        throw failure();
    }
    let disposed = false;
    let uncertain = false;
    const verifyRemaining = () => !disposed && !uncertain && captured.every(equal);
    function remove(index: number): void {
        if (!verifyRemaining() || captured[index].removed || (index === 1 && !captured[0].removed))
            throw failure();
        // 意图之后任意失败均未知，不能重复删除或自动重建。
        uncertain = true;
        try {
            fs.unlinkSync(captured[index].file);
            captured[index].removed = true;
            if (captured[index].platform !== "win32") {
                const descriptor = fs.openSync(path.dirname(captured[index].file), "r");
                try {
                    fs.fsyncSync(descriptor);
                } finally {
                    fs.closeSync(descriptor);
                }
            }
            if (!captured.every(equal)) throw failure();
            uncertain = false;
        } catch {
            throw failure();
        }
    }
    return {
        snapshot: Object.freeze({
            definition: snapshot(captured[0]),
            metadata: snapshot(captured[1]),
        }),
        verifyRemaining,
        verifyFile: file =>
            !disposed && !uncertain && equal(captured[file === "definition" ? 0 : 1]),
        removeDefinition: () => remove(0),
        removeMetadata: () => remove(1),
        dispose() {
            if (disposed) return;
            disposed = true;
            let failed = false;
            for (const file of captured) {
                try {
                    release(file);
                } catch {
                    failed = true;
                }
            }
            if (failed) throw failure();
        },
    };
}
