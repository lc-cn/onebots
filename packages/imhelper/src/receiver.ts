import type { Adapter } from "./adapter.js";
import { decodeIngressPayload } from "./ingress-payload.js";

export interface ReceiverLogger {
    debug(message: string, context?: unknown): void;
    error(message: string, error?: unknown): void;
}

export interface ReceiverOptions {
    logger?: ReceiverLogger;
}

export interface AuthenticatedReceiverOptions extends ReceiverOptions {
    accessToken?: string;
}

const silentLogger: ReceiverLogger = {
    debug: () => undefined,
    error: () => undefined,
};

export abstract class Receiver<Id extends string | number = string | number, TRawEvent = unknown> {
    protected readonly logger: ReceiverLogger;

    constructor(
        protected readonly adapter: Adapter<Id, TRawEvent>,
        logger: ReceiverLogger = silentLogger,
    ) {
        this.logger = logger;
    }

    /** 将已解码事件交给协议 Adapter；所有 Receiver 共用同一摄取路径。 */
    protected ingest(rawEvent: TRawEvent): void {
        this.adapter.transformEvent(rawEvent);
    }

    /** 解码并摄取单个 JSON 帧，统一载荷类型与大小限制。 */
    protected ingestPayload(payload: unknown): void {
        this.ingest(decodeIngressPayload(payload) as TRawEvent);
    }

    abstract connect(port?: number): Promise<void>;
    abstract disconnect(): Promise<void>;
}
