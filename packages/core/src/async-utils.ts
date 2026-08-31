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
