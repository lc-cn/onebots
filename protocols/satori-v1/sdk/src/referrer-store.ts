const MAX_REFERRERS = 500;

/** 按消息 ID 记住最近的 event.referrer，供 reply 原样回传。 */
export class MessageReferrerStore {
    readonly #entries = new Map<string, object>();

    remember(messageId: string, referrer: object): void {
        this.#entries.delete(messageId);
        this.#entries.set(messageId, referrer);
        while (this.#entries.size > MAX_REFERRERS) {
            const oldest = this.#entries.keys().next().value;
            if (oldest === undefined) break;
            this.#entries.delete(oldest);
        }
    }

    recall(messageId: string): object | undefined {
        return this.#entries.get(messageId);
    }
}
