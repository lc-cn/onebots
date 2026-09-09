import {
    isControlSendContext,
    type ControlSendContext,
    type ControlSendOperation,
    type ControlSendRequest,
} from "@onebots/core/control";
import {
    ControlSendError,
    parseSendRequest,
    projectSend,
    sendDigest,
    sendHash,
    type SendRecord,
} from "./send-contracts.js";
import { closedServiceObject } from "../service-operation-storage.js";
import { ControlSendStore } from "./send-store.js";
import { GatewayRequestError } from "./gateway-request-client.js";
import type { PersistedOperationObserver } from "../persisted-operation-observer.js";
export { ControlSendError } from "./send-contracts.js";
export interface ControlSendServiceOptions {
    directory: string;
    currentContext(): ControlSendContext | undefined;
    forward(request: ControlSendRequest): Promise<{ messageId: string | null }>;
    onOperation?: PersistedOperationObserver;
}
export class ControlSendService {
    private readonly store: ControlSendStore;
    private active = 0;
    private closed = false;
    private readonly pending = new Set<Promise<ControlSendOperation>>();
    constructor(private readonly options: ControlSendServiceOptions) {
        this.store = new ControlSendStore(options.directory, options.onOperation);
    }
    health() {
        return this.store.health();
    }
    context(): ControlSendContext {
        try {
            const value = this.options.currentContext();
            if (!isControlSendContext(value)) throw new ControlSendError(503);
            return structuredClone(value);
        } catch {
            throw new ControlSendError(503);
        }
    }
    /** 本机管理员可只读恢复旧设备的回执；不能借此重新派发或更改操作归属。 */
    operation(ownerHash: string, id: string, localRecovery = false): ControlSendOperation {
        if (!sendHash(ownerHash)) throw new ControlSendError(400);
        const record = this.store.read(id);
        if (!localRecovery && record.ownerHash !== ownerHash) throw new ControlSendError(404);
        return projectSend(record);
    }
    send(ownerHash: string, input: unknown): Promise<ControlSendOperation> {
        if (this.closed) return Promise.reject(new ControlSendError(503));
        const operation = this.execute(ownerHash, input);
        this.pending.add(operation);
        void operation.then(
            () => this.pending.delete(operation),
            () => this.pending.delete(operation),
        );
        return operation;
    }
    async close(): Promise<void> {
        this.closed = true;
        await Promise.allSettled([...this.pending]);
    }
    private async execute(ownerHash: string, input: unknown): Promise<ControlSendOperation> {
        if (!sendHash(ownerHash)) throw new ControlSendError(400);
        const request = parseSendRequest(input),
            requestDigest = sendDigest(request);
        let previous: SendRecord | undefined;
        try {
            previous = this.store.read(request.id);
        } catch (error) {
            if (!(error instanceof ControlSendError) || error.httpStatus !== 404) throw error;
        }
        if (previous) {
            if (previous.ownerHash !== ownerHash) throw new ControlSendError(404);
            if (previous.requestDigest !== requestDigest) throw new ControlSendError(409);
            return projectSend(previous);
        }
        if (!this.store.health().available) throw new ControlSendError(503);
        if (this.active >= 8) throw new ControlSendError(429);
        const context = this.context();
        if (
            !context ||
            context.gatewayInstanceId !== request.expected.gatewayInstanceId ||
            context.configVersion !== request.expected.configVersion
        )
            throw new ControlSendError(409);
        const record: SendRecord = {
            schemaVersion: 1,
            id: request.id,
            ownerHash,
            requestDigest,
            ...request.expected,
            status: "running",
            startedAt: new Date().toISOString(),
        };
        this.store.create(record);
        this.active++;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let completed: SendRecord;
        try {
            const result = await Promise.race([
                this.options.forward(request),
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(() => reject(new Error()), 30000);
                    timer.unref();
                }),
            ]);
            const resultRecord = closedServiceObject(result, ["messageId"]);
            if (
                !resultRecord ||
                typeof result !== "object" ||
                Object.keys(result).length !== 1 ||
                !Object.hasOwn(result, "messageId") ||
                (result.messageId !== null &&
                    (typeof result.messageId !== "string" ||
                        result.messageId.length > 4096 ||
                        /[\u0000-\u001f\u007f]/.test(result.messageId)))
            )
                throw new Error();
            completed = {
                ...record,
                status: "succeeded",
                finishedAt: new Date().toISOString(),
                messageId: result.messageId,
            };
        } catch (error) {
            completed = {
                ...record,
                status:
                    error instanceof GatewayRequestError && error.outcome === "rejected"
                        ? "rejected"
                        : "unknown",
                finishedAt: new Date().toISOString(),
            };
        } finally {
            if (timer) clearTimeout(timer);
            this.active--;
        }
        this.store.finish(completed);
        return projectSend(completed);
    }
}
