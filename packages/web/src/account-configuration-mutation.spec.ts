import { describe, expect, it } from "vitest";
import {
    buildAccountConfigurationMutationRequest,
    parseAccountConfigurationMutationResponse,
} from "./account-configuration-mutation.js";
import type { ManagementEvidenceIdentity } from "./management-evidence-identity.js";

const revision = `sha256:${"a".repeat(64)}`;
const identity: ManagementEvidenceIdentity = {
    application: "onebots",
    version: "1.2.8",
    instanceId: "instance-a",
    runtimeContractId: "sha256:contract-a",
};

describe("account configuration mutation", () => {
    it("将请求绑定到完整快照并拒绝无效修订", () => {
        const init = buildAccountConfigurationMutationRequest(
            { platform: "mock", account_id: "demo" },
            identity,
            revision,
        );

        expect(new Headers(init.headers).get("X-OneBots-Expected-Instance-Id")).toBe(
            "instance-a",
        );
        expect(new Headers(init.headers).get("X-OneBots-Expected-Config-Revision")).toBe(revision);
        expect(init.cache).toBe("no-store");
        expect(init.redirect).toBe("error");
        expect(() =>
            buildAccountConfigurationMutationRequest({}, identity, "stale"),
        ).toThrow("账号配置请求缺少有效配置修订号");
    });

    it("只接受实例、操作、目标和修订完全闭合的成功回执", async () => {
        await expect(
            parseAccountConfigurationMutationResponse(
                mutationResponse(successBody()),
                identity,
                "add",
                "mock",
                "demo",
                "保存失败",
            ),
        ).resolves.toEqual({ success: true, configRevision: revision, message: "添加成功" });
    });

    it("拒绝正文正确但响应头来自另一实例的拼接回执", async () => {
        await expect(
            parseAccountConfigurationMutationResponse(
                mutationResponse(successBody(), 200, "instance-b"),
                identity,
                "add",
                "mock",
                "demo",
                "保存失败",
            ),
        ).rejects.toThrow("账号配置回执实例不匹配：期望 instance-a，实际 instance-b");
    });

    it.each([
        [
            "错误目标",
            { ...successBody(), target: { platform: "mock", account_id: "other" } },
            revision,
            "账号配置成功回执与目标账号不一致",
        ],
        [
            "响应头修订不同",
            successBody(),
            `sha256:${"b".repeat(64)}`,
            "账号配置成功回执缺少一致的配置修订号",
        ],
    ])("拒绝%s", async (_name, body, headerRevision, message) => {
        await expect(
            parseAccountConfigurationMutationResponse(
                mutationResponse(body, 200, "instance-a", headerRevision),
                identity,
                "add",
                "mock",
                "demo",
                "保存失败",
            ),
        ).rejects.toThrow(message);
    });

    it("只展示同一实例返回的限长失败诊断", async () => {
        const response = mutationResponse(
            {
                success: false,
                application: "onebots",
                instance_id: "instance-a",
                message: `配置冲突\n${"x".repeat(700)}`,
            },
            409,
        );

        const result = await parseAccountConfigurationMutationResponse(
            response,
            identity,
            "edit",
            "mock",
            "demo",
            "保存失败",
        );
        expect(result.success).toBe(false);
        if (result.success) throw new Error("expected failure result");
        expect(result.message).toHaveLength(500);
        expect(result.message).not.toContain("\n");
    });
});

function successBody() {
    return {
        success: true,
        application: "onebots",
        instance_id: "instance-a",
        config_revision: revision,
        operation: "add",
        target: { platform: "mock", account_id: "demo" },
        message: "添加成功",
    };
}

function mutationResponse(
    body: unknown,
    status = 200,
    instanceId = "instance-a",
    configRevision = revision,
): Response {
    return Response.json(body, {
        status,
        headers: {
            "X-OneBots-Application": "onebots",
            "X-OneBots-Version": "1.2.8",
            "X-OneBots-Instance-Id": instanceId,
            "X-OneBots-Runtime-Contract-Id": "sha256:contract-a",
            "X-OneBots-Config-Revision": configRevision,
        },
    });
}
