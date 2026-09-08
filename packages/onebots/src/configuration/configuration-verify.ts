import { waitForProcessGroupExit } from "../process-group-exit.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
    allocateConfigurationVerification,
    writeConfigurationVerificationOwner,
    type ConfigurationVerificationOwner,
} from "./configuration-verify-ownership.js";
export { recoverConfigurationVerifications } from "./configuration-verify-ownership.js";
import { parseConfigurationDocument } from "./configuration-document.js";

export interface ConfigurationVerificationInput {
    runtimeRoot: string;
    /** 仅允许管理服务提供；不得接收 HTTP 用户输入。 */
    hostEntrypoint?: string;
    /** 生产调用须指定工作区独占锁保护的私有目录。 */
    privateRoot?: string;
    selection: { adapters: string[]; protocols: string[]; applications: string[] };
    document: Record<string, unknown>;
    signal?: AbortSignal;
    timeoutMs?: number;
}
export interface ConfigurationVerification {
    valid: boolean;
    /** 结构化字段路径，不包含原始异常文案或配置值。 */
    issues: Array<{ path: string[]; message: string }>;
}
export class ConfigurationVerificationError extends Error {
    constructor(
        public readonly code:
            | "INVALID_INPUT"
            | "UNSUPPORTED_PLATFORM"
            | "CANCELLED"
            | "TIMEOUT"
            | "WORKER_FAILED"
            | "CLEANUP_FAILED",
    ) {
        super("配置验证未完成");
    }
}

/** 隔离插件生命周期与管理凭据，不是恶意插件的文件系统或网络沙箱。 */
export async function verifyConfiguration(
    input: ConfigurationVerificationInput,
): Promise<ConfigurationVerification> {
    if (process.platform === "win32")
        throw new ConfigurationVerificationError("UNSUPPORTED_PLATFORM");
    const timeout = input.timeoutMs ?? 30_000;
    let snapshot: {
        document: Record<string, unknown>;
        selection: ConfigurationVerificationInput["selection"];
    };
    try {
        snapshot = parseConfigurationDocument({
            document: input.document,
            selection: input.selection,
        }) as unknown as typeof snapshot;
        if (
            !snapshot.document ||
            typeof snapshot.document !== "object" ||
            Array.isArray(snapshot.document) ||
            !snapshot.selection ||
            ![
                snapshot.selection.adapters,
                snapshot.selection.protocols,
                snapshot.selection.applications,
            ].every(
                list =>
                    Array.isArray(list) &&
                    list.length <= 100 &&
                    list.every(
                        name => typeof name === "string" && /^[a-z0-9][a-z0-9-]{0,99}$/.test(name),
                    ),
            )
        )
            throw new Error();
        if (
            !Number.isSafeInteger(timeout) ||
            timeout < 1 ||
            timeout > 300_000 ||
            Buffer.byteLength(JSON.stringify(snapshot.document)) > 1024 * 1024
        )
            throw new Error();
    } catch {
        throw new ConfigurationVerificationError("INVALID_INPUT");
    }
    if (input.signal?.aborted) throw new ConfigurationVerificationError("CANCELLED");
    let runtimeRoot: string;
    let hostEntrypoint: string | undefined;
    try {
        runtimeRoot = fs.realpathSync(input.runtimeRoot);
        if (input.hostEntrypoint !== undefined) {
            if (typeof input.hostEntrypoint !== "string" || !path.isAbsolute(input.hostEntrypoint))
                throw new Error();
            hostEntrypoint = fs.realpathSync(input.hostEntrypoint);
            if (!fs.statSync(hostEntrypoint).isFile()) throw new Error();
        }
    } catch {
        throw new ConfigurationVerificationError("INVALID_INPUT");
    }
    let allocation: ReturnType<typeof allocateConfigurationVerification>;
    try {
        allocation = allocateConfigurationVerification(
            input.privateRoot ??
                path.join(
                    os.tmpdir(),
                    `onebots-config-verifications-${process.getuid?.() ?? "user"}`,
                ),
        );
    } catch {
        throw new ConfigurationVerificationError("CLEANUP_FAILED");
    }
    const { directory, owner } = allocation;
    let cleanupAllowed = true;
    try {
        fs.writeFileSync(
            path.join(directory, "request.json"),
            JSON.stringify({
                runtimeRoot,
                hostEntrypoint,
                selection: snapshot.selection,
                document: snapshot.document,
            }),
            { flag: "wx", mode: 0o600 },
        );
        return await run(directory, owner, timeout, input.signal);
    } catch (error) {
        if (error instanceof ConfigurationVerificationError) {
            // 回收无法确认时保留所有权记录，交由独占锁内的保守冷恢复处理。
            if (error.code === "CLEANUP_FAILED") cleanupAllowed = false;
            throw error;
        }
        throw new ConfigurationVerificationError("WORKER_FAILED");
    } finally {
        try {
            if (cleanupAllowed) fs.rmSync(directory, { recursive: true, force: true });
        } catch {
            throw new ConfigurationVerificationError("CLEANUP_FAILED");
        }
    }
}

function run(
    directory: string,
    owner: ConfigurationVerificationOwner,
    timeout: number,
    signal?: AbortSignal,
): Promise<ConfigurationVerification> {
    return new Promise((resolve, reject) => {
        owner.phase = "spawning";
        try {
            writeConfigurationVerificationOwner(directory, owner);
        } catch {
            reject(new ConfigurationVerificationError("CLEANUP_FAILED"));
            return;
        }
        const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
        const worker = fork(
            fileURLToPath(new URL(`./configuration-verify-worker.${extension}`, import.meta.url)),
            [directory],
            {
                cwd: directory,
                detached: true,
                execArgv: [],
                env: {
                    HOME: directory,
                    TMPDIR: directory,
                    TMP: directory,
                    TEMP: directory,
                    NODE_ENV: "production",
                },
                stdio: ["ignore", "ignore", "ignore", "ipc"],
            },
        );
        let result: ConfigurationVerification | undefined;
        let error: ConfigurationVerificationError | undefined;
        const kill = () => {
            if (!worker.pid) return;
            try {
                process.kill(-worker.pid, "SIGKILL");
            } catch (cause) {
                // EPERM 仍属未知，必须等 close 后的有界 ESRCH 证明，不能在此清理所有权。
                if (!["ESRCH", "EPERM"].includes((cause as NodeJS.ErrnoException).code ?? ""))
                    error = new ConfigurationVerificationError("CLEANUP_FAILED");
            }
        };
        const fail = (code: ConfigurationVerificationError["code"]) => {
            error ??= new ConfigurationVerificationError(code);
            kill();
        };
        const abort = () => fail("CANCELLED");
        const timer = setTimeout(() => fail("TIMEOUT"), timeout);
        signal?.addEventListener("abort", abort, { once: true });
        worker.on("error", () => fail("WORKER_FAILED"));
        worker.on("message", (value: unknown) => {
            if (result || !isResult(value)) {
                fail("WORKER_FAILED");
                return;
            }
            result = value;
        });
        worker.once("close", async code => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            kill();
            if (worker.pid && (await waitForProcessGroupExit(worker.pid, 2000)) !== "exited")
                error = new ConfigurationVerificationError("CLEANUP_FAILED");
            if (error || code !== 0 || !result)
                reject(error ?? new ConfigurationVerificationError("WORKER_FAILED"));
            else resolve(result);
        });
        try {
            if (!worker.pid) throw new Error();
            owner.workerPid = worker.pid;
            owner.phase = "running";
            writeConfigurationVerificationOwner(directory, owner);
            worker.send({ type: "start" }, error => {
                if (error) fail("WORKER_FAILED");
            });
        } catch {
            fail("CLEANUP_FAILED");
        }
        if (signal?.aborted) abort();
    });
}
function isResult(value: unknown): value is ConfigurationVerification {
    if (!value || typeof value !== "object") return false;
    const result = value as Partial<ConfigurationVerification>;
    return (
        typeof result.valid === "boolean" &&
        Array.isArray(result.issues) &&
        result.issues.length <= 100 &&
        (result.valid ? result.issues.length === 0 : result.issues.length > 0) &&
        result.issues.every(
            issue =>
                issue &&
                Array.isArray(issue.path) &&
                issue.path.length <= 30 &&
                issue.path.every(
                    segment => typeof segment === "string" && segment.length <= 1024,
                ) &&
                issue.message === "配置字段无效",
        )
    );
}
