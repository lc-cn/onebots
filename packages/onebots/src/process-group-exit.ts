/** 只确认调用方已拥有的 POSIX 进程组；不发终止信号、不清理记录、不认领历史 PID。 */
export type ProcessGroupExit = "exited" | "timeout" | "unknown";
export async function waitForProcessGroupExit(
    pid: number,
    timeoutMs: number,
    intervalMs = 20,
): Promise<ProcessGroupExit> {
    if (
        process.platform === "win32" ||
        !Number.isSafeInteger(pid) ||
        pid <= 1 ||
        pid > 0x7fffffff ||
        !Number.isFinite(timeoutMs) ||
        timeoutMs < 0 ||
        timeoutMs > 300_000 ||
        !Number.isFinite(intervalMs) ||
        intervalMs <= 0
    )
        return "unknown";
    const deadline = performance.now() + timeoutMs;
    for (;;) {
        let permissionUnknown = false;
        try {
            process.kill(-pid, 0);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === "ESRCH") return "exited";
            // macOS 实测组退出窗口可先返回EPERM；继续等不等于把未知当作已退出。
            if (code !== "EPERM") return "unknown";
            permissionUnknown = true;
        }
        const remaining = deadline - performance.now();
        if (remaining <= 0) return permissionUnknown ? "unknown" : "timeout";
        await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remaining)));
    }
}
