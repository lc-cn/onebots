import { WhatsAppApiError } from "./errors.js";

/** 管理无长连接客户端的并发启动、取消和重启代次。 */
export class WhatsAppClientLifecycle<T extends object> {
    private startPromise?: Promise<T>;
    private generation = 0;
    private running = false;
    private value?: T;

    start(load: () => Promise<T>, onReady: (value: T) => void): Promise<T> {
        if (this.startPromise) return this.startPromise;
        if (this.running && this.value) return Promise.resolve({ ...this.value });
        const generation = ++this.generation;
        this.running = true;
        const start = this.load(generation, load, onReady);
        this.startPromise = start;
        const clear = (): void => {
            if (this.startPromise === start) this.startPromise = undefined;
        };
        void start.then(clear, clear);
        return start;
    }

    stop(): boolean {
        if (!this.running && !this.startPromise) return false;
        this.generation += 1;
        this.running = false;
        this.value = undefined;
        this.startPromise = undefined;
        return true;
    }

    private async load(
        generation: number,
        loader: () => Promise<T>,
        onReady: (value: T) => void,
    ): Promise<T> {
        try {
            const value = await loader();
            if (!this.running || generation !== this.generation) {
                throw new WhatsAppApiError("WhatsApp 启动已取消", {
                    code: "WHATSAPP_START_CANCELLED",
                });
            }
            this.value = { ...value };
            onReady(value);
            return value;
        } catch (error) {
            if (generation === this.generation) this.running = false;
            throw error;
        }
    }
}
