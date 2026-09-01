import { ErrorCategory } from "onebots";
import { TeamsApiError } from "./errors.js";

type LifecycleCallback = () => Promise<void>;

/** 隔离 Teams Bot 的启动单飞、取消与迟到任务失效语义。 */
export class TeamsBotLifecycle {
    private startTask?: Promise<void>;
    private startAbort?: AbortController;
    private startSignal?: AbortSignal;
    private startSignalAbort?: () => void;
    private running = false;
    private generation = 0;

    constructor(
        private readonly onReady: LifecycleCallback,
        private readonly onStopped: LifecycleCallback,
    ) {}

    async start(signal?: AbortSignal): Promise<void> {
        if (signal?.aborted) throw this.cancelled(signal.reason);
        if (this.running) {
            this.bindSignal(signal);
            return;
        }
        if (this.startTask) return this.startTask;
        const generation = ++this.generation;
        const controller = new AbortController();
        this.startAbort = controller;
        this.bindSignal(signal);
        const task = this.startCurrent(generation, controller.signal).catch(error => {
            if (controller.signal.aborted || generation !== this.generation) {
                throw this.cancelled(error);
            }
            throw error;
        });
        this.startTask = task;
        try {
            await task;
        } finally {
            if (this.startTask === task) this.startTask = undefined;
            if (!this.running && this.startAbort === controller) {
                this.startAbort = undefined;
                this.unbindSignal();
            }
        }
    }

    async stop(): Promise<void> {
        const wasActive = this.running || Boolean(this.startTask);
        this.unbindSignal();
        this.generation += 1;
        this.running = false;
        this.startTask = undefined;
        this.startAbort?.abort(this.cancelled());
        this.startAbort = undefined;
        if (wasActive) await this.onStopped();
    }

    private async startCurrent(generation: number, signal: AbortSignal): Promise<void> {
        await this.onReady();
        if (generation !== this.generation || signal.aborted) throw this.cancelled();
        this.running = true;
    }

    private bindSignal(signal?: AbortSignal): void {
        this.unbindSignal();
        if (!signal) return;
        const abort = (): void => this.startAbort?.abort(this.cancelled(signal.reason));
        this.startSignal = signal;
        this.startSignalAbort = abort;
        signal.addEventListener("abort", abort, { once: true });
    }

    private unbindSignal(): void {
        if (this.startSignal && this.startSignalAbort) {
            this.startSignal.removeEventListener("abort", this.startSignalAbort);
        }
        this.startSignal = undefined;
        this.startSignalAbort = undefined;
    }

    private cancelled(cause?: unknown): TeamsApiError {
        return new TeamsApiError("Teams Agent 启动已取消", {
            code: "TEAMS_START_CANCELLED",
            category: ErrorCategory.NETWORK,
            cause,
        });
    }
}
