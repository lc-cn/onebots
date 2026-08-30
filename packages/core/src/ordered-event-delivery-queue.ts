import { ValidationError } from "./errors.js";

const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

export interface EventDeliveryRetry<TEvent> {
    event: TEvent;
    error: unknown;
    /** 当前事件已经失败的次数，从 1 开始。 */
    attempt: number;
    delayMs: number;
    /** 包含当前事件在内、仍等待成功投递的事件数。 */
    pending: number;
}

export interface OrderedEventDeliveryQueueOptions<TEvent> {
    dispatch(event: TEvent, signal: AbortSignal): void | PromiseLike<void>;
    retryDelaysMs?: readonly number[];
    backlogWarningThreshold?: number;
    onRetry?(retry: EventDeliveryRetry<TEvent>): void;
    onBacklog?(pending: number): void;
    /** 仅用于替换计时机制；实现必须在 signal 中止后尽快结束。 */
    sleep?(delayMs: number, signal: AbortSignal): Promise<void>;
}

interface QueueEntry<TEvent> {
    event: TEvent;
    resolve(delivered: boolean): void;
}

interface QueueGeneration<TEvent> {
    readonly id: number;
    readonly controller: AbortController;
    readonly entries: QueueEntry<TEvent>[];
    cursor: number;
    draining: boolean;
    nextBacklogWarning: number;
}

/**
 * 将无法提供异步背压的事件源闭合为有序、可重试的业务投递链。
 *
 * 队列不设置会丢事件的硬上限：上游若已经在业务确认前提交游标，溢出时断线或丢弃
 * 都无法恢复。调用方应通过 `onBacklog` 观测积压，并在源头降低事件速率。
 * `stop()` 会取消当前代次的重试等待并以 `false` 结束尚未交付的 enqueue Promise；
 * 新代次不需要等待旧代次中无法取消的业务 Promise。
 */
export class OrderedEventDeliveryQueue<TEvent> {
    private readonly retryDelaysMs: readonly number[];
    private readonly backlogWarningThreshold: number;
    private readonly sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
    private generationId = 0;
    private generation?: QueueGeneration<TEvent>;

    constructor(private readonly options: OrderedEventDeliveryQueueOptions<TEvent>) {
        this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
        this.backlogWarningThreshold = options.backlogWarningThreshold ?? 1_000;
        this.sleep = options.sleep ?? abortableSleep;
        if (
            this.retryDelaysMs.length === 0 ||
            this.retryDelaysMs.some(delay => !Number.isFinite(delay) || delay < 0)
        ) {
            throw new ValidationError("retryDelaysMs 必须包含非负有限数值");
        }
        if (
            !Number.isSafeInteger(this.backlogWarningThreshold) ||
            this.backlogWarningThreshold <= 0
        ) {
            throw new ValidationError("backlogWarningThreshold 必须是正安全整数");
        }
    }

    get pending(): number {
        const generation = this.generation;
        return generation ? generation.entries.length - generation.cursor : 0;
    }

    /** 开始一个独立投递代次；重复调用不会重置正在工作的代次。 */
    start(): void {
        if (this.generation) return;
        this.generation = {
            id: ++this.generationId,
            controller: new AbortController(),
            entries: [],
            cursor: 0,
            draining: false,
            nextBacklogWarning: this.backlogWarningThreshold,
        };
    }

    /**
     * 停止当前代次。返回 `false` 的事件没有完成业务投递，调用方不得据此提交上游 ACK。
     */
    stop(): void {
        const generation = this.generation;
        if (!generation) return;
        this.generation = undefined;
        generation.controller.abort();
        for (let index = generation.cursor; index < generation.entries.length; index += 1) {
            generation.entries[index].resolve(false);
        }
        generation.entries.length = 0;
        generation.cursor = 0;
    }

    /** 按入队顺序交付事件；成功返回 true，代次停止或尚未启动时返回 false。 */
    enqueue(event: TEvent): Promise<boolean> {
        const generation = this.generation;
        if (!generation) return Promise.resolve(false);
        const delivery = new Promise<boolean>(resolve => {
            generation.entries.push({ event, resolve });
        });
        this.reportBacklog(generation);
        this.startDrain(generation);
        return delivery;
    }

    private startDrain(generation: QueueGeneration<TEvent>): void {
        if (generation.draining) return;
        generation.draining = true;
        // drainGeneration 捕获业务投递与重试错误，不会产生游离 rejection。
        void this.drainGeneration(generation);
    }

    private async drainGeneration(generation: QueueGeneration<TEvent>): Promise<void> {
        try {
            while (this.isCurrent(generation) && generation.cursor < generation.entries.length) {
                const entry = generation.entries[generation.cursor];
                const delivered = await this.deliverEntry(generation, entry);
                if (!delivered || !this.isCurrent(generation)) return;
                entry.resolve(true);
                generation.cursor += 1;
                this.compact(generation);
                if (generation.entries.length - generation.cursor < this.backlogWarningThreshold) {
                    generation.nextBacklogWarning = this.backlogWarningThreshold;
                }
            }
        } finally {
            generation.draining = false;
            if (this.isCurrent(generation) && generation.cursor < generation.entries.length) {
                this.startDrain(generation);
            }
        }
    }

    private async deliverEntry(
        generation: QueueGeneration<TEvent>,
        entry: QueueEntry<TEvent>,
    ): Promise<boolean> {
        let attempt = 0;
        while (this.isCurrent(generation)) {
            try {
                await this.options.dispatch(entry.event, generation.controller.signal);
                return this.isCurrent(generation);
            } catch (error) {
                if (!this.isCurrent(generation)) return false;
                attempt += 1;
                const delayMs =
                    this.retryDelaysMs[Math.min(attempt - 1, this.retryDelaysMs.length - 1)];
                this.options.onRetry?.({
                    event: entry.event,
                    error,
                    attempt,
                    delayMs,
                    pending: generation.entries.length - generation.cursor,
                });
                await this.sleep(delayMs, generation.controller.signal);
            }
        }
        return false;
    }

    private reportBacklog(generation: QueueGeneration<TEvent>): void {
        const pending = generation.entries.length - generation.cursor;
        if (pending < generation.nextBacklogWarning) return;
        this.options.onBacklog?.(pending);
        while (generation.nextBacklogWarning <= pending) {
            generation.nextBacklogWarning *= 2;
        }
    }

    private compact(generation: QueueGeneration<TEvent>): void {
        if (generation.cursor < 1_024 || generation.cursor * 2 < generation.entries.length) return;
        generation.entries.splice(0, generation.cursor);
        generation.cursor = 0;
    }

    private isCurrent(generation: QueueGeneration<TEvent>): boolean {
        return this.generation === generation && !generation.controller.signal.aborted;
    }
}

function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        if (signal.aborted || delayMs === 0) return resolve();
        const timer = setTimeout(resolve, delayMs);
        signal.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
    });
}
