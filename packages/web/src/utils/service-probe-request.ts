export const DEFAULT_SERVICE_PROBE_TIMEOUT_MS = 2_000;

export class ServiceProbeTimeoutError extends Error {
    constructor(readonly timeoutMs: number) {
        super(`服务探针超过 ${timeoutMs}ms 未响应`);
        this.name = "ServiceProbeTimeoutError";
    }
}

/** 为浏览器服务探针的请求与响应读取建立统一的有限等待边界。 */
export async function runServiceProbe<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs = DEFAULT_SERVICE_PROBE_TIMEOUT_MS,
): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new RangeError("服务探针超时必须是正数");
    }

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
            controller.abort();
            reject(new ServiceProbeTimeoutError(timeoutMs));
        }, timeoutMs);
    });

    try {
        return await Promise.race([operation(controller.signal), timeoutPromise]);
    } finally {
        if (timeout !== undefined) clearTimeout(timeout);
    }
}
