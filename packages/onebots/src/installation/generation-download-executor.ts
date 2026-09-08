import { spawn } from "node:child_process";
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    GenerationDownloadError,
    type GenerationDownloadInput,
} from "./generation-download-types.js";
import { updateDownloadOwner, type DownloadOwner } from "./generation-download-state.js";

export interface DownloadExecutionInput extends GenerationDownloadInput {
    credentialDirectory: string;
    owner: DownloadOwner;
}

const INSTALL_ARGUMENTS = [
    "install",
    "--prod",
    "--ignore-scripts",
    "--ignore-pnpmfile",
    "--ignore-workspace",
    // pnpm 的 file override 会改写 peer range；下载器只获取文件。
    // 原始 peer 范围与实际解析版本必须由独立验证器核验后才能提交/激活。
    "--config.strict-peer-dependencies=false",
    "--config.auto-install-peers=true",
    "--config.package-manager-strict-version=true",
    "--config.registry=https://registry.npmjs.org/",
    "--reporter=silent",
];

function environment(temporary: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL"]) {
        if (process.env[key]) env[key] = process.env[key];
    }
    return {
        ...env,
        HOME: temporary,
        USERPROFILE: temporary,
        XDG_CONFIG_HOME: path.join(temporary, "config"),
        XDG_CACHE_HOME: path.join(temporary, "cache"),
        XDG_DATA_HOME: path.join(temporary, "share"),
        TMPDIR: path.join(temporary, "tmp"),
        TEMP: path.join(temporary, "tmp"),
        TMP: path.join(temporary, "tmp"),
        NPM_CONFIG_USERCONFIG: path.join(temporary, "npmrc"),
        NPM_CONFIG_GLOBALCONFIG: path.join(temporary, "global-npmrc"),
        NPM_CONFIG_CACHE: path.join(temporary, "cache"),
        COREPACK_HOME: path.join(temporary, "corepack"),
        COREPACK_ENABLE_AUTO_PIN: "0",
        COREPACK_ENABLE_PROJECT_SPEC: "1",
        COREPACK_DEFAULT_TO_LATEST: "0",
        CI: "true",
    };
}

/**
 * 只下载到新候选目录；完成并销毁下载进程及其临时授权后才返回。
 * 返回不代表依赖兼容或可启动，调用方必须通过独立验证器再提交验证收据。
 * 同权限进程不是恶意代码安全沙箱；manifest 与执行入口必须来自受信计划。
 */
export async function executeGenerationDownload(input: DownloadExecutionInput): Promise<void> {
    if (input.signal?.aborted) throw new GenerationDownloadError("CANCELLED");
    const executable = input.pnpmExecutable ?? process.execPath;
    let pnpmScript = input.pnpmScript;
    if (!input.pnpmExecutable && !pnpmScript) {
        try {
            // pnpm 的 exports 只开放 package.json；从其受信包根定位声明的 CLI 文件。
            pnpmScript = fileURLToPath(new URL("./bin/pnpm.cjs", import.meta.resolve("pnpm")));
        } catch (error) {
            throw new GenerationDownloadError("UNSUPPORTED_EXECUTABLE");
        }
    }
    if (
        /\.(?:cmd|bat)$/i.test(executable) ||
        (process.platform === "win32" && !/\.exe$/i.test(executable))
    ) {
        throw new GenerationDownloadError("UNSUPPORTED_EXECUTABLE");
    }
    if (
        !path.isAbsolute(input.directory) ||
        (pnpmScript && (!path.isAbsolute(pnpmScript) || !/\.(?:cjs|mjs|js)$/i.test(pnpmScript))) ||
        (input.timeoutMs !== undefined &&
            (!Number.isFinite(input.timeoutMs) ||
                input.timeoutMs <= 0 ||
                input.timeoutMs > 30 * 60_000)) ||
        (input.token && !/^[A-Za-z0-9_]+$/.test(input.token))
    ) {
        throw new GenerationDownloadError("INVALID_INPUT");
    }
    let manifest: string;
    try {
        if (!input.manifest || typeof input.manifest !== "object" || Array.isArray(input.manifest))
            throw new Error();
        if ((input.manifest as Record<string, unknown>).packageManager !== "pnpm@9.15.9")
            throw new Error();
        manifest = JSON.stringify(input.manifest, null, 2) + "\n";
        if (input.token && manifest.includes(input.token)) throw new Error();
        const stat = await lstat(input.directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
        // 不复用含 npmrc、锁、工作区钩子或半成品 node_modules 的目录。
        if ((await readdir(input.directory)).some(name => name !== "candidate.json"))
            throw new Error();
    } catch (error) {
        throw new GenerationDownloadError("INVALID_INPUT");
    }

    const temporary = input.credentialDirectory;
    try {
        await mkdir(path.join(temporary, "tmp"), { mode: 0o700 });
        const auth = [
            "registry=https://registry.npmjs.org/",
            "@icqqjs:registry=https://npm.pkg.github.com/",
        ];
        await writeFile(path.join(temporary, "npmrc"), auth.join("\n") + "\n", {
            mode: 0o600,
            flag: "wx",
        });
        await writeFile(path.join(temporary, "global-npmrc"), "", { mode: 0o600, flag: "wx" });
        await writeFile(path.join(input.directory, "package.json"), manifest, {
            mode: 0o600,
            flag: "wx",
        });
        const prefix = pnpmScript ? [pnpmScript] : [];
        const childEnvironment = environment(temporary);
        // 实际执行器必须报告准确版本；PATH/corepack shim 的名称不构成版本证据。
        // 此步骤尚未写入 Token，版本检测/受信 Corepack 准备阶段接触不到下载授权。
        await runDownload(executable, [...prefix, "--version"], input, childEnvironment, true);
        if (input.token) {
            auth.push(`//npm.pkg.github.com/:_authToken=${input.token}`);
            await writeFile(path.join(temporary, "npmrc"), auth.join("\n") + "\n", { mode: 0o600 });
        }
        const args = [
            ...prefix,
            ...INSTALL_ARGUMENTS,
            `--store-dir=${path.join(temporary, "store")}`,
            `--config.cache-dir=${path.join(temporary, "cache")}`,
        ];
        await runDownload(executable, args, input, childEnvironment);
    } catch (error) {
        if (error instanceof GenerationDownloadError) throw error;
        throw new GenerationDownloadError("DOWNLOAD_FAILED");
    }
}

async function runDownload(
    executable: string,
    args: string[],
    input: DownloadExecutionInput,
    env: NodeJS.ProcessEnv,
    checkVersion = false,
): Promise<void> {
    await updateDownloadOwner(input.credentialDirectory, input.owner, {
        phase: "spawning",
        downloaderPid: null,
    });
    return new Promise((resolve, reject) => {
        if (input.signal?.aborted) {
            // No spawn happened. Commit that fact before allowing credential cleanup.
            void updateDownloadOwner(input.credentialDirectory, input.owner, {
                phase: "idle",
                downloaderPid: null,
            }).then(
                () => reject(new GenerationDownloadError("CANCELLED")),
                () => reject(new GenerationDownloadError("CLEANUP_FAILED")),
            );
            return;
        }
        const child = spawn(executable, args, {
            cwd: input.directory,
            env,
            shell: false,
            detached: process.platform !== "win32",
            // 输出可能包含认证信息，既不缓存也不转发至控制日志或调用端。
            stdio: checkVersion ? ["ignore", "pipe", "ignore"] : "ignore",
            windowsHide: true,
        });
        const ownerWritten = child.pid
            ? updateDownloadOwner(input.credentialDirectory, input.owner, {
                  phase: "downloading",
                  downloaderPid: child.pid,
              })
            : Promise.resolve();
        let cancelled = false;
        let failed = false;
        let terminating = false;
        let version = "";
        let forceTimer: NodeJS.Timeout | undefined;
        let killer: Promise<void> | undefined;
        const killGroup = (signal: NodeJS.Signals) => {
            if (!child.pid) return;
            try {
                process.kill(-child.pid, signal);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ESRCH") failed = true;
            }
        };
        const terminate = () => {
            if (terminating) return;
            terminating = true;
            if (process.platform === "win32") {
                // Windows 无 POSIX 进程组；结构化调用系统 taskkill 回收整个下载进程树。
                killer = new Promise<void>(done => {
                    const taskkill = spawn(
                        path.join(
                            process.env.SystemRoot || "C:\\Windows",
                            "System32",
                            "taskkill.exe",
                        ),
                        ["/PID", String(child.pid), "/T", "/F"],
                        { shell: false, stdio: "ignore", windowsHide: true },
                    );
                    taskkill.once("error", () => {
                        failed = true;
                        child.kill();
                    });
                    taskkill.once("close", () => done());
                });
            } else {
                killGroup("SIGTERM");
                forceTimer = setTimeout(() => killGroup("SIGKILL"), 1_000);
            }
        };
        void ownerWritten.catch(() => {
            failed = true;
            terminate();
        });
        const abort = () => {
            cancelled = true;
            terminate();
        };
        child.stdout?.on("data", chunk => {
            if (version.length + chunk.length > 128) {
                failed = true;
                terminate();
            } else version += chunk.toString();
        });
        input.signal?.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(
            () => {
                failed = true;
                terminate();
            },
            input.timeoutMs ?? 10 * 60_000,
        );
        child.once("error", () => {
            failed = true;
        });
        child.once("close", async code => {
            clearTimeout(timeout);
            if (forceTimer) clearTimeout(forceTimer);
            input.signal?.removeEventListener("abort", abort);
            await killer;
            // wrapper 已退出也不能让其子进程继续携带授权；其进程组仍由本次调用拥有。
            if (process.platform !== "win32") killGroup("SIGKILL");
            try {
                await ownerWritten;
                if (process.platform !== "win32" && child.pid) {
                    for (let attempt = 0; attempt < 100; attempt++) {
                        try {
                            process.kill(-child.pid, 0);
                        } catch (error) {
                            if ((error as NodeJS.ErrnoException).code === "ESRCH") break;
                            throw error;
                        }
                        if (attempt === 99) throw new Error("下载进程组仍存活");
                        await new Promise(done => setTimeout(done, 20));
                    }
                }
                await updateDownloadOwner(input.credentialDirectory, input.owner, {
                    phase: "idle",
                    downloaderPid: null,
                });
            } catch (error) {
                failed = true;
            }
            if (cancelled) reject(new GenerationDownloadError("CANCELLED"));
            else if (checkVersion && (failed || code !== 0 || version.trim() !== "9.15.9"))
                reject(new GenerationDownloadError("PACKAGE_MANAGER_MISMATCH"));
            else if (failed || code !== 0) reject(new GenerationDownloadError("DOWNLOAD_FAILED"));
            else resolve();
        });
    });
}
