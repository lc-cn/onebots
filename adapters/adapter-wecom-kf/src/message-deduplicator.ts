/** 微信客服消息 ID 的有界成功提交窗口。 */
export class KfMessageDeduplicator {
    private readonly messageIds = new Set<string>();
    private readonly limit: number;

    constructor(
        private readonly enabled: boolean,
        limit = 10_000,
    ) {
        this.limit = Math.max(100, limit);
    }

    has(messageId: string): boolean {
        return this.enabled && this.messageIds.has(messageId);
    }

    commit(messageId: string): void {
        if (!this.enabled) return;
        this.messageIds.add(messageId);
        while (this.messageIds.size > this.limit) {
            const oldest = this.messageIds.values().next().value;
            if (typeof oldest !== "string") return;
            this.messageIds.delete(oldest);
        }
    }
}
