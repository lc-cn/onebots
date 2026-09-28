import type { GatewayIdentity } from "./contracts.js";
import type { GatewayAccountExploreExecutor } from "./account-explore-executor.js";
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
        const result = await executor?.explore(value.request);
        const reply: GatewayAccountExploreReply = {
            type: "gateway.account-explore.result",
            protocolVersion: 1,
            controlInstanceId: identity.controlInstanceId,
            gatewayInstanceId: identity.gatewayInstanceId,
            requestId: value.requestId,
            ...(result ? { outcome: "succeeded", result } : { outcome: "rejected" }),
        };
        if (isGatewayAccountExploreReply(reply)) send(reply);
    })().catch(() => {
        // 读取失败不泄露平台异常；父进程请求在期限内自行结束。
    });
    return true;
}
