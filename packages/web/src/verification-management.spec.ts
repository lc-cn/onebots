import { describe, expect, it } from "vitest";
import type { ManagementEvidenceIdentity } from "./management-evidence-identity.js";
import {
    parseVerificationStreamIdentity,
    readVerificationMutationResult,
    readVerificationSnapshot,
    verificationMutationHeaders,
} from "./verification-management.js";

const identity: ManagementEvidenceIdentity = {
    application: "onebots",
    version: "1.2.8",
    instanceId: "instance-a",
    runtimeContractId: "sha256:contract-a",
};

describe("verification management identity", () => {
    it("将待处理列表与响应头中的完整实例身份共同采用", async () => {
        const response = identifiedResponse([
            { platform: "icqq", account_id: "bot", type: "sms", hint: "请输入验证码" },
        ]);

        await expect(readVerificationSnapshot(response)).resolves.toEqual({
            identity,
            items: [{ platform: "icqq", account_id: "bot", type: "sms", hint: "请输入验证码" }],
        });

        await expect(readVerificationSnapshot(identifiedResponse([null]))).rejects.toThrow(
            "待处理验证响应包含无效请求",
        );
    });

    it("解析每条 SSE 连接的首个实例身份事件并拒绝残缺身份", () => {
        expect(
            parseVerificationStreamIdentity({
                event: "identity",
                application: "onebots",
                version: "1.2.8",
                instance_id: "instance-a",
                runtime_contract_id: "sha256:contract-a",
            }),
        ).toEqual(identity);
        expect(() =>
            parseVerificationStreamIdentity({ event: "identity", application: "onebots" }),
        ).toThrow("验证事件流缺少完整 OneBots 实例身份");
        expect(parseVerificationStreamIdentity({ event: "clear" })).toBeNull();
    });

    it("写请求携带预期实例且只接受头部和正文闭合的回执", async () => {
        expect(verificationMutationHeaders(identity).get("X-OneBots-Expected-Instance-Id")).toBe(
            "instance-a",
        );
        await expect(
            readVerificationMutationResult(
                identifiedResponse({
                    success: true,
                    application: "onebots",
                    instance_id: "instance-a",
                }),
                identity,
            ),
        ).resolves.toEqual({ success: true });

        await expect(
            readVerificationMutationResult(
                identifiedResponse(
                    {
                        success: true,
                        application: "onebots",
                        instance_id: "instance-b",
                    },
                    200,
                    "instance-b",
                ),
                identity,
            ),
        ).rejects.toThrow("验证响应实例不匹配");

        await expect(
            readVerificationMutationResult(
                identifiedResponse({
                    success: true,
                    application: "onebots",
                    instance_id: "instance-b",
                }),
                identity,
            ),
        ).rejects.toThrow("验证端点未返回与请求实例一致的结果回执");
    });
});

function identifiedResponse(body: unknown, status = 200, instanceId = "instance-a"): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "X-OneBots-Application": "onebots",
            "X-OneBots-Version": "1.2.8",
            "X-OneBots-Instance-Id": instanceId,
            "X-OneBots-Runtime-Contract-Id": "sha256:contract-a",
        },
    });
}
