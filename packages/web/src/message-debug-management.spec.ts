import { describe, expect, it } from "vitest";
import type { ManagementEvidenceIdentity } from "./management-evidence-identity.js";
import {
    messageDebugClearHeaders,
    parseMessageDebugStreamIdentity,
    readMessageDebugClearReceipt,
    readMessageDebugSnapshot,
} from "./message-debug-management.js";

const identity: ManagementEvidenceIdentity = {
    application: "onebots",
    version: "1.2.8",
    instanceId: "instance-a",
    runtimeContractId: "sha256:contract-a",
};

describe("message debug management", () => {
    it("原子读取带实例身份的历史快照并校验记录", async () => {
        const response = managementResponse([
            {
                seq: 1,
                time: 1_000,
                direction: "inbound",
                platform: "mock",
                account_id: "demo",
                payload: { text: "hello" },
            },
        ]);

        await expect(readMessageDebugSnapshot(response)).resolves.toMatchObject({
            identity,
            entries: [{ seq: 1, platform: "mock" }],
        });
    });

    it("拒绝缺失序号的历史记录", async () => {
        const response = managementResponse([
            { time: 1_000, direction: "inbound", platform: "mock", account_id: "demo" },
        ]);

        await expect(readMessageDebugSnapshot(response)).rejects.toThrow(
            "消息调试历史包含无效记录",
        );
    });

    it("解析每次连接最先到达的流身份", () => {
        expect(
            parseMessageDebugStreamIdentity({
                event: "identity",
                application: "onebots",
                version: "1.2.8",
                instance_id: "instance-a",
                runtime_contract_id: "sha256:contract-a",
            }),
        ).toEqual(identity);
        expect(parseMessageDebugStreamIdentity({ seq: 1 })).toBeNull();
    });

    it("清空请求绑定实例且仅采用闭合回执", async () => {
        expect(messageDebugClearHeaders(identity).get("X-OneBots-Expected-Instance-Id")).toBe(
            "instance-a",
        );
        const response = managementResponse({
            success: true,
            application: "onebots",
            instance_id: "instance-a",
            cleared_count: 2,
            cleared_through_seq: 7,
        });

        await expect(readMessageDebugClearReceipt(response, identity)).resolves.toEqual({
            clearedCount: 2,
            clearedThroughSeq: 7,
        });
    });

    it("拒绝来自其他实例的清空回执", async () => {
        const response = managementResponse(
            {
                success: true,
                application: "onebots",
                instance_id: "instance-b",
                cleared_count: 2,
                cleared_through_seq: 7,
            },
            { ...identity, instanceId: "instance-b" },
        );

        await expect(readMessageDebugClearReceipt(response, identity)).rejects.toThrow(
            "消息调试清理响应实例不匹配",
        );
    });
});

function managementResponse(
    body: unknown,
    responseIdentity: ManagementEvidenceIdentity = identity,
): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
            "X-OneBots-Application": responseIdentity.application,
            "X-OneBots-Version": responseIdentity.version,
            "X-OneBots-Instance-Id": responseIdentity.instanceId,
            ...(responseIdentity.runtimeContractId
                ? { "X-OneBots-Runtime-Contract-Id": responseIdentity.runtimeContractId }
                : {}),
        },
    });
}
