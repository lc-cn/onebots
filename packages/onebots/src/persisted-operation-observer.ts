export interface PersistedOperationProjection {
    id: string;
    action: string;
    status: string;
    phase?: string;
    finishedAt?: string;
}

export type PersistedOperationObserver = (operation: PersistedOperationProjection) => void;

/** 可观察性只能读取固定投影；失败不得改变已经持久化的业务结果。 */
export function observePersistedOperation(
    observer: PersistedOperationObserver | undefined,
    operation: PersistedOperationProjection,
): void {
    try {
        observer?.({
            id: operation.id,
            action: operation.action,
            status: operation.status,
            ...(operation.phase ? { phase: operation.phase } : {}),
            ...(operation.finishedAt ? { finishedAt: operation.finishedAt } : {}),
        });
    } catch {
        // 日志不可用时仍以原 journal 为事实来源。
    }
}

export function observeNamedPersistedOperation(
    observer: PersistedOperationObserver | undefined,
    action: string,
    operation: Omit<PersistedOperationProjection, "action">,
): void {
    observePersistedOperation(observer, {
        id: operation.id,
        action,
        status: operation.status,
        ...(operation.phase ? { phase: operation.phase } : {}),
        ...(operation.finishedAt ? { finishedAt: operation.finishedAt } : {}),
    });
}

/** 系统服务 journal 的统一固定投影；调用方不能把私有事务正文传给日志。 */
export function observeManagerServiceOperation(
    observer: PersistedOperationObserver | undefined,
    operation: {
        id: string;
        action: "start" | "stop" | "restart" | "install" | "uninstall" | "upgrade";
        status: string;
        phase: string;
    },
): void {
    observeNamedPersistedOperation(observer, `manager-service.${operation.action}`, {
        id: operation.id,
        status: operation.status,
        phase: operation.phase,
    });
}

/** 旧服务迁移备份只留在私有 journal，控制日志只能看到迁移状态。 */
export function observeServiceMigrationOperation(
    observer: PersistedOperationObserver | undefined,
    operation: { id: string; status: string; phase: string },
): void {
    observeNamedPersistedOperation(observer, "manager-service.migrate", {
        id: operation.id,
        status: operation.status,
        phase: operation.phase,
    });
}
