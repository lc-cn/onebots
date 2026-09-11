import type { GatewayIdentity } from "../gateway/contracts.js";
import {
    isGatewayMessageDebugRequest,
    isGatewayMessageDebugReply,
    type GatewayMessageDebugReply,
} from "../gateway/message-debug-contracts.js";
import { GatewayRequestClient, GatewayRequestError } from "./gateway-request-client.js";

/** 绑定单个网关的关联请求；清空超时不得重试或转发给新实例。 */
export function requestGatewayMessageDebug(
    requests: GatewayRequestClient,
    identity: GatewayIdentity,
    action: "history" | "clear",
): Promise<GatewayMessageDebugReply> {
    return requests.request({
        encode: requestId => {
            const message = { ...identity, type: "gateway.message-debug", requestId, action };
            if (!isGatewayMessageDebugRequest(message)) throw new Error("消息调试请求无效");
            return message;
        },
        decode: (value, requestId) => {
            if (
                !isGatewayMessageDebugReply(value) ||
                value.requestId !== requestId ||
                value.controlInstanceId !== identity.controlInstanceId ||
                value.gatewayInstanceId !== identity.gatewayInstanceId ||
                value.action !== action
            )
                return;
            return value.outcome === "succeeded"
                ? { ok: true, result: value }
                : { ok: false, error: new GatewayRequestError("rejected", "网关拒绝消息调试请求") };
        },
        errors: {
            unavailable: "消息调试网关不可用",
            limit: "未完成网关请求已达上限",
            invalid: "消息调试请求无效",
            timeout: "消息调试请求超时，结果未知，请勿自动重试清空",
            send: "消息调试通信中断，结果未知，请勿自动重试清空",
            closed: "消息调试网关已关闭，结果未知，请勿自动重试清空",
        },
    });
}
