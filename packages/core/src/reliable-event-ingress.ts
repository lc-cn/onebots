import { RecentEventDeduplicator } from "./recent-event-deduplicator.js";

/** 可靠事件入口用于查询和提交已成功投递的事件身份。 */
export interface EventDeliveryStore<TKey> {
    has(key: TKey): boolean;
    commit(key: TKey): void;
}

/**
 * 合并并发重投，并且只在业务投递完整成功后提交事件身份。
 *
 * 首个调用返回 `true`；等待同一次投递的并发调用以及后续重投返回 `false`。
 * 投递失败会原样传播给全部等待者，且不会污染去重状态。
 */
export class ReliableEventIngress<TKey> {
    private readonly pending = new Map<TKey, Promise<void>>();

    constructor(
        private readonly delivered: EventDeliveryStore<TKey> = new RecentEventDeduplicator<TKey>(),
    ) {}

    async deliver(key: TKey, dispatch: () => void | PromiseLike<void>): Promise<boolean> {
        if (this.delivered.has(key)) return false;
        const pending = this.pending.get(key);
        if (pending) {
            await pending;
            return false;
        }

        let resolve!: (value?: void | PromiseLike<void>) => void;
        let reject!: (reason?: unknown) => void;
        const delivery = new Promise<void>((done, fail) => {
            resolve = done;
            reject = fail;
        });
        // 先发布占位再同步启动业务逻辑，既闭合并发窗口，也不改变既有入口的启动时序。
        this.pending.set(key, delivery);
        try {
            resolve(Promise.resolve(dispatch()).then(() => this.delivered.commit(key)));
        } catch (error) {
            reject(error);
        }
        try {
            await delivery;
            return true;
        } finally {
            if (this.pending.get(key) === delivery) this.pending.delete(key);
        }
    }
}
