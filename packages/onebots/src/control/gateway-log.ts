import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ControlLogBatch, ControlLogSnapshot, ControlLogSource } from "@onebots/core/control";

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
    appendControlLog(workspace, "gateway", text);
}

/** Fixed-source append only; callers must provide already-redacted, bounded records. */
export function appendControlLog(workspace: string, source: ControlLogSource, text: string): void {
    if (!/^(manager|gateway|operation)$/u.test(source) || Buffer.byteLength(text) > MAX_BYTES)
        throw unavailable();
    const target = directory(workspace);
    const before = fs.lstatSync(target);
    const file = path.join(target, `${source}.log`);
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
        const bytes = Buffer.from(text);
        let offset = 0;
        while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset);
    } finally {
        fs.closeSync(fd);
    }
}

export function createControlLogWriter(workspace: string, managerId: string) {
    const manager = (event: "started" | "ready" | "stopped") => {
        try {
            appendControlLog(
                workspace,
                "manager",
                `${JSON.stringify({ time: new Date().toISOString(), event, managerId })}\n`,
            );
        } catch {
            process.stderr.write("[onebots] 管理服务日志不可写，继续保留控制能力\n");
        }
    };
    const operation = (record: {
        id: string;
        action: string;
        status: string;
        finishedAt?: string;
    }) => {
        try {
            appendControlLog(
                workspace,
                "operation",
                `${JSON.stringify({
                    time: record.finishedAt ?? new Date().toISOString(),
                    id: record.id,
                    action: record.action,
                    status: record.status,
                })}\n`,
            );
        } catch {
            process.stderr.write("[onebots] 操作日志不可写，持久化状态仍是操作事实来源\n");
        }
    };
    manager("started");
    return { manager, operation };
}
/** 固定文件、有界读取；不依赖网关在线，不提供任意路径或读取整个文件。 */
export function readGatewayLog(workspace: string): ControlLogSnapshot {
    const batch = readControlLog(workspace, "gateway");
    return {
        source: "gateway",
        text: batch.text,
        truncated: batch.truncated,
        exists: batch.exists,
    };
}

function cursor(stat: fs.Stats, offset: number): string {
    const identity = createHash("sha256")
        .update(`${stat.dev}:${stat.ino}`)
        .digest("hex")
        .slice(0, 16);
    return `${identity}.${offset}`;
}

/** Fixed file, bounded incremental read. Cursor mismatch is a visible reset, never a path fallback. */
export function readControlLog(
    workspace: string,
    source: ControlLogSource,
    priorCursor?: string,
): ControlLogBatch {
    let fd: number | undefined;
    try {
        if (!/^(manager|gateway|operation)$/u.test(source)) throw unavailable();
        const target = directory(workspace);
        const parent = fs.lstatSync(target);
        const file = path.join(target, `${source}.log`);
        let original: fs.Stats;
        try {
            original = fs.lstatSync(file);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return {
                    schemaVersion: 1,
                    source,
                    text: "",
                    cursor: "0000000000000000.0",
                    truncated: false,
                    exists: false,
                    reset: priorCursor !== undefined,
                };
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
        const currentCursor = cursor(before, before.size);
        const match = /^([a-f0-9]{16})\.([0-9]{1,16})$/u.exec(priorCursor ?? "");
        const identity = currentCursor.slice(0, 16);
        const requested = match && match[1] === identity ? Number(match[2]) : undefined;
        const reset =
            priorCursor !== undefined &&
            (requested === undefined ||
                !Number.isSafeInteger(requested) ||
                requested > before.size);
        const start =
            requested !== undefined && requested <= before.size
                ? requested
                : Math.max(0, before.size - MAX_BYTES);
        const length = Math.min(before.size - start, MAX_BYTES);
        const buffer = Buffer.alloc(length);
        const count = fs.readSync(fd, buffer, 0, length, start);
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
        if (start > 0) while (offset < count && (buffer[offset] & 0xc0) === 0x80) offset++;
        const text = buffer.subarray(offset, count).toString("utf8");
        return {
            schemaVersion: 1,
            source,
            text,
            cursor: cursor(after, start + count),
            truncated: (requested === undefined && start > 0) || before.size - start > MAX_BYTES,
            exists: true,
            reset,
        };
    } catch {
        throw unavailable();
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}
