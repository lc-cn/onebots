export interface KookMessageContext {
    scene: "channel" | "direct";
    targetId?: string;
    chatCode?: string;
}

/** 保存当前进程收发过的消息场景，避免频道与私聊 API 误用。 */
export class KookMessageContextStore {
    private readonly contexts = new Map<string, KookMessageContext>();

    constructor(private readonly maximum = 4_096) {}

    remember(messageId: string, context: KookMessageContext): void {
        if (!messageId) return;
        this.contexts.delete(messageId);
        this.contexts.set(messageId, context);
        if (this.contexts.size <= this.maximum) return;
        const oldest = this.contexts.keys().next().value;
        if (typeof oldest === "string") this.contexts.delete(oldest);
    }

    get(messageId: string): KookMessageContext | undefined {
        return this.contexts.get(messageId);
    }
}
