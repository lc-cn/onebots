import type { Adapter } from "./adapter.js";
import type { Receiver, ReceiverLogger } from "./receiver.js";
import { SSEReceiver, type SSEReceiverOptions } from "./receivers/sse.js";
import { WebhookReceiver } from "./receivers/webhook.js";
import { WebSocketReceiver, type WebSocketReceiverOptions } from "./receivers/ws.js";
import { WSSReceiver } from "./receivers/wss.js";

export type NetworkReceiveMode = "ws" | "wss" | "webhook" | "sse";
export type ReceiveMode = NetworkReceiveMode | "manual";
export type ReceiveEndpoints = Partial<Record<NetworkReceiveMode, string>>;

export interface ReceiveTransportOptions {
    mode: ReceiveMode;
    /** 各接收方式对应的事件 URL 或本地监听路径。manual 模式不需要。 */
    endpoints?: ReceiveEndpoints;
    accessToken?: string;
    /** 所有接收方式共用的日志出口；未提供时保持静默。 */
    logger?: ReceiverLogger;
    webSocket?: Omit<WebSocketReceiverOptions, "accessToken">;
    sse?: Omit<SSEReceiverOptions, "accessToken" | "logger">;
}

/**
 * 统一管理 SDK 的事件接收方式与生命周期。
 * 协议适配器只负责给出规范端点，不再持有 Receiver 联合类型或重复连接分支。
 */
export class ReceiveTransport<Id extends string | number = string | number, TRawEvent = unknown> {
    readonly #mode: ReceiveMode;
    readonly #receiver?: Receiver<Id, TRawEvent>;

    constructor(adapter: Adapter<Id, TRawEvent>, options: ReceiveTransportOptions) {
        this.#mode = options.mode;
        if (options.mode === "manual") return;
        const endpoint = options.endpoints?.[options.mode];
        if (!endpoint) throw new TypeError(`${options.mode} 接收模式缺少事件端点`);
        const logger = options.logger ?? options.webSocket?.logger;

        switch (options.mode) {
            case "ws":
                this.#receiver = new WebSocketReceiver(adapter, endpoint, {
                    ...options.webSocket,
                    accessToken: options.accessToken,
                    logger,
                });
                break;
            case "wss":
                this.#receiver = new WSSReceiver(adapter, endpoint, {
                    accessToken: options.accessToken,
                    logger,
                });
                break;
            case "webhook":
                this.#receiver = new WebhookReceiver(adapter, endpoint, {
                    accessToken: options.accessToken,
                    logger,
                });
                break;
            case "sse":
                this.#receiver = new SSEReceiver(adapter, endpoint, {
                    ...options.sse,
                    accessToken: options.accessToken,
                    logger,
                });
                break;
        }
    }

    async connect(port?: number): Promise<void> {
        if (!this.#receiver) return;
        if (this.#mode === "wss" || this.#mode === "webhook") {
            await this.#receiver.connect(port ?? 8080);
            return;
        }
        await this.#receiver.connect();
    }

    async disconnect(): Promise<void> {
        await this.#receiver?.disconnect();
    }
}
