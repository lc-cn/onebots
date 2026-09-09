import {
    isGatewayMessageDebugReply,
    type GatewayMessageDebugReply,
} from "../gateway/message-debug-contracts.js";
import { GatewayRequestError } from "./gateway-request-client.js";
import { closedServiceObject } from "../service-operation-storage.js";
import type { MessageDebugEntry, MessageDebugClearReceipt } from "../gateway/message-debug-types.js";

export class ControlMessageDebugError extends Error {
    constructor(
        public readonly httpStatus: number,
        public readonly outcome: "rejected" | "unknown",
    ) {
        super(
            outcome === "unknown"
                ? "消息调试操作结果未知，请勿自动重试清空"
                : "消息调试网关不可用或实例已变更",
        );
    }
}
export interface ControlMessageDebugServiceOptions {
    currentInstance(): string | undefined;
    forward(instanceId: string, action: "history" | "clear"): Promise<GatewayMessageDebugReply>;
}
/** 所有客户端共用当前网关绑定；没有实例时不转到旧 App 或读取旧缓存。 */
export class ControlMessageDebugService {
    private closed = false;
    private active = 0;
    constructor(private readonly options: ControlMessageDebugServiceOptions) {}

    async history(): Promise<{ gatewayInstanceId: string; entries: MessageDebugEntry[] }> {
        const id = this.current();
        const reply = await this.request(id, "history");
        if (reply.outcome !== "succeeded" || reply.action !== "history")
            throw new ControlMessageDebugError(503, "rejected");
        return { gatewayInstanceId: id, entries: reply.result.entries };
    }

    async clear(input: unknown): Promise<MessageDebugClearReceipt & { gatewayInstanceId: string }> {
        let expected: unknown;
        try {
            expected = closedServiceObject(input, [
                "expectedGatewayInstanceId",
            ]).expectedGatewayInstanceId;
        } catch {
            throw new ControlMessageDebugError(400, "rejected");
        }
        const id = this.current();
        if (expected !== id) throw new ControlMessageDebugError(409, "rejected");
        const reply = await this.request(id, "clear");
        if (reply.outcome !== "succeeded" || reply.action !== "clear")
            throw new ControlMessageDebugError(503, "unknown");
        return { gatewayInstanceId: id, ...reply.result };
    }

    close(): void {
        this.closed = true;
    }

    private current(): string {
        const id = !this.closed && this.options.currentInstance();
        if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
            throw new ControlMessageDebugError(503, "rejected");
        return id;
    }

    private async request(
        id: string,
        action: "history" | "clear",
    ): Promise<GatewayMessageDebugReply> {
        if (this.active >= 32) throw new ControlMessageDebugError(429, "rejected");
        this.active++;
        try {
            const reply = await this.options.forward(id, action);
            if (
                !isGatewayMessageDebugReply(reply) ||
                reply.gatewayInstanceId !== id ||
                reply.action !== action
            )
                throw new ControlMessageDebugError(503, "unknown");
            // 不接受已退出网关的迟到快照或把清空回执套到新网关上。
            if (this.closed || this.options.currentInstance() !== id)
                throw new ControlMessageDebugError(409, "unknown");
            if (reply.outcome === "rejected") throw new ControlMessageDebugError(503, "rejected");
            return reply;
        } catch (error) {
            if (error instanceof ControlMessageDebugError) throw error;
            throw new ControlMessageDebugError(
                503,
                error instanceof GatewayRequestError ? error.outcome : "unknown",
            );
        } finally {
            this.active--;
        }
    }
}
