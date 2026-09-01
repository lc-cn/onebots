import type { ServiceStatus } from "./service-manager.js";

export interface ServiceOfflineVerificationOptions {
    attempts?: number;
    intervalMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
}

/** 等待进程管理器确认托管服务不再运行，避免把异步停止请求误报为完成。 */
export async function verifyServiceStopped(
    readStatus: () => ServiceStatus,
    options: ServiceOfflineVerificationOptions = {},
): Promise<void> {
    const attempts = Math.max(1, options.attempts ?? 20);
    const intervalMs = options.intervalMs ?? 500;
    const sleep =
        options.sleep ??
        ((milliseconds: number) =>
            new Promise(resolve => {
                setTimeout(resolve, milliseconds);
            }));
    let lastEvidence = "进程管理器仍报告服务运行中";
    let statusUnavailable = false;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const status = readStatus();
        statusUnavailable = Boolean(status.error);
        if (!statusUnavailable && !status.running) return;
        lastEvidence = status.error
            ? `${status.error}${status.detail.trim() ? `：${status.detail.trim()}` : ""}`
            : status.detail.trim() || lastEvidence;
        if (attempt < attempts - 1) await sleep(intervalMs);
    }

    throw new Error(
        statusUnavailable
            ? `重试窗口结束时仍无法确认服务已停止（${lastEvidence}）`
            : `服务在重试窗口内仍处于运行状态（${lastEvidence}）`,
    );
}
