import { waitForProcessGroupExit } from "../process-group-exit.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ControlExtensionSelection } from "@onebots/core/control";
import {
    allocateConfigurationVerification,
    writeConfigurationVerificationOwner,
} from "./configuration-verify-ownership.js";
import { parseConfigurationDocument } from "./configuration-document.js";

export interface ConfigurationRuntimeInspectInput {
    /** 管理服务必须传工作区内私有所有权目录。 */
    privateRoot?: string;
    runtimeRoot: string;
    /** 仅允许管理服务提供；不得接收 HTTP 用户输入。 */
    hostEntrypoint?: string;
    selection: ControlExtensionSelection;
    timeoutMs?: number;
    signal?: AbortSignal;
}
export interface ConfigurationRuntimeInspection {
    schemas: Record<string, unknown>;
    fingerprint: string;
}
function failure(): Error {
    return new Error("运行环境配置能力探测未完成");
}

/** 仅管理服务受信内部调用；进程隔离不构成恶意扩展沙箱。 */
export async function inspectConfigurationRuntime(
    input: ConfigurationRuntimeInspectInput,
): Promise<ConfigurationRuntimeInspection> {
    if (process.platform === "win32") throw failure();
    const timeout = input.timeoutMs ?? 30_000;
    let selection: ControlExtensionSelection;
    let runtimeRoot: string;
    let hostEntrypoint: string | undefined;
    try {
        selection = parseConfigurationDocument(
            input.selection,
        ) as unknown as ControlExtensionSelection;
        if (
            ![selection.adapters, selection.protocols, selection.applications].every(
                list =>
                    Array.isArray(list) &&
                    list.length <= 100 &&
                    list.every(
                        name => typeof name === "string" && /^[a-z0-9][a-z0-9-]{0,99}$/.test(name),
                    ),
            )
        )
            throw failure();
        if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300_000) throw failure();
        runtimeRoot = fs.realpathSync(input.runtimeRoot);
        if (input.hostEntrypoint !== undefined) {
            if (typeof input.hostEntrypoint !== "string" || !path.isAbsolute(input.hostEntrypoint))
                throw new Error();
            hostEntrypoint = fs.realpathSync(input.hostEntrypoint);
            if (!fs.statSync(hostEntrypoint).isFile()) throw new Error();
        }
    } catch {
        throw failure();
    }
    if (input.signal?.aborted) throw failure();
    const { directory: home, owner } = allocateConfigurationVerification(
        input.privateRoot ??
            path.join(os.tmpdir(), `onebots-schema-verifications-${process.getuid?.() ?? "user"}`),
    );
    let cleanupAllowed = true;
    try {
        return await new Promise((resolve, reject) => {
            const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
            owner.phase = "spawning";
            writeConfigurationVerificationOwner(home, owner);
            const worker = fork(
                fileURLToPath(
                    new URL(`./configuration-runtime-inspect-worker.${extension}`, import.meta.url),
                ),
                [],
                {
                    cwd: home,
                    detached: true,
                    execArgv: [],
                    env: {
                        HOME: home,
                        TMPDIR: home,
                        TMP: home,
                        TEMP: home,
                        NODE_ENV: "production",
                    },
                    stdio: ["ignore", "ignore", "ignore", "ipc"],
                },
            );
            cleanupAllowed = false;
            let result: ConfigurationRuntimeInspection | undefined;
            let failed = false;
            const kill = () => {
                if (!worker.pid) return;
                try {
                    process.kill(-worker.pid, "SIGKILL");
                } catch (error) {
                    // EPERM 仍属未知，必须等 close 后的有界 ESRCH 证明，不能在此清理所有权。
                if (!["ESRCH", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""))
                        failed = true;
                }
            };
            const abort = () => {
                failed = true;
                kill();
            };
            const timer = setTimeout(abort, timeout);
            input.signal?.addEventListener("abort", abort, { once: true });
            worker.on("error", abort);
            worker.on("message", (value: unknown) => {
                try {
                    if (result || !value || typeof value !== "object") throw failure();
                    const wire = value as { schemas?: unknown; fingerprint?: unknown };
                    if (
                        typeof wire.schemas !== "string" ||
                        Buffer.byteLength(wire.schemas) > 1024 * 1024 ||
                        typeof wire.fingerprint !== "string" ||
                        !/^[a-f0-9]{64}$/.test(wire.fingerprint)
                    )
                        throw failure();
                    const schemas = JSON.parse(wire.schemas);
                    if (
                        !schemas ||
                        schemas.schemaVersion !== 1 ||
                        !schemas.adapters ||
                        !schemas.protocols ||
                        !schemas.applications ||
                        !Array.isArray(schemas.protocolMetadata) ||
                        !Array.isArray(schemas.runtimeOnly)
                    )
                        throw failure();
                    result = { schemas, fingerprint: wire.fingerprint };
                } catch {
                    abort();
                }
            });
            worker.once("close", async code => {
                clearTimeout(timer);
                input.signal?.removeEventListener("abort", abort);
                kill();
                const reaped =
                    !worker.pid || (await waitForProcessGroupExit(worker.pid, 2000)) === "exited";
                if (!reaped) failed = true;
                cleanupAllowed = reaped;
                if (failed || code !== 0 || !result) reject(failure());
                else resolve(result);
            });
            try {
                if (!worker.pid) throw failure();
                owner.phase = "running";
                owner.workerPid = worker.pid;
                writeConfigurationVerificationOwner(home, owner);
                worker.send({ runtimeRoot, hostEntrypoint, selection }, error => {
                    if (error) abort();
                });
            } catch {
                abort();
            }
            if (input.signal?.aborted) abort();
        });
    } catch {
        throw failure();
    } finally {
        try {
            if (cleanupAllowed) fs.rmSync(home, { recursive: true, force: true });
        } catch {
            throw failure();
        }
    }
}
