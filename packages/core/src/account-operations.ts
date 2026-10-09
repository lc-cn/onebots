import { ResourceError } from "./errors.js";
import { AsyncLocalStorage } from "node:async_hooks";

interface OperationState {
    active: Set<Promise<unknown>>;
    blockers: Set<symbol>;
    admitted: Set<symbol>;
    closed: boolean;
}

const states = new WeakMap<object, OperationState>();
const contexts = new AsyncLocalStorage<{ account: object; token: symbol }>();
const stateFor = (account: object): OperationState => {
    let state = states.get(account);
    if (!state) {
        state = { active: new Set(), blockers: new Set(), admitted: new Set(), closed: false };
        states.set(account, state);
    }
    return state;
};

export class AccountOperationRejectedError extends ResourceError {
    constructor() {
        super("账号配置正在变更，操作未受理，请稍后重试");
        this.name = "AccountOperationRejectedError";
    }
}

export interface AccountOperationDrain {
    settled(timeoutMs: number): Promise<void>;
    release(): void;
}

/** 先取得租约再执行 SDK 调用；拒绝仅表示尚未执行，不重试外部操作。 */
export function runAccountOperation<T>(
    account: object,
    operation: () => T | Promise<T>,
): Promise<T> {
    const state = stateFor(account);
    const parent = contexts.getStore();
    const reentrant = parent?.account === account && state.admitted.has(parent.token);
    if (state.closed || (state.blockers.size && !reentrant))
        return Promise.reject(new AccountOperationRejectedError());
    const token = Symbol("account-operation");
    state.admitted.add(token);
    let resolvePending!: (value: T | PromiseLike<T>) => void;
    let rejectPending!: (reason: unknown) => void;
    const pending = new Promise<T>((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
    });
    state.active.add(pending);
    // 先公布租约，再同步启动回调：保持原 dispatch 的投递起始时序，同时覆盖回调重入。
    try {
        resolvePending(contexts.run({ account, token }, operation));
    } catch (error) {
        rejectPending(error);
    }
    return pending.finally(() => {
        state.active.delete(pending);
        state.admitted.delete(token);
    });
}

/** 停止后的旧实例不可在路由被替换后继续调用新账号连接。 */
export function closeAccountOperations(account: object): void {
    stateFor(account).closed = true;
}

/** 候选账号首次启动时开启入口；Account.stop 后禁止复用旧生命周期。 */
export function openAccountOperations(account: object): void {
    stateFor(account).closed = false;
}

/** 同步关闭新操作入口；所有受影响账号先取得此屏障，再等待旧操作排空。 */
export function beginAccountOperationDrain(account: object): AccountOperationDrain {
    const state = stateFor(account);
    const token = Symbol("account-drain");
    state.blockers.add(token);
    return {
        async settled(timeoutMs) {
            let timer: NodeJS.Timeout | undefined;
            try {
                await Promise.race([
                    (async () => {
                        // 已准入协议 API 可继续嵌套发送；必须排空后来出现的内层租约。
                        while (state.active.size) await Promise.allSettled([...state.active]);
                    })(),
                    new Promise<never>((_, reject) => {
                        timer = setTimeout(
                            () => reject(new AccountOperationRejectedError()),
                            timeoutMs,
                        );
                        timer.unref?.();
                    }),
                ]);
            } finally {
                if (timer) clearTimeout(timer);
            }
        },
        release() {
            state.blockers.delete(token);
        },
    };
}
