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
    createEventSource?: (url: URL) => SSEConnection;
}

const createDefaultEventSource = (url: URL): SSEConnection => {
    const EventSourceImplementation =
        typeof globalThis.EventSource === "function" ? globalThis.EventSource : NodeEventSource;
    return new EventSourceImplementation(url);
};

/** 通过 SSE 消费远端事件流。重连由 EventSource 实现负责，SDK 不叠加第二套计时器。 */
export class SSEReceiver<
    Id extends string | number = string | number,
    TRawEvent = unknown,
> extends Receiver<Id, TRawEvent> {
    #eventSource?: SSEConnection;

    constructor(
        adapter: Adapter<Id, TRawEvent>,
        public readonly url: string,
        private readonly options: SSEReceiverOptions = {},
    ) {
        super(adapter, options.logger);
    }

    async connect(_port?: number): Promise<void> {
        if (this.#eventSource) throw new Error("SSE Receiver 已启动");

        const url = new URL(this.url);
        if (this.options.accessToken) {
            url.searchParams.set("access_token", this.options.accessToken);
        }
        const eventSource = (this.options.createEventSource ?? createDefaultEventSource)(url);
        this.#eventSource = eventSource;

        await new Promise<void>((resolve, reject) => {
            eventSource.onopen = () => resolve();
            eventSource.onmessage = event => {
                try {
                    this.ingestPayload(event.data);
                } catch (error) {
                    this.logger.error("解析 SSE 事件失败", error);
                }
            };
            eventSource.onerror = error => {
                this.logger.error("SSE 连接错误", error);
                if (eventSource.readyState === 2) reject(error);
            };
        });
    }

    async disconnect(): Promise<void> {
        this.#eventSource?.close();
        this.#eventSource = undefined;
    }
}
