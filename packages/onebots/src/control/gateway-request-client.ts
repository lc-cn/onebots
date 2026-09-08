import type { ChildProcess, Serializable } from "node:child_process";
import { randomUUID } from "node:crypto";
export class GatewayRequestError extends Error {
    constructor(
        public readonly outcome: "rejected" | "unknown",
        message: string,
    ) {
        super(message);
    }
}
export interface GatewayRequestCodec<T> {
    encode(requestId: string): unknown;
    decode(
        value: unknown,
        requestId: string,
    ): { ok: true; result: T } | { ok: false; error: Error } | undefined;
    errors: {
        unavailable: string;
        limit: string;
        invalid: string;
        timeout: string;
        send: string;
        closed: string;
    };
}
interface Pending {
    receive(value: unknown): boolean;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
    closedMessage: string;
}
/** 实际child共享一个关联器，不重试；调用结束不代表远端SDK已取消。 */
export class GatewayRequestClient {
    private readonly pending = new Map<string, Pending>();
    private closed = false;
    constructor(
        private readonly child: ChildProcess,
        private readonly timeoutMs = 30_000,
    ) {
        if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
            throw new Error("网关请求期限无效");
        child.on("message", this.onMessage);
        child.on("disconnect", this.onClosed);
        child.on("close", this.onClosed);
        child.on("error", this.onClosed);
    }
    request<T>(codec: GatewayRequestCodec<T>): Promise<T> {
        if (
            this.closed ||
            !this.child.connected ||
            this.child.exitCode !== null ||
            this.child.signalCode !== null
        )
            return Promise.reject(new GatewayRequestError("rejected", codec.errors.unavailable));
        if (this.pending.size >= 32)
            return Promise.reject(new GatewayRequestError("rejected", codec.errors.limit));
        const id = randomUUID();
        let message: unknown;
        try {
            message = codec.encode(id);
        } catch {
            return Promise.reject(new GatewayRequestError("rejected", codec.errors.invalid));
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => this.reject(id, new GatewayRequestError("unknown", codec.errors.timeout)),
                this.timeoutMs,
            );
            this.pending.set(id, {
                timer,
                reject,
                closedMessage: codec.errors.closed,
                receive: value => {
                    const result = codec.decode(value, id);
                    if (!result) return false;
                    if (result.ok === true) resolve(result.result);
                    else reject(result.error);
                    return true;
                },
            });
            try {
                this.child.send(message as Serializable, error => {
                    if (error)
                        this.reject(id, new GatewayRequestError("unknown", codec.errors.send));
                });
            } catch {
                this.reject(id, new GatewayRequestError("unknown", codec.errors.send));
            }
        });
    }
    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.child.off("message", this.onMessage);
        this.child.off("disconnect", this.onClosed);
        this.child.off("close", this.onClosed);
        this.child.off("error", this.onClosed);
        for (const [id, pending] of this.pending)
            this.reject(id, new GatewayRequestError("unknown", pending.closedMessage));
    }
    private readonly onClosed = () => this.close();
    private readonly onMessage = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        const descriptor = Object.getOwnPropertyDescriptor(value, "requestId");
        if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") return;
        const id = descriptor.value,
            pending = this.pending.get(id);
        if (!pending) return;
        try {
            if (pending.receive(value)) {
                this.pending.delete(id);
                clearTimeout(pending.timer);
            }
        } catch {
            /* 无效帧不能结束请求；最终超时仍报告执行结果未知。 */
        }
    };
    private reject(id: string, error: Error) {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(error);
    }
}
