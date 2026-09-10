/** 服务管理器依赖的宿主进程边界。 */
import * as os from "node:os";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ServiceHost {
    platform: NodeJS.Platform;
    homedir: string;
    uid?: number;
    isElevated?: boolean;
    /** Windows安装调用者的真实SID；只作为受保护管道的最小控制身份。 */
    windowsSid?: string;
    env: NodeJS.ProcessEnv;
    exec(
        file: string,
        args: string[],
        options?: { inherit?: boolean; ignoreError?: boolean; timeoutMs?: number },
    ): string;
    spawn(file: string, args: string[]): Promise<number>;
}

export function createDefaultServiceHost(): ServiceHost {
    const windowsIdentity = process.platform === "win32" ? readWindowsIdentity() : undefined;
    return {
        platform: process.platform,
        homedir: os.homedir(),
        uid: typeof process.getuid === "function" ? process.getuid() : undefined,
        isElevated: windowsIdentity?.elevated,
        windowsSid: windowsIdentity?.sid,
        env: process.env,
        exec(file, args, options) {
            try {
                return (
                    execFileSync(file, args, {
                        encoding: options?.inherit ? undefined : "utf8",
                        stdio: options?.inherit ? "inherit" : "pipe",
                        timeout: options?.timeoutMs,
                    })?.toString() ?? ""
                );
            } catch (error) {
                if (options?.ignoreError) return "";
                throw error;
            }
        },
        spawn(file, args) {
            return new Promise((resolve, reject) => {
                const child = spawn(file, args, { stdio: "inherit" });
                child.once("error", reject);
                child.once("exit", code => resolve(code ?? 1));
            });
        },
    };
}

interface WindowsIdentityProof {
    sid: string;
    elevated: boolean;
}

/** 由随包发布的固定 native host 单次、限时读取当前进程 token。 */
function readWindowsIdentity(): WindowsIdentityProof | undefined {
    try {
        const executable = path.join(
            path.dirname(fileURLToPath(import.meta.url)),
            "native",
            `win32-${process.arch}`,
            "onebots-windows-host.exe",
        );
        const output = execFileSync(executable, ["identity"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 5000,
        }).trim();
        const value: unknown = JSON.parse(output);
        if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            Reflect.ownKeys(value).length !== 3 ||
            (value as Record<string, unknown>).version !== 1 ||
            typeof (value as Record<string, unknown>).sid !== "string" ||
            !/^S-1-(?:[0-9]+-)+[0-9]+$/.test((value as Record<string, string>).sid) ||
            typeof (value as Record<string, unknown>).elevated !== "boolean"
        )
            return undefined;
        return value as WindowsIdentityProof;
    } catch {
        return undefined;
    }
}
