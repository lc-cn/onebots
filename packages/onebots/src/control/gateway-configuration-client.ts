import { GatewayRequestError, type GatewayRequestClient } from "./gateway-request-client.js";
import type { GatewayIdentity } from "../gateway/contracts.js";
import {
    isGatewayConfigurationReply,
    type GatewayConfigurationRequest,
    type GatewayConfigurationResult,
} from "../gateway/configuration-contracts.js";

/** 同一请求仅发送一次；超时、断链和无回执均不等于未执行。 */
export function requestGatewayConfiguration(
    client: GatewayRequestClient,
    identity: GatewayIdentity,
    input: Omit<GatewayConfigurationRequest, keyof GatewayIdentity | "type" | "requestId">,
): Promise<GatewayConfigurationResult> {
    return client.request({
        encode: requestId => ({ ...identity, ...input, type: "gateway.configuration", requestId }),
        decode: (value, requestId) => {
            if (
                !isGatewayConfigurationReply(value) ||
                value.requestId !== requestId ||
                value.operationId !== input.operationId ||
                value.gatewayInstanceId !== identity.gatewayInstanceId ||
                value.controlInstanceId !== identity.controlInstanceId
            )
                return undefined;
            if (value.outcome === "succeeded" && value.result)
                return { ok: true, result: value.result };
            return {
                ok: false,
                error: new GatewayRequestError(
                    value.outcome === "rejected" ? "rejected" : "unknown",
                    "网关配置应用未确认成功",
                ),
            };
        },
        errors: {
            unavailable: "网关不可用，未派发配置应用",
            limit: "网关配置请求过多，未派发",
            invalid: "网关配置请求无效",
            timeout: "网关配置应用结果未知，请查询原操作",
            send: "网关配置发送结果未知",
            closed: "网关断开，配置应用结果未知",
        },
    });
}
