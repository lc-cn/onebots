import fs from "node:fs";
import path from "node:path";
import type { ControlLogSnapshot } from "@onebots/core/control";

const MAX_BYTES = 64 * 1024;
const unavailable = () => new Error("网关日志不可读取，请检查工作区权限");
function directory(workspace: string): string {
    const root = fs.realpathSync(workspace);
    const target = path.join(root, ".control");
    const stat = fs.lstatSync(target);
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        fs.realpathSync(target) !== target ||
        (process.getuid && stat.uid !== process.getuid()) ||
        (process.platform !== "win32" && (stat.mode & 0o7777) !== 0o700)
    )
        throw unavailable();
    return target;
}
function regular(stat: fs.Stats): void {
    if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        (process.getuid && stat.uid !== process.getuid()) ||
        (process.platform !== "win32" && (stat.mode & 0o7777) !== 0o600)
    )
        throw unavailable();
}
/** 写入与读取共用权限边界，绝不跟随预置链接或修正外部文件权限。 */
export function openGatewayLog(workspace: string): { fd: number; close(): void } {
    const target = directory(workspace);
    const file = path.join(target, "gateway.log");
    const before = fs.lstatSync(target);
    const fd = fs.openSync(
        file,
        fs.constants.O_WRONLY |
            fs.constants.O_APPEND |
            fs.constants.O_CREAT |
            (fs.constants.O_NOFOLLOW ?? 0) |
            (fs.constants.O_NONBLOCK ?? 0),
        0o600,
    );
    try {
        const opened = fs.fstatSync(fd);
        regular(opened);
        const current = fs.lstatSync(file);
        const parent = fs.lstatSync(target);
        if (
            current.isSymbolicLink() ||
            opened.dev !== current.dev ||
            opened.ino !== current.ino ||
            parent.dev !== before.dev ||
            parent.ino !== before.ino ||
            directory(workspace) !== target
        )
            throw unavailable();
        return { fd, close: () => fs.closeSync(fd) };
    } catch {
        fs.closeSync(fd);
        throw unavailable();
    }
}
export function appendGatewayLog(workspace: string, text: string): void {
    const log = openGatewayLog(workspace);
    try {
        fs.writeSync(log.fd, text);
    } finally {
        log.close();
    }
}
/** 固定文件、有界读取；不依赖网关在线，不提供任意路径或读取整个文件。 */
export function readGatewayLog(workspace: string): ControlLogSnapshot {
    let fd: number | undefined;
    try {
        const target = directory(workspace);
        const parent = fs.lstatSync(target);
        const file = path.join(target, "gateway.log");
        let original: fs.Stats;
        try {
            original = fs.lstatSync(file);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return { source: "gateway", text: "", truncated: false, exists: false };
            throw error;
        }
        if (original.isSymbolicLink()) throw unavailable();
        regular(original);
        fd = fs.openSync(
            file,
            fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0),
        );
        const before = fs.fstatSync(fd);
        regular(before);
        if (before.dev !== original.dev || before.ino !== original.ino) throw unavailable();
        const length = Math.min(before.size, MAX_BYTES);
        const buffer = Buffer.alloc(length);
        const count = fs.readSync(fd, buffer, 0, length, Math.max(0, before.size - length));
        const after = fs.fstatSync(fd);
        const current = fs.lstatSync(file);
        const currentParent = fs.lstatSync(target);
        regular(after);
        if (
            current.isSymbolicLink() ||
            current.dev !== before.dev ||
            current.ino !== before.ino ||
            currentParent.dev !== parent.dev ||
            currentParent.ino !== parent.ino ||
            directory(workspace) !== target ||
            after.size < before.size ||
            count !== length
        )
            throw unavailable();
        // 截断时跳过UTF-8续字节，避免从多字节字符中间开始。非法日志字节显示为替换字符。
        let offset = 0;
        if (before.size > length)
            while (offset < count && (buffer[offset] & 0xc0) === 0x80) offset++;
        const text = buffer.subarray(offset, count).toString("utf8");
        return { source: "gateway", text, truncated: before.size > length, exists: true };
    } catch {
        throw unavailable();
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}
