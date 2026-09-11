import type { ChildProcess } from "node:child_process";
import type { GatewayIdentity } from "../gateway/contracts.js";
import {
    isGatewayMcpMessage,
    isGatewayMcpReply,
    type GatewayMcpRequest,
    type GatewayMcpResult,
} from "../gateway/mcp-contracts.js";
import { GatewayRequestClient } from "./gateway-request-client.js";
/** MCP只提供报文codec；关联、超时、断连由child共享请求模块处理。 */
export class GatewayMcpClient {
    private readonly requests: GatewayRequestClient;
    constructor(
        child: ChildProcess | GatewayRequestClient,
        private readonly identity: GatewayIdentity,
        timeoutMs = 30_000,
    ) {
        this.requests =
            child instanceof GatewayRequestClient
                ? child
                : new GatewayRequestClient(child, timeoutMs);
    }
    request(request: GatewayMcpRequest): Promise<GatewayMcpResult> {
        return this.requests.request({
            encode: requestId => {
                const message = {
                    ...this.identity,
                    type: "gateway.mcp" as const,
                    requestId,
                    request,
                };
                if (!isGatewayMcpMessage(message)) throw new Error();
                return message;
            },
            decode: (value, requestId) => {
                if (
                    !isGatewayMcpReply(value) ||
                    value.requestId !== requestId ||
                    value.controlInstanceId !== this.identity.controlInstanceId ||
                    value.gatewayInstanceId !== this.identity.gatewayInstanceId
                )
                    return;
                return value.ok
                    ? { ok: true, result: value.result! }
                    : { ok: false, error: new Error(value.error) };
            },
            errors: {
                unavailable: "MCP 网关不可用",
                limit: "MCP 未完成请求已达上限",
                invalid: "MCP 请求无效",
                timeout: "MCP 请求超时，执行结果未知",
                send: "MCP 请求发送失败，执行结果未知",
                closed: "MCP 网关连接已关闭，执行结果未知",
            },
        });
    }
    close(): void {
        this.requests.close();
    }
}
