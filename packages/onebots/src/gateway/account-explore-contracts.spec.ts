import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
    isGatewayAccountExploreRequest,
    isGatewayAccountExploreReply,
} from "./account-explore-contracts.js";

const identity = {
    protocolVersion: 1,
    controlInstanceId: randomUUID(),
    gatewayInstanceId: randomUUID(),
    requestId: randomUUID(),
};
const request = {
    ...identity,
    type: "gateway.account-explore",
    request: {
        expected: { gatewayInstanceId: identity.gatewayInstanceId, configVersion: "a".repeat(64) },
        account: "icqq/123456",
        action: "groups",
        kind: "group",
    },
};

describe("账号查询 IPC 契约", () => {
    it("接受 randomUUID 生成的合法查询身份，拒绝少一段的编号", () => {
        expect(isGatewayAccountExploreRequest(request)).toBe(true);
        for (const field of ["controlInstanceId", "gatewayInstanceId", "requestId"]) {
            expect(
                isGatewayAccountExploreRequest({
                    ...request,
                    [field]: "00000000-0000-4000-000000000001",
                }),
            ).toBe(false);
        }
    });
    it("拒绝回执只携带允许的失败代码，不接受异常正文或成功与失败混合", () => {
        const reply = { ...identity, type: "gateway.account-explore.result", outcome: "rejected" };
        expect(isGatewayAccountExploreReply(reply)).toBe(true);
        expect(isGatewayAccountExploreReply({ ...reply, code: "platform_query_failed" })).toBe(
            true,
        );
        expect(isGatewayAccountExploreReply({ ...reply, code: "private-platform-token" })).toBe(
            false,
        );
        expect(isGatewayAccountExploreReply({ ...reply, result: {} })).toBe(false);
        expect(isGatewayAccountExploreReply({ ...reply, message: "private-platform-token" })).toBe(
            false,
        );
    });
});
