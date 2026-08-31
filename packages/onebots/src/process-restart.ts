interface RestartableApplication {
    stop(): Promise<void>;
    logger: {
        error(message: string, context?: unknown): void;
    };
}

export interface ProcessRestartOptions {
    exitCode: number;
    delayMs?: number;
    stopTimeoutMs?: number;
    exit?: (code: number) => void;
}

const scheduledApplications = new WeakSet<object>();

/** 响应返回后只调度一次重启，先释放运行资源，并用超时保证守护进程最终可以接管。 */
export function scheduleProcessRestart(
    app: RestartableApplication,
    options: ProcessRestartOptions,
): boolean {
    if (scheduledApplications.has(app)) return false;
    scheduledApplications.add(app);
    const delayMs = options.delayMs ?? 1_500;
    const stopTimeoutMs = options.stopTimeoutMs ?? 30_000;
    const exit = options.exit ?? (code => process.exit(code));
    setTimeout(() => {
        void stopApplicationAndExit(app, options.exitCode, stopTimeoutMs, exit);
    }, delayMs);
    return true;
}

async function stopApplicationAndExit(
    app: RestartableApplication,
    exitCode: number,
    timeoutMs: number,
    exit: (code: number) => void,
): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;
    try {
        await Promise.race([
            app.stop(),
            new Promise<never>((_, reject) => {
                timeout = setTimeout(
                    () => reject(new Error(`优雅停机超过 ${timeoutMs}ms`)),
                    timeoutMs,
                );
            }),
        ]);
    } catch (error) {
        app.logger.error("服务重启前的优雅停机失败，将由守护进程强制切换实例", { error });
    } finally {
        if (timeout) clearTimeout(timeout);
        scheduledApplications.delete(app);
        exit(exitCode);
    }
}
