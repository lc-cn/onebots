import { describe, expect, it } from "vitest";
import type { ManagementEvidenceIdentity } from "../management-evidence-identity.js";
import {
    buildExtensionInstallRequestHeaders,
    parseExtensionMutationResponse,
} from "./extension-mutation.js";

const identity: ManagementEvidenceIdentity = {
    application: "onebots",
    version: "1.2.8",
    instanceId: "instance-a",
    runtimeContractId: "sha256:contract-a",
};

describe("extension mutation response", () => {
    it("把请求绑定到目录实例和配置修订", () => {
        const revision = `sha256:${"c".repeat(64)}`;
        expect(buildExtensionInstallRequestHeaders(identity, revision)).toEqual({
            "X-OneBots-Expected-Instance-Id": "instance-a",
            "X-OneBots-Expected-Config-Revision": revision,
        });
        expect(() => buildExtensionInstallRequestHeaders(identity, "stale")).toThrow(
            "缺少有效配置修订号",
        );
    });

    it("只接受闭合实例、操作、目标与配置修订的成功回执", async () => {
        const revision = `sha256:${"b".repeat(64)}`;
        const response = mutationResponse(
            {
                success: true,
                application: "onebots",
                instance_id: "instance-a",
                operation: "install",
                target: { id: "adapter:mock" },
                config_revision: revision,
                restartRequired: true,
                restartSupported: true,
                message: "扩展安装完成",
            },
            200,
            "instance-a",
            revision,
        );
        await expect(
            parseExtensionMutationResponse(
                response,
                identity,
                "install",
                "adapter:mock",
                "安装失败",
            ),
        ).resolves.toEqual({
            success: true,
            configRevision: revision,
            restartRequired: true,
            restartSupported: true,
            message: "扩展安装完成",
        });
    });

    it("响应头来自另一实例时不消费正文并要求刷新", async () => {
        const response = new Response("not-json", {
            status: 200,
            headers: managementHeaders("instance-b"),
        });

        await expect(
            parseExtensionMutationResponse(
                response,
                identity,
                "disable",
                "adapter:mock",
                "停用失败",
            ),
        ).resolves.toEqual({
            success: false,
            code: "EXTENSION_INSTANCE_MISMATCH",
            refreshRequired: true,
            message: "扩展管理快照已失效：期望实例 instance-a，实际 instance-b",
        });
    });

    it("只接受稳定失败码并区分过期快照与忙碌事务", async () => {
        const stale = mutationResponse(
            {
                success: false,
                application: "onebots",
                instance_id: "instance-a",
                code: "EXTENSION_CONFIG_REVISION_MISMATCH",
                message: "配置已过期\n请重试",
            },
            409,
        );
        await expect(
            parseExtensionMutationResponse(stale, identity, "install", "adapter:mock", "安装失败"),
        ).resolves.toEqual({
            success: false,
            code: "EXTENSION_CONFIG_REVISION_MISMATCH",
            refreshRequired: true,
            message: "配置已过期 请重试",
        });

        const busy = mutationResponse(
            {
                success: false,
                application: "onebots",
                instance_id: "instance-a",
                code: "EXTENSION_BUSY",
                message: "另一扩展正在安装",
            },
            409,
        );
        await expect(
            parseExtensionMutationResponse(busy, identity, "install", "adapter:mock", "安装失败"),
        ).resolves.toMatchObject({
            success: false,
            code: "EXTENSION_BUSY",
            refreshRequired: false,
        });

        const missingCode = mutationResponse(
            {
                success: false,
                application: "onebots",
                instance_id: "instance-a",
                message: "未知失败",
            },
            500,
        );
        await expect(
            parseExtensionMutationResponse(
                missingCode,
                identity,
                "install",
                "adapter:mock",
                "安装失败",
            ),
        ).rejects.toThrow("缺少有效错误码");
    });
});

function mutationResponse(
    body: unknown,
    status: number,
    instanceId = "instance-a",
    revision?: string,
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: managementHeaders(instanceId, {
            "Content-Type": "application/json",
            ...(revision ? { "X-OneBots-Config-Revision": revision } : {}),
        }),
    });
}

function managementHeaders(
    instanceId = "instance-a",
    extraHeaders: Record<string, string> = {},
): Record<string, string> {
    return {
        "X-OneBots-Application": "onebots",
        "X-OneBots-Version": "1.2.8",
        "X-OneBots-Instance-Id": instanceId,
        "X-OneBots-Runtime-Contract-Id": "sha256:contract-a",
        ...extraHeaders,
    };
}
