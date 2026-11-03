import { execFileSync } from "node:child_process";
import { windowsNativeHostExecutable } from "./windows-host-control-client.js";
import { nativeHelperEnvironment } from "./native-helper-environment.js";

export interface WindowsWorkspaceIdentity {
    volumeSerial: string;
    fileId: string;
}

/** 不通过 SCM/管道；随包受信 helper 在句柄上检查目录身份与 ACL。 */
export function readWindowsWorkspaceIdentity(directory: string): WindowsWorkspaceIdentity {
    const value: unknown = JSON.parse(
        execFileSync(
            windowsNativeHostExecutable(),
            ["workspace-identity", "--directory", directory],
            {
                encoding: "utf8",
                env: nativeHelperEnvironment(),
                timeout: 5000,
                maxBuffer: 4096,
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"],
            },
        ),
    );
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Reflect.ownKeys(value).length !== 3
    )
        throw new Error("Windows 工作区身份响应无效");
    const proof = value as Record<string, unknown>;
    if (
        proof.version !== 1 ||
        typeof proof.volumeSerial !== "string" ||
        !/^[0-9a-f]{16}$/.test(proof.volumeSerial) ||
        typeof proof.fileId !== "string" ||
        !/^[0-9a-f]{32}$/.test(proof.fileId)
    )
        throw new Error("Windows 工作区身份响应无效");
    return { volumeSerial: proof.volumeSerial, fileId: proof.fileId };
}

/** native 将目录和祖先的非继承句柄转入当前 Node 进程；不是短期 helper 检查。 */
export function acquireWindowsWorkspaceIdentity(
    directory: string,
): WindowsWorkspaceIdentity & { close(): void } {
    const value: unknown = JSON.parse(
        execFileSync(
            windowsNativeHostExecutable(),
            ["workspace-anchor", "--directory", directory],
            {
                encoding: "utf8",
                env: nativeHelperEnvironment(),
                timeout: 5000,
                maxBuffer: 4096,
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"],
            },
        ),
    );
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Reflect.ownKeys(value).length !== 4
    )
        throw new Error("Windows 工作区锚点响应无效；请停止本次管理进程释放未知句柄");
    const proof = value as Record<string, unknown>;
    if (
        proof.version !== 1 ||
        typeof proof.volumeSerial !== "string" ||
        !/^[0-9a-f]{16}$/.test(proof.volumeSerial) ||
        typeof proof.fileId !== "string" ||
        !/^[0-9a-f]{32}$/.test(proof.fileId) ||
        !Array.isArray(proof.handles) ||
        proof.handles.length < 1 ||
        proof.handles.length > 128 ||
        new Set(proof.handles).size !== proof.handles.length ||
        proof.handles.some(
            handle =>
                typeof handle !== "string" || !/^[0-9a-f]{16}$/.test(handle) || /^0+$/.test(handle),
        )
    )
        throw new Error("Windows 工作区锚点响应无效；请停止本次管理进程释放未知句柄");
    const handles = proof.handles;
    let closed = false;
    return {
        volumeSerial: proof.volumeSerial,
        fileId: proof.fileId,
        close() {
            if (closed) return;
            // 原生 CLOSE_SOURCE 即使返回错误也可能已关闭。数值 HANDLE 不得在未知后重试。
            closed = true;
            const result: unknown = JSON.parse(
                execFileSync(windowsNativeHostExecutable(), ["workspace-anchor-release"], {
                    input: JSON.stringify({ version: 1, handles }),
                    encoding: "utf8",
                    env: nativeHelperEnvironment(),
                    timeout: 5000,
                    maxBuffer: 4096,
                    windowsHide: true,
                    stdio: ["pipe", "pipe", "pipe"],
                }),
            );
            if (
                !result ||
                typeof result !== "object" ||
                Array.isArray(result) ||
                Reflect.ownKeys(result).length !== 2 ||
                (result as Record<string, unknown>).version !== 1 ||
                (result as Record<string, unknown>).verified !== true
            )
                throw new Error("Windows 工作区锚点关闭结果未知；不得重试句柄，停止管理进程后诊断");
        },
    };
}
