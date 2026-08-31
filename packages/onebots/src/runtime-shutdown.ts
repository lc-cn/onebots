export interface RuntimeShutdownApp {
    stop(): Promise<void>;
    enhancedLogger: {
        error(message: string, context?: unknown): void;
        fatal(message: string, context?: unknown): void;
    };
}

interface RuntimeShutdownTimer {
    unref(): unknown;
}

export interface RuntimeShutdownDependencies {
    setExitCode(code: number): void;
    exit(code: number): void;
    setTimer(callback: () => void, milliseconds: number): RuntimeShutdownTimer;
    clearTimer(timer: RuntimeShutdownTimer): void;
}

export interface RuntimeShutdownOptions {
    timeoutMs?: number;
    onBegin?: () => void;
}

const runtimeShutdownDependencies: RuntimeShutdownDependencies = {
    setExitCode(code) {
        process.exitCode = code;
    },
    exit(code) {
        process.exit(code);
    },
    setTimer(callback, milliseconds) {
        return setTimeout(callback, milliseconds);
    },
    clearTimer(timer) {
        clearTimeout(timer as NodeJS.Timeout);
    },
};

/** 协调进程信号停机；关闭失败时保留强制退出兜底，防止残留句柄永久阻塞。 */
export function createRuntimeShutdownCoordinator(
    app: RuntimeShutdownApp,
    options: RuntimeShutdownOptions = {},
    dependencies: RuntimeShutdownDependencies = runtimeShutdownDependencies,
) {
    const timeoutMs = options.timeoutMs ?? 30_000;
    let shutdownPromise: Promise<void> | null = null;
    let stopFailed = false;
    let forced = false;

    return {
        isShuttingDown: () => shutdownPromise !== null,
        shutdown(signal: NodeJS.Signals): Promise<void> {
            if (shutdownPromise) return shutdownPromise;
            options.onBegin?.();
            const forceTimer = dependencies.setTimer(() => {
                forced = true;
                app.enhancedLogger.fatal(
                    stopFailed
                        ? `优雅关闭失败后进程仍未退出，超过 ${timeoutMs}ms 后强制退出`
                        : `优雅关闭超过 ${timeoutMs}ms，强制退出`,
                );
                dependencies.exit(1);
            }, timeoutMs);
            forceTimer.unref();

            shutdownPromise = (async () => {
                try {
                    await app.stop();
                    if (forced) return;
                    dependencies.clearTimer(forceTimer);
                    dependencies.setExitCode(0);
                } catch (error) {
                    stopFailed = true;
                    app.enhancedLogger.error(`${signal} 关闭失败`, { error });
                    dependencies.setExitCode(1);
                    // 不取消 forceTimer：关闭失败可能留下活动句柄，必须保留有界退出。
                }
            })();
            return shutdownPromise;
        },
    };
}
