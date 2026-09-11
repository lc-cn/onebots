import type { GatewayIdentity } from "../gateway/contracts.js";
import type {
    GatewayVerificationCommand,
    GatewayVerificationQuery,
} from "../gateway/verification-executor.js";
import {
    isGatewayVerificationRequest,
    isGatewayVerificationReply,
    type GatewayVerificationReply,
} from "../gateway/verification-contracts.js";
import { GatewayRequestClient, GatewayRequestError } from "./gateway-request-client.js";

export type GatewayVerificationOperation =
    | { action: "list" }
    | { action: "execute"; command: GatewayVerificationCommand }
    | ({ action: "query" } & GatewayVerificationQuery);
/** 一次派发，严格关联实例/配置/操作；未知结果不得自动重发。 */
export function requestGatewayVerification(
    requests: GatewayRequestClient,
    identity: GatewayIdentity & { configVersion: string },
    operation: GatewayVerificationOperation,
): Promise<GatewayVerificationReply> {
    return requests.request({
        encode: requestId => {
            const value = { ...identity, type: "gateway.verification", requestId, ...operation };
            if (!isGatewayVerificationRequest(value)) throw new Error("账号验证请求无效");
            return value;
        },
        decode: (value, requestId) => {
            if (
                !isGatewayVerificationReply(value) ||
                value.requestId !== requestId ||
                value.controlInstanceId !== identity.controlInstanceId ||
                value.gatewayInstanceId !== identity.gatewayInstanceId ||
                value.configVersion !== identity.configVersion ||
                value.action !== operation.action ||
                (value.action === "execute" &&
                    operation.action === "execute" &&
                    value.operationId !== operation.command.operationId) ||
                (value.action === "query" &&
                    operation.action === "query" &&
                    (value.operationId !== operation.operationId ||
                        value.challengeId !== operation.challengeId ||
                        value.verificationAction !== operation.verificationAction))
            )
                return;
            return value.outcome === "succeeded"
                ? { ok: true, result: value }
                : {
                      ok: false,
                      error: new GatewayRequestError(
                          value.outcome,
                          value.outcome === "unknown"
                              ? "账号验证结果未知，请查询原操作，不要重新发送"
                              : "网关拒绝账号验证请求",
                      ),
                  };
        },
        errors: {
            unavailable: "账号验证网关不可用",
            limit: "未完成网关请求已达上限",
            invalid: "账号验证请求无效",
            timeout: "账号验证超时，结果未知，请勿自动重试",
            send: "账号验证通信中断，结果未知，请勿自动重试",
            closed: "账号验证网关已关闭，结果未知，请勿自动重试",
        },
    });
}
