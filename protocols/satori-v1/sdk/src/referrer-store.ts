const MAX_REFERRERS = 500;

function referrerKey(channelId: string | undefined, messageId: string): string {
    return `${channelId ?? ""}\0${messageId}`;
}

/**
 * 按频道和消息记住 event.referrer，供 reply 原样回传。
 * 上限只约束长期不回复的来源，避免进程无界增长；调用方仍可显式传入 referrer。
 */
export class MessageReferrerStore {
    readonly #entries = new Map<string, object>();

    remember(channelId: string | undefined, messageId: string, referrer: object): void {
        const key = referrerKey(channelId, messageId);
        this.#entries.delete(key);
        this.#entries.set(key, referrer);
        while (this.#entries.size > MAX_REFERRERS) {
            const oldest = this.#entries.keys().next().value;
            if (oldest === undefined) break;
            this.#entries.delete(oldest);
        }
    }

    recall(channelId: string | undefined, messageId: string): object | undefined {
        return this.#entries.get(referrerKey(channelId, messageId));
    }
}
