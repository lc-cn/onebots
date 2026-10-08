import type { GatewayIdentity } from "./contracts.js";
import type { GatewayAccountExploreExecutor } from "./account-explore-executor.js";
import { AccountExploreError, type AccountExploreErrorCode } from "./account-explore-errors.js";
import { isControlAccountExploreResult } from "@onebots/core/control";
import {
    isGatewayAccountExploreRequest,
    isGatewayAccountExploreReply,
    type GatewayAccountExploreReply,
} from "./account-explore-contracts.js";

export function handleGatewayAccountExplore(
    value: unknown,
    identity: GatewayIdentity | undefined,
    executor: GatewayAccountExploreExecutor | undefined,
    send: (reply: GatewayAccountExploreReply) => void,
): boolean {
    if (
        !value ||
        typeof value !== "object" ||
        (value as { type?: unknown }).type !== "gateway.account-explore"
    )
        return false;
    if (
        !isGatewayAccountExploreRequest(value) ||
        !identity ||
        value.controlInstanceId !== identity.controlInstanceId ||
        value.gatewayInstanceId !== identity.gatewayInstanceId
    )
        return true;
    void (async () => {
        let result;
        let code: AccountExploreErrorCode = "gateway_unavailable";
        try {
            result = await executor?.explore(value.request);
            if (executor && !result) code = "context_changed";
            if (result && !isControlAccountExploreResult(result)) {
                result = undefined;
                code = "invalid_response";
                process.stderr.write("[onebots] 账号查询响应不符合控制契约，已拒绝返回\n");
            }
        } catch (error) {
            code = error instanceof AccountExploreError ? error.code : "platform_query_failed";
            if (!(error instanceof AccountExploreError))
                process.stderr.write("[onebots] 账号查询执行失败，已返回脱敏故障回执\n");
        }
        const reply: GatewayAccountExploreReply = {
            type: "gateway.account-explore.result",
            protocolVersion: 1,
            controlInstanceId: identity.controlInstanceId,
            gatewayInstanceId: identity.gatewayInstanceId,
            requestId: value.requestId,
            ...(result ? { outcome: "succeeded", result } : { outcome: "rejected", code }),
        };
        if (isGatewayAccountExploreReply(reply)) send(reply);
    })().catch(() => {
        // IPC 断连不能重发回执；父进程请求在期限内自行结束。
        process.stderr.write("[onebots] 账号查询回执发送失败\n");
    });
    return true;
}
