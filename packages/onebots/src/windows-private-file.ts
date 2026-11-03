import { execFileSync } from "node:child_process";
import { windowsNativeHostExecutable } from "./windows-host-control-client.js";
import { nativeHelperEnvironment } from "./native-helper-environment.js";

interface PrivateReplacement {
    directory: string;
    fileName: string;
    expectedDigest: string | null;
    bytes: Buffer;
}

function proof(args: string[], input?: string): void {
    const value: unknown = JSON.parse(
        execFileSync(windowsNativeHostExecutable(), args, {
            input,
            env: nativeHelperEnvironment(),
            encoding: "utf8",
            timeout: 10000,
            maxBuffer: 4096,
            windowsHide: true,
            stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        }),
    );
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Reflect.ownKeys(value).length !== 2 ||
        (value as Record<string, unknown>).version !== 1 ||
        (value as Record<string, unknown>).verified !== true
    )
        throw new Error("Windows 私有存储响应无效");
}

/** 只读检查受保护父目录、私有对象 ACL、普通单链接文件；不修复权限。 */
export function inspectWindowsPrivateFile(file: string): void {
    proof(["private-file-inspect", "--file", file]);
}

/** 原子创建全新私有目录；已有目录一律拒绝。 */
export function createWindowsPrivateDirectory(directory: string): void {
    proof(["private-directory-create", "--directory", directory]);
}

/** 同目录私有临时文件 FlushFileBuffers + MoveFileEx WRITE_THROUGH；没有同字节捷径。 */
export function replaceWindowsPrivateFile(input: PrivateReplacement): void {
    if (input.bytes.length > 4 * 1024 * 1024) throw new Error("Windows 私有文件过大");
    proof(
        ["private-file-replace"],
        JSON.stringify({
            version: 1,
            directory: input.directory,
            fileName: input.fileName,
            expectedDigest: input.expectedDigest,
            bytes: input.bytes.toString("base64"),
        }),
    );
}
