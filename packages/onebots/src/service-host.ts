/** 服务管理器依赖的宿主进程边界。 */
import * as os from "node:os";
import { execFileSync, spawn } from "node:child_process";

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

/** 单次、限时读取当前 token；不依赖可能等待 Server 服务的 `net session`。 */
function readWindowsIdentity(): WindowsIdentityProof | undefined {
    try {
        const script = String.raw`
$ErrorActionPreference='Stop'
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object System.Security.Principal.WindowsPrincipal($identity)
$admin=[System.Security.Principal.WindowsBuiltInRole]::Administrator
$value=@{sid=$identity.User.Value;elevated=$principal.IsInRole($admin)}|ConvertTo-Json -Compress
[Console]::Out.Write($value)
`;
        const output = execFileSync(
            "powershell.exe",
            [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
                Buffer.from(script, "utf16le").toString("base64"),
            ],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
        ).trim();
        const value: unknown = JSON.parse(output);
        if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            Reflect.ownKeys(value).length !== 2 ||
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
