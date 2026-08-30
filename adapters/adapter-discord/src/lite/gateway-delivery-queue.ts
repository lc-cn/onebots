import { DiscordError } from "../errors.js";

/** 串行化 Gateway Dispatch，并在失败后作废同一连接世代中已排队的事件。 */
export class DiscordGatewayDeliveryQueue {
    private tail: Promise<void> = Promise.resolve();
    private generation = 0;

    enqueue(deliver: () => Promise<void>): Promise<void> {
        const generation = this.generation;
        const delivery = this.tail.then(async () => {
            if (generation !== this.generation) {
                throw new DiscordError("Discord Gateway 旧 Dispatch 队列已失效", {
                    code: "DISCORD_GATEWAY_DISPATCH_STALE",
                });
            }
            await deliver();
        });
        const guarded = delivery.catch(error => {
            if (generation === this.generation) this.generation += 1;
            throw error;
        });
        this.tail = guarded.then(
            () => undefined,
            () => undefined,
        );
        return guarded;
    }

    async drain(): Promise<void> {
        await this.tail;
    }

    invalidate(): void {
        this.generation += 1;
    }
}
