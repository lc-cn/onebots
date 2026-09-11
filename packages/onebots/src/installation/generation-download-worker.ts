import {
    executeGenerationDownload,
    type DownloadExecutionInput,
} from "./generation-download-executor.js";
import { cleanupDownloadCredentials, readDownloadOwner } from "./generation-download-state.js";
import { GenerationDownloadError } from "./generation-download-types.js";

const cancellation = new AbortController();
let started = false;
const stop = () => {
    cancellation.abort();
    if (!started) process.exit(1);
};
process.once("disconnect", stop);
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
const handshake = setTimeout(() => process.exit(1), 30_000);
if (!process.send || !process.connected) process.exit(1);
process.on("message", value => {
    if (!value || typeof value !== "object") return;
    const message = value as { type?: string; input?: DownloadExecutionInput };
    if (message.type === "download.abort") {
        stop();
        return;
    }
    if (message.type !== "download.start" || started || !message.input) return;
    started = true;
    clearTimeout(handshake);
    void run(message.input);
});

async function run(input: DownloadExecutionInput): Promise<void> {
    let code: GenerationDownloadError["code"] | undefined;
    let authorized = false;
    try {
        const owner = await readDownloadOwner(input.credentialDirectory);
        if (
            owner.workerPid !== process.pid ||
            owner.parentPid !== process.ppid ||
            owner.id !== input.owner.id
        )
            throw new GenerationDownloadError("INVALID_INPUT");
        authorized = true;
        await executeGenerationDownload({ ...input, owner, signal: cancellation.signal });
    } catch (error) {
        code = error instanceof GenerationDownloadError ? error.code : "DOWNLOAD_FAILED";
    }
    try {
        if (!authorized) throw new GenerationDownloadError("CLEANUP_FAILED");
        await cleanupDownloadCredentials(input.credentialDirectory, input.owner.id, true);
    } catch (error) {
        code = "CLEANUP_FAILED";
    }
    // 仅固定枚举通过IPC返回；进程输出丢弃，Token不进入结果或持久记录。
    if (process.connected) {
        process.send?.({ type: "download.result", ok: code === undefined, code }, () =>
            process.exit(code ? 1 : 0),
        );
    } else process.exit(code ? 1 : 0);
}
