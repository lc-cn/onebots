import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import { renderInstalledManagerService } from "./manager-service-definition.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform } from "./service-platform.js";
import {
    inspectWindowsServiceFileSecurity,
    secureWindowsServiceFile,
} from "./windows-service-security.js";

interface Candidate {
    path: string;
    bytes: Buffer;
    mode: number;
    owned?: { descriptor: number; dev: number; ino: number };
    windowsAclDigest?: string;
    verifyWindowsAcl?: () => boolean;
}
export interface ManagerServiceInstallation {
    readonly definitionPath: string;
    readonly metadataPath: string;
    /** 调用者须先持服务锁并持久记录安装意图。只创建原本缺失的文件，不调用 OS。 */
    apply(): void;
    verify(): boolean;
    /** 关闭文件身份锚点，不删除文件；释放后不可继续使用计划。 */
    dispose(): void;
    /** 仅移除本对象创建且身份、字节、权限未变化的文件。任何未知均拒绝整次回滚。 */
    rollback(): void;
    /** 只更新启用状态，不 bootstrap/start；调用者提供受信首次安装的平台驱动。 */
    reload(platform: ServicePlatform, enabled: boolean): Promise<void>;
}
const fail = () => new Error("管理服务首次安装文件已存在、已变化或权限不安全");
function exists(file: string): boolean {
    try {
        fs.lstatSync(file);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw fail();
    }
}
function safePath(file: string): void {
    if (
        !path.isAbsolute(file) ||
        path.normalize(file) !== file ||
        /[\u0000-\u001f\u007f]/.test(file)
    )
        throw fail();
}
/** 所有已存在祖先必须是普通目录；不沿符号链接创建服务文件。 */
function parents(directory: string, create: boolean): void {
    safePath(directory);
    const parts = directory.split(path.sep).filter(Boolean);
    let current = path.parse(directory).root;
    for (const part of parts) {
        current = path.join(current, part);
        if (!exists(current)) {
            if (!create) continue;
            fs.mkdirSync(current, { mode: 0o700 });
            sync(path.dirname(current));
        }
        if (!exists(current)) continue;
        const stat = fs.lstatSync(current);
        if (process.platform === "win32") {
            if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail();
            continue;
        }
        // 系统临时根的 sticky 位只允许作为祖先，不能成为服务文件直接父目录。
        const trustedStickyRoot =
            current !== directory && stat.uid === 0 && Boolean(stat.mode & 0o1000);
        if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            (stat.uid !== 0 && process.getuid && stat.uid !== process.getuid()) ||
            ((stat.mode & 0o022) !== 0 && !trustedStickyRoot)
        )
            throw fail();
    }
}
function sync(directory: string): void {
    if (process.platform === "win32") return;
    const descriptor = fs.openSync(directory, "r");
    try {
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
}
function equal(candidate: Candidate): boolean {
    try {
        parents(path.dirname(candidate.path), false);
        if (!candidate.owned) return false;
        const anchor = fs.fstatSync(candidate.owned.descriptor);
        const stat = fs.lstatSync(candidate.path);
        if (
            !anchor.isFile() ||
            anchor.nlink !== 1 ||
            anchor.dev !== candidate.owned.dev ||
            anchor.ino !== candidate.owned.ino ||
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.nlink !== 1 ||
            stat.dev !== candidate.owned.dev ||
            stat.ino !== candidate.owned.ino ||
            (process.platform !== "win32" && (stat.mode & 0o7777) !== candidate.mode) ||
            (process.platform !== "win32" && process.getuid && stat.uid !== process.getuid())
        )
            return false;
        if (
            process.platform === "win32" &&
            (!candidate.windowsAclDigest || !candidate.verifyWindowsAcl?.())
        )
            return false;
        return new ConfigurationFile(candidate.path).readRaw().bytes.equals(candidate.bytes);
    } catch {
        return false;
    }
}
function publish(candidate: Candidate, host: ServiceHost): void {
    const directory = path.dirname(candidate.path);
    parents(directory, false);
    if (exists(candidate.path)) throw fail();
    const temporary = path.join(directory, `.onebots-install-${randomUUID()}`);
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    let anchor: number | undefined;
    try {
        try {
            fs.writeFileSync(descriptor, candidate.bytes);
            fs.fchmodSync(descriptor, candidate.mode);
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        if (process.platform === "win32") {
            candidate.windowsAclDigest = secureWindowsServiceFile(host, temporary);
            candidate.verifyWindowsAcl = () =>
                inspectWindowsServiceFileSecurity(host, candidate.path) ===
                candidate.windowsAclDigest;
        }
        // 在发布前固定仍存活的临时 inode；unlink 后 inode 也不能被外部替换复用。
        anchor = fs.openSync(temporary, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const stat = fs.fstatSync(anchor);
        const temporaryStat = fs.lstatSync(temporary);
        if (
            !stat.isFile() ||
            stat.nlink !== 1 ||
            stat.dev !== temporaryStat.dev ||
            stat.ino !== temporaryStat.ino ||
            temporaryStat.isSymbolicLink()
        )
            throw fail();
        fs.linkSync(temporary, candidate.path); // 原缺失 CAS，不覆盖竞态中新建的文件。
        candidate.owned = { descriptor: anchor, dev: stat.dev, ino: stat.ino };
        anchor = undefined; // 已发布的候选由 rollback/dispose 释放，部分失败也保留证据。
        fs.unlinkSync(temporary);
        sync(directory);
    } finally {
        if (anchor !== undefined) fs.closeSync(anchor);
        fs.rmSync(temporary, { force: true });
    }
}

/** 只读准备，不读取业务配置或依赖；既有 legacy/control/损坏元数据均必须走独立迁移流程。 */
export function prepareManagerServiceInstallation(
    input: ManagerServiceSpec,
    host: ServiceHost,
): ManagerServiceInstallation {
    const spec = parseManagerServiceSpec(input);
    if (
        !["linux", "darwin", "win32"].includes(host.platform) ||
        (host.platform === "win32"
            ? spec.scope !== "system" || host.isElevated !== true
            : spec.scope === "system" && host.uid !== 0)
    )
        throw fail();
    const files = getServiceFiles(spec.scope, host);
    for (const file of [files.definition, files.metadata]) {
        safePath(file);
        parents(path.dirname(file), false);
        if (exists(file)) throw fail();
    }
    const content = renderInstalledManagerService(spec, host.platform, files.stateDir);
    const candidates: Candidate[] = [
        { path: files.definition, bytes: Buffer.from(content), mode: 0o644 },
        {
            path: files.metadata,
            bytes: Buffer.from(JSON.stringify(spec, null, 2) + "\n"),
            mode: 0o600,
        },
    ];
    let attempted = false;
    let disposed = false;
    const verify = () => !disposed && candidates.every(equal);
    return {
        definitionPath: files.definition,
        metadataPath: files.metadata,
        apply() {
            if (disposed || attempted) throw fail();
            attempted = true;
            // 再次核验全部目标缺失，不能在已知冲突后留下第一份文件。
            if (candidates.some(candidate => exists(candidate.path))) throw fail();
            parents(files.stateDir, true);
            const state = fs.lstatSync(files.stateDir);
            if (
                process.platform !== "win32" &&
                ((state.mode & 0o077) !== 0 || (process.getuid && state.uid !== process.getuid()))
            )
                throw fail();
            parents(path.dirname(files.definition), true);
            for (const candidate of candidates) publish(candidate, host);
            if (!verify()) throw fail();
        },
        verify,
        dispose() {
            if (disposed) return;
            disposed = true;
            let failed = false;
            for (const candidate of candidates) {
                const owned = candidate.owned;
                if (!owned) continue;
                candidate.owned = undefined;
                try {
                    fs.closeSync(owned.descriptor);
                } catch {
                    // close 可能已经生效；不重试同一数字 FD，仍尝试释放其他锚点。
                    failed = true;
                }
            }
            if (failed) throw fail();
        },
        rollback() {
            if (disposed) throw fail();
            const owned = candidates.filter(candidate => candidate.owned);
            if (owned.some(candidate => !equal(candidate))) throw fail();
            // 原本没有创建的目标如果出现，属于外部写入，不能把部分回退谎报为成功。
            if (candidates.some(candidate => !candidate.owned && exists(candidate.path)))
                throw fail();
            for (const candidate of [...owned].reverse()) {
                if (!equal(candidate)) throw fail();
                fs.unlinkSync(candidate.path);
                const descriptor = candidate.owned!.descriptor;
                candidate.owned = undefined;
                fs.closeSync(descriptor);
                sync(path.dirname(candidate.path));
            }
        },
        async reload(platform, enabled) {
            if (typeof enabled !== "boolean" || !verify()) throw fail();
            await platform.reload(enabled);
            const state = await platform.inspect();
            if (
                !verify() ||
                state.definitionPath !== files.definition ||
                state.enabled !== enabled ||
                state.running ||
                state.state !== "stopped" ||
                !state.quiescent
            )
                throw fail();
        },
    };
}
