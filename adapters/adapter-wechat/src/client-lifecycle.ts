export interface WechatStartupAttempt {
    generation: number;
    controller: AbortController;
}

/** 管理微信公众号启动代次、内部取消器与 Account 传入的外部信号。 */
export class WechatClientLifecycle {
    private generation = 0;
    private controller?: AbortController;
    private startSignal?: AbortSignal;
    private startSignalAbort?: () => void;

    constructor(private readonly createCancelledError: (cause?: unknown) => Error) {}

    assertSignal(signal?: AbortSignal): void {
        if (signal?.aborted) throw this.cancelled(signal.reason);
    }

    begin(signal?: AbortSignal): WechatStartupAttempt {
        this.assertSignal(signal);
        const controller = new AbortController();
        this.controller = controller;
        this.bind(signal);
        return { generation: this.generation, controller };
    }

    bind(signal?: AbortSignal): void {
        this.unbind();
        if (!signal) return;
        const abort = (): void => {
            this.controller?.abort(this.cancelled(signal.reason));
        };
        this.startSignal = signal;
        this.startSignalAbort = abort;
        signal.addEventListener("abort", abort, { once: true });
    }

    finish(attempt: WechatStartupAttempt, running: boolean): void {
        if (running || this.controller !== attempt.controller) return;
        this.controller = undefined;
        this.unbind();
    }

    stop(): boolean {
        this.unbind();
        const controller = this.controller;
        this.generation += 1;
        this.controller = undefined;
        controller?.abort(this.cancelled());
        return Boolean(controller);
    }

    assertCurrent(attempt: WechatStartupAttempt): void {
        if (this.isCancelled(attempt)) throw this.cancelled();
    }

    isCancelled(attempt: WechatStartupAttempt): boolean {
        return attempt.generation !== this.generation || attempt.controller.signal.aborted;
    }

    cancelled(cause?: unknown): Error {
        return this.createCancelledError(cause);
    }

    private unbind(): void {
        if (this.startSignal && this.startSignalAbort) {
            this.startSignal.removeEventListener("abort", this.startSignalAbort);
        }
        this.startSignal = undefined;
        this.startSignalAbort = undefined;
    }
}
