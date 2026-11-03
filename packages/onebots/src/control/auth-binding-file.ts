import * as fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { inspectWindowsPrivateFile, replaceWindowsPrivateFile } from "../windows-private-file.js";

const FAILURE = "控制认证状态无法确认";
const LIMIT = 16384;

export function authenticationDigest(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

export function authenticationBytes(state: unknown): Buffer {
    const bytes = Buffer.from(JSON.stringify(state) + "\n");
    if (bytes.length > LIMIT) throw new Error(FAILURE);
    return bytes;
}

/** 缺失仅来自首次 lstat；打开/读取过程中的消失是未知，不能当成空状态。 */
export function readAuthenticationSnapshot(file: string): { bytes: Buffer; digest: string } | null {
    let initial: fs.Stats;
    try {
        initial = fs.lstatSync(file);
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
        throw new Error(FAILURE);
    }
    let descriptor: number | undefined;
    try {
        if (
            !initial.isFile() ||
            initial.isSymbolicLink() ||
            initial.nlink !== 1 ||
            initial.size > LIMIT
        )
            throw new Error(FAILURE);
        if (process.platform === "win32") inspectWindowsPrivateFile(file);
        else if ((initial.mode & 0o077) !== 0 || initial.uid !== process.getuid?.())
            throw new Error(FAILURE);
        descriptor = fs.openSync(
            file,
            fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0),
        );
        const before = fs.fstatSync(descriptor);
        if (
            before.dev !== initial.dev ||
            before.ino !== initial.ino ||
            !before.isFile() ||
            before.nlink !== 1
        )
            throw new Error(FAILURE);
        const buffer = Buffer.alloc(LIMIT + 1);
        let total = 0;
        while (total < buffer.length) {
            const count = fs.readSync(descriptor, buffer, total, buffer.length - total, null);
            if (!count) break;
            total += count;
        }
        const after = fs.fstatSync(descriptor);
        const current = fs.lstatSync(file);
        if (
            total > LIMIT ||
            total !== after.size ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            before.ctimeMs !== after.ctimeMs ||
            after.nlink !== 1 ||
            current.isSymbolicLink() ||
            current.dev !== after.dev ||
            current.ino !== after.ino
        )
            throw new Error(FAILURE);
        const bytes = Buffer.from(buffer.subarray(0, total));
        return { bytes, digest: authenticationDigest(bytes) };
    } catch {
        throw new Error(FAILURE);
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
    }
}

/** 调用方持工作区与来源运行锁；CAS 不承诺隔离同用户恶意写入。 */
export function replaceAuthenticationState(
    file: string,
    previousDigest: string | null,
    state: unknown,
): void {
    const bytes = authenticationBytes(state);
    const directory = path.dirname(file);
    if (process.platform === "win32") {
        replaceWindowsPrivateFile({
            directory,
            fileName: path.basename(file),
            expectedDigest: previousDigest,
            bytes,
        });
        return;
    }
    const stat = fs.lstatSync(directory);
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o077) !== 0 ||
        stat.uid !== process.getuid?.()
    )
        throw new Error(FAILURE);
    const temporary = `${file}.${randomBytes(12).toString("hex")}.tmp`;
    let descriptor: number | undefined;
    try {
        if ((readAuthenticationSnapshot(file)?.digest ?? null) !== previousDigest)
            throw new Error(FAILURE);
        descriptor = fs.openSync(temporary, "wx", 0o600);
        fs.writeFileSync(descriptor, bytes);
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        if ((readAuthenticationSnapshot(file)?.digest ?? null) !== previousDigest)
            throw new Error(FAILURE);
        fs.renameSync(temporary, file);
        descriptor = fs.openSync(directory, "r");
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        if (readAuthenticationSnapshot(file)?.digest !== authenticationDigest(bytes))
            throw new Error(FAILURE);
    } catch {
        throw new Error(FAILURE);
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
        fs.rmSync(temporary, { force: true });
    }
}
