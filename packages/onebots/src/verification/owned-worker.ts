import { fork, type Serializable } from "node:child_process";
import { waitForProcessGroupExit } from "../process-group-exit.js";
import {
    writeConfigurationVerificationOwner,
    type ConfigurationVerificationOwner,
} from "../configuration/configuration-verify-ownership.js";

export class OwnedWorkerError extends Error {
    constructor(
        public readonly code: "CANCELLED" | "TIMEOUT" | "WORKER_FAILED" | "CLEANUP_FAILED",
    ) {
        super("隔离验证进程未完成");
        this.name = "OwnedWorkerError";
    }
}
export interface OwnedWorkerOptions<T> {
    /** 仅可信内部入口；不得接受 HTTP 输入。 */
    entrypoint: string;
    args?: string[];
    cwd: string;
    directory: string;
    owner: ConfigurationVerificationOwner;
    request: Serializable;
    timeoutMs: number;
    signal?: AbortSignal;
    decode(value: unknown): T;
    lifecycle: { cleanupAllowed: boolean };
}

/** 进程与凭据隔离，不构成恶意扩展的文件系统或网络沙箱。 */
export async function runOwnedWorker<T>(options: OwnedWorkerOptions<T>): Promise<T> {
    const { directory, owner, lifecycle, signal } = options;
    if (process.platform === "win32") throw new OwnedWorkerError("CLEANUP_FAILED");
    if (
        !Number.isSafeInteger(options.timeoutMs) ||
        options.timeoutMs < 1 ||
        options.timeoutMs > 300_000
    )
        throw new OwnedWorkerError("WORKER_FAILED");
    if (signal?.aborted) throw new OwnedWorkerError("CANCELLED");
    return new Promise((resolve, reject) => {
        const env: NodeJS.ProcessEnv = {
            HOME: directory,
            USERPROFILE: directory,
            TMPDIR: directory,
            TMP: directory,
            TEMP: directory,
            NODE_ENV: "production",
            ONEBOTS_VERIFY_PROCESS_GROUP: "1",
        };
        for (const key of ["PATH", "SystemRoot", "WINDIR", "LANG", "LC_ALL"])
            if (process.env[key]) env[key] = process.env[key];
        // 一旦开始派发，只有进程组退出证明才能恢复清理许可。
        lifecycle.cleanupAllowed = false;
        let worker: ReturnType<typeof fork>;
        try {
            owner.phase = "spawning";
            writeConfigurationVerificationOwner(directory, owner);
            worker = fork(options.entrypoint, options.args ?? [], {
                cwd: options.cwd,
                env,
                execArgv: [],
                detached: true,
                stdio: ["ignore", "ignore", "ignore", "ipc"],
            });
        } catch {
            reject(new OwnedWorkerError("CLEANUP_FAILED"));
            return;
        }
        let settled = false;
        let received = false;
        let result: T;
        let error: OwnedWorkerError | undefined;
        let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
        const kill = () => {
            if (!worker.pid) return;
            try {
                process.kill(-worker.pid, "SIGKILL");
            } catch (cause) {
                // EPERM 不证明退出，保留所有权直到组退出证明或冷恢复。
                if (!["ESRCH", "EPERM"].includes((cause as NodeJS.ErrnoException).code ?? ""))
                    error = new OwnedWorkerError("CLEANUP_FAILED");
            }
        };
        const releaseHandles = () => {
            clearTimeout(timer);
            clearTimeout(cleanupTimer);
            signal?.removeEventListener("abort", abort);
        };
        const fail = (code: OwnedWorkerError["code"]) => {
            if (settled) return;
            error ??= new OwnedWorkerError(code);
            kill();
            cleanupTimer ??= setTimeout(() => {
                if (settled) return;
                settled = true;
                releaseHandles();
                try {
                    if (worker.connected) worker.disconnect();
                } catch {
                    /* IPC 已不可用，仍按退出未知处理。 */
                }
                worker.channel?.unref();
                worker.unref();
                reject(new OwnedWorkerError("CLEANUP_FAILED"));
            }, 2000);
        };
        const abort = () => fail("CANCELLED");
        const timer = setTimeout(() => fail("TIMEOUT"), options.timeoutMs);
        signal?.addEventListener("abort", abort, { once: true });
        worker.on("error", () => fail("WORKER_FAILED"));
        worker.on("message", (value: unknown) => {
            if (settled) return;
            if (received) {
                fail("WORKER_FAILED");
                return;
            }
            received = true;
            try {
                result = options.decode(value);
            } catch {
                fail("WORKER_FAILED");
            }
        });
        worker.once("close", async code => {
            if (settled) return;
            releaseHandles();
            kill();
            const reaped =
                !worker.pid || (await waitForProcessGroupExit(worker.pid, 2000)) === "exited";
            if (settled) return;
            settled = true;
            releaseHandles();
            lifecycle.cleanupAllowed = reaped;
            if (!reaped) reject(new OwnedWorkerError("CLEANUP_FAILED"));
            else if (error || code !== 0 || !received)
                reject(error ?? new OwnedWorkerError("WORKER_FAILED"));
            else resolve(result!);
        });
        try {
            if (!worker.pid) throw new Error();
            owner.phase = "running";
            owner.workerPid = worker.pid;
            writeConfigurationVerificationOwner(directory, owner);
            worker.send(options.request, error => {
                if (error) fail("WORKER_FAILED");
            });
        } catch {
            fail("WORKER_FAILED");
        }
        if (signal?.aborted) abort();
    });
}
