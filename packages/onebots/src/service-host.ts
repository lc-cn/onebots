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
    return {
        platform: process.platform,
        homedir: os.homedir(),
        uid: typeof process.getuid === "function" ? process.getuid() : undefined,
        isElevated: process.platform === "win32" ? windowsIsElevated() : undefined,
        windowsSid: process.platform === "win32" ? windowsCurrentSid() : undefined,
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

function windowsCurrentSid(): string | undefined {
    try {
        const output = execFileSync(
            "powershell.exe",
            [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
            ],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
        ).trim();
        return /^S-1-(?:[0-9]+-)+[0-9]+$/.test(output) ? output : undefined;
    } catch {
        return undefined;
    }
}

function windowsIsElevated(): boolean {
    try {
        execFileSync("net.exe", ["session"], { stdio: "ignore" });
        return true;
    } catch (error) {
        // net session 在非管理员会话中返回非零退出码。
        void error;
        return false;
    }
}
