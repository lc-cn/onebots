export type RuntimeOperation =
    | "idle"
    | "configuration_reload"
    | "account_configuration"
    | "account_lifecycle"
    | "unknown";

export type ActiveRuntimeOperation = Exclude<RuntimeOperation, "idle" | "unknown">;

export interface RuntimeOperationHost {
    isReloading: boolean;
    runtimeOperation?: RuntimeOperation;
}

export interface RuntimeOperationLease {
    readonly operation: ActiveRuntimeOperation;
    release(): void;
}

const activeLeases = new WeakMap<RuntimeOperationHost, symbol>();

/**
 * 原子取得会撤销 readiness 的运行态租约。
 *
 * release 幂等，并用私有 token 防止过期释放误清理后续租约。调用方必须在取得租约后
 * 立即进入 try/finally，确保同步前置步骤与异步操作的全部失败路径都能恢复 readiness。
 */
export function acquireRuntimeOperation(
    host: RuntimeOperationHost,
    operation: ActiveRuntimeOperation,
    conflictError: (active: RuntimeOperation) => Error,
): RuntimeOperationLease {
    const existingLease = activeLeases.has(host);
    if (host.isReloading || existingLease) {
        throw conflictError(resolveCurrentOperation(host));
    }

    const token = Symbol(operation);
    activeLeases.set(host, token);
    host.isReloading = true;
    host.runtimeOperation = operation;
    let released = false;

    return Object.freeze({
        operation,
        release() {
            if (released) return;
            released = true;
            if (activeLeases.get(host) !== token) return;
            activeLeases.delete(host);
            host.runtimeOperation = "idle";
            host.isReloading = false;
        },
    });
}

function resolveCurrentOperation(host: RuntimeOperationHost): RuntimeOperation {
    if (!host.isReloading) return "unknown";
    const operation = host.runtimeOperation;
    return operation === "configuration_reload" ||
        operation === "account_configuration" ||
        operation === "account_lifecycle"
        ? operation
        : "unknown";
}
