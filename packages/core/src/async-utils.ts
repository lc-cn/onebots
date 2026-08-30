import type { EventEmitter } from "node:events";
import { ValidationError } from "./errors.js";

export interface RefreshableValueResult<T> {
    value: T;
    /** 当前值从加载完成开始可使用的毫秒数。 */
    ttlMs: number;
}

/**
 * 带提前刷新、单航班加载和代次安全失效的异步值缓存。
 *
 * `invalidate(expected)` 只清除调用方实际使用过的值，避免旧请求的迟到错误
 * 抹掉并发请求已经刷新的新凭证。
 */
export class RefreshableValue<T> {
    private cached?: { value: T; expiresAt: number };
    private pending?: Promise<T>;
    private generation = 0;

    constructor(
        private readonly refreshMarginMs = 0,
        private readonly now: () => number = Date.now,
    ) {
        if (!Number.isFinite(refreshMarginMs) || refreshMarginMs < 0) {
            throw new ValidationError("refreshMarginMs 必须是非负有限数值");
        }
    }

    get(loader: () => Promise<RefreshableValueResult<T>>, force = false): Promise<T> {
        if (!force && this.cached && this.now() < this.cached.expiresAt - this.refreshMarginMs) {
            return Promise.resolve(this.cached.value);
        }
        if (this.pending) return this.pending;
        const generation = this.generation;
        const request = Promise.resolve()
            .then(loader)
            .then(result => {
                if (!Number.isFinite(result.ttlMs) || result.ttlMs <= 0) {
                    throw new ValidationError("RefreshableValue loader 必须返回正数 ttlMs");
                }
                if (generation === this.generation) {
                    this.cached = { value: result.value, expiresAt: this.now() + result.ttlMs };
                }
                return result.value;
            });
        this.pending = request;
        return request.finally(() => {
            if (this.pending === request) this.pending = undefined;
        });
    }

    invalidate(expected: T): boolean {
        if (!this.cached || !Object.is(this.cached.value, expected)) return false;
        this.cached = undefined;
        return true;
    }

    clear(): void {
        this.generation += 1;
        this.cached = undefined;
        this.pending = undefined;
    }
}

/**
 * 依照 Node EventEmitter 的注册顺序执行并等待所有监听器。
 *
 * 原生 `emit()` 不会等待异步监听器；Webhook 若直接使用它，可能在业务处理失败前
 * 就确认成功。该函数保留 EventEmitter 的顺序和异常语义，同时闭合异步投递。
 */
export async function emitAwaited<TArgs extends readonly unknown[]>(
    emitter: Pick<EventEmitter, "rawListeners">,
    eventName: string | symbol,
    ...args: TArgs
): Promise<void> {
    for (const listener of emitter.rawListeners(eventName)) {
        await Promise.resolve((listener as (...values: TArgs) => unknown)(...args));
    }
}

/** 按键合并同时进行的相同工作；任务结束后立即释放，不承担结果缓存。 */
export class KeyedSingleFlight<TKey, TResult> {
    private readonly pending = new Map<TKey, Promise<TResult>>();

    run(key: TKey, task: () => TResult | PromiseLike<TResult>): Promise<TResult> {
        const existing = this.pending.get(key);
        if (existing) return existing;
        const request = Promise.resolve().then(task);
        const tracked = request.finally(() => {
            if (this.pending.get(key) === tracked) this.pending.delete(key);
        });
        this.pending.set(key, tracked);
        return tracked;
    }

    clear(): void {
        this.pending.clear();
    }
}

/** 按输入顺序返回结果，并将同时执行的 mapper 数量限制在明确上限内。 */
export async function mapConcurrent<TInput, TOutput>(
    values: readonly TInput[],
    concurrency: number,
    mapper: (value: TInput, index: number) => TOutput | PromiseLike<TOutput>,
): Promise<TOutput[]> {
    if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
        throw new ValidationError("concurrency 必须是正整数");
    }
    const results = new Array<TOutput>(values.length);
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < values.length) {
            const index = next++;
            results[index] = await mapper(values[index]!, index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
    return results;
}
