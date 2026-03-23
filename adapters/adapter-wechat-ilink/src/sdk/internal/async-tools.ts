/** 可附带 AbortSignal 的固定延迟 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        if (!signal) return;
        signal.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
            },
            { once: true },
        );
    });
}

/**
 * 在 deadlineMs 后触发 abort；若外层 signal 已取消则联动。
 * 返回子 signal 与清理函数（务必在 finally 调用）。
 */
export function fuseAbortClock(deadlineMs: number, outer?: AbortSignal): { signal: AbortSignal; disarm: () => void } {
    const inner = new AbortController();
    const timer = setTimeout(() => inner.abort(new Error("timeout")), deadlineMs);

    if (outer) {
        outer.addEventListener(
            "abort",
            () => inner.abort(outer.reason instanceof Error ? outer.reason : new Error("aborted")),
            { once: true },
        );
    }

    return {
        signal: inner.signal,
        disarm: () => clearTimeout(timer),
    };
}
