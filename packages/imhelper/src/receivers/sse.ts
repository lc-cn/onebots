import { EventSource as NodeEventSource } from "eventsource";
import type { Adapter } from "../adapter.js";
import { Receiver, type AuthenticatedReceiverOptions } from "../receiver.js";

export interface SSEConnection {
    readonly readyState: number;
    onopen: ((event: Event) => unknown) | null;
    onmessage: ((event: MessageEvent<string>) => unknown) | null;
    onerror: ((event: Event) => unknown) | null;
    close(): void;
}

export interface SSEReceiverOptions extends AuthenticatedReceiverOptions {
    /** 取消尚未建立或仍在运行的 SSE 连接。 */
    signal?: AbortSignal;
    createEventSource?: (url: URL) => SSEConnection;
}

const createDefaultEventSource = (url: URL): SSEConnection => {
    const EventSourceImplementation =
        typeof globalThis.EventSource === "function" ? globalThis.EventSource : NodeEventSource;
    return new EventSourceImplementation(url);
};

function abortError(): Error {
    const error = new Error("SSE 连接已取消");
    error.name = "AbortError";
    return error;
}

/** 通过 SSE 消费远端事件流。重连由 EventSource 实现负责，SDK 不叠加第二套计时器。 */
export class SSEReceiver<
    Id extends string | number = string | number,
    TRawEvent = unknown,
> extends Receiver<Id, TRawEvent> {
    #eventSource?: SSEConnection;
    #pendingConnectReject?: (error: Error) => void;
    readonly #abortListener = (): void => {
        void this.disconnect();
    };

    constructor(
        adapter: Adapter<Id, TRawEvent>,
        public readonly url: string,
        private readonly options: SSEReceiverOptions = {},
    ) {
        super(adapter, options.logger);
    }

    async connect(_port?: number): Promise<void> {
        if (this.#eventSource) throw new Error("SSE Receiver 已启动");
        if (this.options.signal?.aborted) throw abortError();

        const url = new URL(this.url);
        if (this.options.accessToken) {
            url.searchParams.set("access_token", this.options.accessToken);
        }
        const eventSource = (this.options.createEventSource ?? createDefaultEventSource)(url);
        this.#eventSource = eventSource;
        this.options.signal?.addEventListener("abort", this.#abortListener, { once: true });

        await new Promise<void>((resolve, reject) => {
            const rejectConnect = (error: Error): void => {
                if (this.#pendingConnectReject !== rejectConnect) return;
                this.#pendingConnectReject = undefined;
                reject(error);
            };
            this.#pendingConnectReject = rejectConnect;

            eventSource.onopen = () => {
                if (this.#eventSource !== eventSource) return;
                this.#pendingConnectReject = undefined;
                resolve();
            };
            eventSource.onmessage = event => {
                if (this.#eventSource !== eventSource) return;
                try {
                    this.ingestPayload(event.data);
                } catch (error) {
                    this.logger.error("解析 SSE 事件失败", error);
                }
            };
            eventSource.onerror = error => {
                if (this.#eventSource !== eventSource) return;
                this.logger.error("SSE 连接错误", error);
                if (eventSource.readyState === 2) {
                    this.#release(eventSource);
                    rejectConnect(new Error("SSE 连接已关闭", { cause: error }));
                }
            };
        });
    }

    async disconnect(): Promise<void> {
        const eventSource = this.#eventSource;
        if (eventSource) this.#release(eventSource);
        const rejectConnect = this.#pendingConnectReject;
        rejectConnect?.(abortError());
    }

    #release(eventSource: SSEConnection): void {
        if (this.#eventSource !== eventSource) return;
        this.#eventSource = undefined;
        this.options.signal?.removeEventListener("abort", this.#abortListener);
        eventSource.onopen = null;
        eventSource.onmessage = null;
        eventSource.onerror = null;
        eventSource.close();
    }
}
