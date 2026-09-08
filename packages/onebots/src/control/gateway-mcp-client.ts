import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { GatewayIdentity } from "../gateway/contracts.js";
import {
    isGatewayMcpMessage,
    isGatewayMcpReply,
    type GatewayMcpRequest,
    type GatewayMcpResult,
} from "../gateway/mcp-contracts.js";
interface Pending {
    resolve(value: GatewayMcpResult): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
}
/** 每个实际持有的 child 一个关联器；断连后永久关闭，不缓存或重放请求。 */
export class GatewayMcpClient {
    private readonly pending = new Map<string, Pending>();
    private closed = false;
    constructor(
        private readonly child: ChildProcess,
        private readonly identity: GatewayIdentity,
        private readonly timeoutMs = 30_000,
    ) {
        if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
            throw new Error("MCP 请求期限无效");
        child.on("message", this.onMessage);
        child.on("disconnect", this.onClosed);
        child.on("close", this.onClosed);
        child.on("error", this.onClosed);
    }
    request(request: GatewayMcpRequest): Promise<GatewayMcpResult> {
        if (
            this.closed ||
            !this.child.connected ||
            this.child.exitCode !== null ||
            this.child.signalCode !== null
        )
            return Promise.reject(new Error("MCP 网关不可用"));
        if (this.pending.size >= 32) return Promise.reject(new Error("MCP 未完成请求已达上限"));
        const requestId = randomUUID();
        const message = { ...this.identity, type: "gateway.mcp" as const, requestId, request };
        if (!isGatewayMcpMessage(message)) return Promise.reject(new Error("MCP 请求无效"));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => this.reject(requestId, "MCP 请求超时，执行结果未知"),
                this.timeoutMs,
            );
            this.pending.set(requestId, { resolve, reject, timer });
            try {
                this.child.send(message, error => {
                    if (error) this.reject(requestId, "MCP 请求发送失败，执行结果未知");
                });
            } catch {
                this.reject(requestId, "MCP 请求发送失败，执行结果未知");
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
        for (const id of this.pending.keys()) this.reject(id, "MCP 网关连接已关闭，执行结果未知");
    }
    private readonly onClosed = () => this.close();
    private readonly onMessage = (value: unknown) => {
        if (
            !value ||
            typeof value !== "object" ||
            (value as { type?: unknown }).type !== "gateway.mcp.result"
        )
            return;
        if (!isGatewayMcpReply(value)) return;
        if (
            value.controlInstanceId !== this.identity.controlInstanceId ||
            value.gatewayInstanceId !== this.identity.gatewayInstanceId
        )
            return;
        const pending = this.pending.get(value.requestId);
        if (!pending) return;
        this.pending.delete(value.requestId);
        clearTimeout(pending.timer);
        if (value.ok) pending.resolve(value.result!);
        else pending.reject(new Error(value.error));
    };
    private reject(id: string, message: string) {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(new Error(message));
    }
}
