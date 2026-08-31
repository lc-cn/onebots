/** 服务管理器依赖的宿主进程边界。 */
import * as os from "node:os";
import { execFileSync, spawn } from "node:child_process";

export interface ServiceHost {
    platform: NodeJS.Platform;
    homedir: string;
    uid?: number;
    isElevated?: boolean;
    env: NodeJS.ProcessEnv;
    exec(
        file: string,
        args: string[],
        options?: { inherit?: boolean; ignoreError?: boolean },
    ): string;
    spawn(file: string, args: string[]): Promise<number>;
}

export function createDefaultServiceHost(): ServiceHost {
    return {
        platform: process.platform,
        homedir: os.homedir(),
        uid: typeof process.getuid === "function" ? process.getuid() : undefined,
        isElevated: process.platform === "win32" ? windowsIsElevated() : undefined,
        env: process.env,
        exec(file, args, options) {
            try {
                return (
                    execFileSync(file, args, {
                        encoding: options?.inherit ? undefined : "utf8",
                        stdio: options?.inherit ? "inherit" : "pipe",
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
