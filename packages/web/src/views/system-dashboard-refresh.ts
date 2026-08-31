export interface SystemDashboardRefreshTasks {
    refreshSystemInfo: () => Promise<void>;
    refreshServiceStatus: () => Promise<void>;
}

export interface SystemDashboardRefreshCoordinator {
    refreshAll: () => Promise<void>;
    refreshServiceStatus: () => Promise<void>;
}

function createSingleFlight(task: () => Promise<void>): () => Promise<void> {
    let running: Promise<void> | undefined;

    return () => {
        if (running) return running;

        let result: Promise<void>;
        try {
            result = task();
        } catch (error) {
            return Promise.reject(error);
        }
        const next = result.finally(() => {
            if (running === next) running = undefined;
        });
        running = next;
        return next;
    };
}

/** 合并自动与手动刷新，避免慢代理下重复请求同一份系统证据。 */
export function createSystemDashboardRefreshCoordinator(
    tasks: SystemDashboardRefreshTasks,
): SystemDashboardRefreshCoordinator {
    const refreshServiceStatus = createSingleFlight(tasks.refreshServiceStatus);
    const refreshAll = createSingleFlight(async () => {
        await Promise.all([tasks.refreshSystemInfo(), refreshServiceStatus()]);
    });
    return { refreshAll, refreshServiceStatus };
}
