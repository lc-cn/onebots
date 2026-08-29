import type { DiscordInteractionResponse } from "../types.js";

interface CachedInteractionResponse {
    committedAt: number;
    response: DiscordInteractionResponse;
}

/** Discord 重投必须获得首次成功处理生成的同一 callback。 */
export class InteractionResponseCache {
    private readonly entries = new Map<string, CachedInteractionResponse>();
    private readonly pending = new Map<string, Promise<DiscordInteractionResponse>>();

    constructor(
        private readonly ttlMs = 10 * 60_000,
        private readonly maxEntries = 4_096,
    ) {}

    get(interactionId: string): DiscordInteractionResponse | undefined {
        const now = Date.now();
        this.prune(now);
        const entry = this.entries.get(interactionId);
        return entry ? structuredClone(entry.response) : undefined;
    }

    commit(interactionId: string, response: DiscordInteractionResponse): void {
        this.entries.delete(interactionId);
        this.entries.set(interactionId, {
            committedAt: Date.now(),
            response: structuredClone(response),
        });
        this.prune(Date.now());
    }

    /** 同一 Interaction 并发重投共享一次业务执行；失败不会写入缓存。 */
    async run(
        interactionId: string,
        handler: () => Promise<DiscordInteractionResponse>,
    ): Promise<DiscordInteractionResponse> {
        const cached = this.get(interactionId);
        if (cached) return cached;
        const pending = this.pending.get(interactionId);
        if (pending) return structuredClone(await pending);

        const execution = handler().then(response => {
            this.commit(interactionId, response);
            return response;
        });
        this.pending.set(interactionId, execution);
        try {
            return structuredClone(await execution);
        } finally {
            if (this.pending.get(interactionId) === execution) this.pending.delete(interactionId);
        }
    }

    private prune(now: number): void {
        for (const [interactionId, entry] of this.entries) {
            if (this.entries.size <= this.maxEntries && now - entry.committedAt <= this.ttlMs)
                break;
            this.entries.delete(interactionId);
        }
    }
}
