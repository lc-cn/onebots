import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    GenerationDownloadError,
    type GenerationDownloadInput,
} from "./generation-download-types.js";
import {
    allocateDownloadCredentials,
    cleanupDownloadCredentials,
    recoverDownloadCredentials,
    updateDownloadOwner,
} from "./generation-download-state.js";
export {
    GenerationDownloadError,
    type GenerationDownloadInput,
} from "./generation-download-types.js";
export { recoverDownloadCredentials } from "./generation-download-state.js";

/** 父进程只协调短命 worker；收到清理成功且 worker 退出后才允许后续验证。 */
export async function downloadGeneration(input: GenerationDownloadInput): Promise<void> {
    try {
        await downloadWithWorker(input);
    } catch (error) {
        if (error instanceof GenerationDownloadError) throw error;
        throw new GenerationDownloadError("DOWNLOAD_FAILED");
    }
}

async function downloadWithWorker(input: GenerationDownloadInput): Promise<void> {
    if (input.signal?.aborted) throw new GenerationDownloadError("CANCELLED");
    if (!path.isAbsolute(input.directory)) throw new GenerationDownloadError("INVALID_INPUT");
    const root =
        input.credentialRoot ?? path.join(path.dirname(input.directory), ".download-credentials");
    const recovery = await recoverDownloadCredentials(root);
    if (recovery.blocked.length) throw new GenerationDownloadError("CLEANUP_FAILED");
    const { directory, owner } = await allocateDownloadCredentials(root);
    let entry = fileURLToPath(new URL("./generation-download-worker.js", import.meta.url));
    const execArgv: string[] = [];
    if (!existsSync(entry) && import.meta.url.endsWith(".ts")) {
        entry = fileURLToPath(new URL("./generation-download-worker.ts", import.meta.url));
        // 仅源码开发/测试使用；发布工件通过编译后的 .js 启动，无 tsx 运行依赖。
        execArgv.push("--import", import.meta.resolve("tsx/esm"));
    }
    const environment: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "SystemRoot", "WINDIR", "PATHEXT", "LANG", "LC_ALL"])
        if (process.env[key]) environment[key] = process.env[key];
    environment.HOME = directory;
    environment.TMPDIR = directory;
    environment.TEMP = directory;
    environment.TMP = directory;
    let child: ReturnType<typeof fork>;
    try {
        child = fork(entry, [], {
            env: environment,
            execArgv,
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
    } catch (error) {
        await cleanupDownloadCredentials(directory, owner.id);
        throw new GenerationDownloadError("DOWNLOAD_FAILED");
    }
    let cancelled = false;
    let result: { ok: boolean; code?: GenerationDownloadError["code"] } | undefined;
    let forceTimer: NodeJS.Timeout | undefined;
    const abort = () => {
        cancelled = true;
        if (child.connected) child.send({ type: "download.abort" });
        forceTimer ??= setTimeout(() => child.kill("SIGKILL"), 10_000);
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    const watchdog = setTimeout(abort, (input.timeoutMs ?? 10 * 60_000) * 2 + 15_000);
    const closed = new Promise<number | null>(resolve => {
        child.once("error", () => {
            result = { ok: false, code: "DOWNLOAD_FAILED" };
        });
        child.on("message", value => {
            if (!value || typeof value !== "object") return;
            const message = value as Record<string, unknown>;
            if (message.type === "download.result" && typeof message.ok === "boolean") {
                const codes = [
                    "INVALID_INPUT",
                    "UNSUPPORTED_EXECUTABLE",
                    "PACKAGE_MANAGER_MISMATCH",
                    "CANCELLED",
                    "DOWNLOAD_FAILED",
                    "CLEANUP_FAILED",
                ];
                result = {
                    ok: message.ok,
                    code: codes.includes(String(message.code))
                        ? (message.code as GenerationDownloadError["code"])
                        : "DOWNLOAD_FAILED",
                };
            }
        });
        child.once("close", code => resolve(code));
    });
    let code: number | null = null;
    try {
        if (!child.pid) throw new GenerationDownloadError("DOWNLOAD_FAILED");
        await updateDownloadOwner(directory, owner, { workerPid: child.pid, phase: "idle" });
        if (input.signal?.aborted) abort();
        const { signal: _signal, ...wireInput } = input;
        if (child.connected)
            child.send({
                type: "download.start",
                input: { ...wireInput, credentialDirectory: directory, owner },
            });
        code = await closed;
    } catch (error) {
        child.kill("SIGTERM");
        await closed;
        result = { ok: false, code: "DOWNLOAD_FAILED" };
    } finally {
        clearTimeout(watchdog);
        if (forceTimer) clearTimeout(forceTimer);
        input.signal?.removeEventListener("abort", abort);
    }
    if (existsSync(directory)) {
        // worker异常退出时也不能删仍被下载进程使用的凭据；保留记录供冷恢复诊断。
        await cleanupDownloadCredentials(directory, owner.id);
    }
    if (cancelled) throw new GenerationDownloadError("CANCELLED");
    if (!result?.ok || code !== 0)
        throw new GenerationDownloadError(result?.code ?? "DOWNLOAD_FAILED");
}
