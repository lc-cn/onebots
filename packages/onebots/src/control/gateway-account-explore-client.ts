import type {
    ControlAccountExploreRequest,
    ControlAccountExploreResult,
    ControlSendContext,
} from "@onebots/core/control";
import { AccountExploreError } from "../gateway/account-explore-errors.js";
import {
    isGatewayAccountExploreRequest,
    isGatewayAccountExploreReply,
} from "../gateway/account-explore-contracts.js";
import type { GatewayIdentity } from "../gateway/contracts.js";
import { GatewayRequestError, type GatewayRequestClient } from "./gateway-request-client.js";

/** 查询通信独立于进程生命周期；只接收当前实例的关联回执，不重放查询。 */
export async function requestGatewayAccountExplore(
    requests: GatewayRequestClient,
    identity: GatewayIdentity,
    context: ControlSendContext,
    request: ControlAccountExploreRequest,
): Promise<ControlAccountExploreResult> {
    try {
        return await requests.request({
            encode: requestId => {
                const message = {
                    ...identity,
                    type: "gateway.account-explore" as const,
                    requestId,
                    request,
                };
                if (!isGatewayAccountExploreRequest(message)) throw new Error("账号查询请求无效");
                return message;
            },
            decode: (value, requestId) => {
                if (
                    !isGatewayAccountExploreReply(value) ||
                    value.requestId !== requestId ||
                    value.controlInstanceId !== identity.controlInstanceId ||
                    value.gatewayInstanceId !== identity.gatewayInstanceId
                )
                    return;
                if (
                    value.outcome === "succeeded" &&
                    (value.result?.expected.gatewayInstanceId !== context.gatewayInstanceId ||
                        value.result?.expected.configVersion !== context.configVersion ||
                        value.result?.account !== request.account ||
                        value.result?.action !== request.action)
                )
                    return;
                return value.outcome === "succeeded"
                    ? { ok: true, result: value.result! }
                    : { ok: false, error: new AccountExploreError(value.code ?? "query_failed") };
            },
            errors: {
                unavailable: "账号查询网关不可用",
                limit: "未完成网关请求已达上限",
                invalid: "账号查询请求无效",
                timeout: "账号查询超时",
                send: "账号查询通信中断",
                closed: "账号查询网关已关闭",
            },
        });
    } catch (error) {
        if (error instanceof AccountExploreError) throw error;
        if (error instanceof GatewayRequestError && error.message === "账号查询超时")
            throw new AccountExploreError("query_timeout");
        if (error instanceof GatewayRequestError && error.message === "未完成网关请求已达上限")
            throw new AccountExploreError("query_busy");
        throw new AccountExploreError("query_failed");
    }
}
