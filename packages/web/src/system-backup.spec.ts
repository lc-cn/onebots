import { describe, expect, it } from "vitest";
import { WEB_MANAGEMENT_BODY_LIMIT_BYTES } from "./management-response.js";
import { parseSystemBackupResponse } from "./system-backup.js";
import type { ManagementEvidenceIdentity } from "./management-evidence-identity.js";

const identity: ManagementEvidenceIdentity = {
    application: "onebots",
    version: "1.2.8",
    instanceId: "instance-a",
    runtimeContractId: "sha256:contract-a",
};

describe("system backup response", () => {
    it("只接受绑定实例返回的 OneBots 成功回执", async () => {
        await expect(
            parseSystemBackupResponse(
                backupResponse({
                    success: true,
                    application: "onebots",
                    instance_id: "instance-a",
                    message: "已备份",
                }),
                identity,
            ),
        ).resolves.toEqual({ success: true, message: "已备份" });

        await expect(
            parseSystemBackupResponse(
                backupResponse({
                    success: true,
                    application: "onebots",
                    instance_id: "instance-b",
                }),
                identity,
            ),
        ).resolves.toEqual({
            success: false,
            message: "备份回执实例不匹配：期望 instance-a，实际 instance-b",
        });
    });

    it("保留失败诊断并拒绝空成功响应", async () => {
        await expect(
            parseSystemBackupResponse(
                backupResponse(
                    {
                        success: false,
                        application: "onebots",
                        instance_id: "instance-a",
                        message: "仓库不可达",
                    },
                    400,
                ),
                identity,
            ),
        ).resolves.toEqual({ success: false, message: "仓库不可达" });
        await expect(
            parseSystemBackupResponse(
                new Response(null, { status: 200, headers: managementHeaders() }),
                identity,
            ),
        ).resolves.toEqual({ success: false, message: "备份响应无效（HTTP 200）" });
    });

    it("拒绝超过管理响应边界的备份回执", async () => {
        await expect(
            parseSystemBackupResponse(
                new Response("{}", {
                    headers: {
                        ...managementHeaders(),
                        "content-length": String(WEB_MANAGEMENT_BODY_LIMIT_BYTES + 1),
                    },
                }),
                identity,
            ),
        ).resolves.toEqual({
            success: false,
            message: "备份响应无效：响应正文超过 4 MiB 上限",
        });
    });

    it("拒绝正文正确但标准响应头来自另一实例的备份回执", async () => {
        await expect(
            parseSystemBackupResponse(
                backupResponse(
                    {
                        success: true,
                        application: "onebots",
                        instance_id: "instance-a",
                    },
                    200,
                    "instance-b",
                ),
                identity,
            ),
        ).resolves.toEqual({
            success: false,
            message: "备份响应实例不匹配：期望 instance-a，实际 instance-b",
        });
    });
});

function managementHeaders(instanceId = "instance-a"): Record<string, string> {
    return {
        "X-OneBots-Application": "onebots",
        "X-OneBots-Version": "1.2.8",
        "X-OneBots-Instance-Id": instanceId,
        "X-OneBots-Runtime-Contract-Id": "sha256:contract-a",
    };
}

function backupResponse(body: unknown, status = 200, instanceId = "instance-a"): Response {
    return Response.json(body, { status, headers: managementHeaders(instanceId) });
}
