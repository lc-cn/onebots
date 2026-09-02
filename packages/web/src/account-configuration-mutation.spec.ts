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

        expect(new Headers(init.headers).get("X-OneBots-Expected-Instance-Id")).toBe("instance-a");
        expect(new Headers(init.headers).get("X-OneBots-Expected-Config-Revision")).toBe(revision);
        expect(init.cache).toBe("no-store");
        expect(init.redirect).toBe("error");
        expect(() => buildAccountConfigurationMutationRequest({}, identity, "stale")).toThrow(
            "账号配置请求缺少有效配置修订号",
        );
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

    it("不消费另一实例的正文并要求刷新快照", async () => {
        const response = new Response("not-json", {
            status: 200,
            headers: {
                "X-OneBots-Application": "onebots",
                "X-OneBots-Version": "1.2.8",
                "X-OneBots-Instance-Id": "instance-b",
                "X-OneBots-Runtime-Contract-Id": "sha256:contract-a",
            },
        });
        await expect(
            parseAccountConfigurationMutationResponse(
                response,
                identity,
                "add",
                "mock",
                "demo",
                "保存失败",
            ),
        ).resolves.toEqual({
            success: false,
            code: "ACCOUNT_INSTANCE_MISMATCH",
            refreshRequired: true,
            message: "账号配置快照已失效：期望实例 instance-a，实际 instance-b",
        });
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

    it("只展示同一实例返回的限长失败诊断并标记必须换快照的漂移", async () => {
        const response = mutationResponse(
            {
                success: false,
                application: "onebots",
                instance_id: "instance-a",
                code: "ACCOUNT_CONFIG_DRIFT",
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
        expect(result.code).toBe("ACCOUNT_CONFIG_DRIFT");
        expect(result.refreshRequired).toBe(true);
        expect(result.message).toHaveLength(500);
        expect(result.message).not.toContain("\n");
    });

    it("事务忙碌时保留当前表单供稍后重试", async () => {
        const result = await parseAccountConfigurationMutationResponse(
            mutationResponse(
                {
                    success: false,
                    application: "onebots",
                    instance_id: "instance-a",
                    code: "ACCOUNT_CONFIG_BUSY",
                    message: "另一项账号配置正在执行",
                },
                409,
            ),
            identity,
            "edit",
            "mock",
            "demo",
            "保存失败",
        );

        expect(result).toEqual({
            success: false,
            code: "ACCOUNT_CONFIG_BUSY",
            refreshRequired: false,
            message: "另一项账号配置正在执行",
        });
    });

    it("拒绝没有稳定错误码的失败回执", async () => {
        await expect(
            parseAccountConfigurationMutationResponse(
                mutationResponse(
                    {
                        success: false,
                        application: "onebots",
                        instance_id: "instance-a",
                        message: "保存失败",
                    },
                    500,
                ),
                identity,
                "add",
                "mock",
                "demo",
                "保存失败",
            ),
        ).rejects.toThrow("账号配置失败回执缺少有效错误码");
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
