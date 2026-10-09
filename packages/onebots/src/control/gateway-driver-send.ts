import type { ControlSendContext, ControlSendRequest } from "@onebots/core/control";
import type { GatewayIdentity } from "../gateway/contracts.js";
import {
    isGatewaySendMessage,
    isGatewaySendReply,
    type GatewaySendResult,
} from "../gateway/send-contracts.js";
import { GatewayRequestError, type GatewayRequestClient } from "./gateway-request-client.js";

/** 仅组装已通过驱动上下文校验的请求；关联原操作回执，不重试未知发送结果。 */
export function requestGatewaySend(
    client: GatewayRequestClient,
    identity: GatewayIdentity,
    context: ControlSendContext,
    request: ControlSendRequest,
): Promise<GatewaySendResult> {
    return client.request({
        encode: requestId => {
            const message = { ...identity, type: "gateway.send" as const, requestId, request };
            if (!isGatewaySendMessage(message)) throw new Error();
            return message;
        },
        decode: (value, requestId) => {
            if (
                !isGatewaySendReply(value) ||
                value.requestId !== requestId ||
                value.controlInstanceId !== identity.controlInstanceId ||
                value.gatewayInstanceId !== identity.gatewayInstanceId ||
                value.configVersion !== context.configVersion ||
                value.operationId !== request.id
            )
                return;
            return value.outcome === "succeeded"
                ? { ok: true, result: value.result! }
                : {
                      ok: false,
                      error: new GatewayRequestError(
                          value.outcome,
                          value.outcome === "rejected"
                              ? "网关拒绝发送请求"
                              : "消息发送结果未知，请勿自动重试",
                      ),
                  };
        },
        errors: {
            unavailable: "发送网关不可用",
            limit: "未完成网关请求已达上限",
            invalid: "发送请求无效",
            timeout: "消息发送超时，结果未知，请勿自动重试",
            send: "发送通信中断，结果未知，请勿自动重试",
            closed: "发送网关已关闭，结果未知，请勿自动重试",
        },
    });
}
