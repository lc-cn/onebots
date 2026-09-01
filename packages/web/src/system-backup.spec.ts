import { describe, expect, it } from "vitest";
import { WEB_MANAGEMENT_BODY_LIMIT_BYTES } from "./management-response.js";
import { parseSystemBackupResponse } from "./system-backup.js";

describe("system backup response", () => {
    it("只接受绑定实例返回的 OneBots 成功回执", async () => {
        await expect(
            parseSystemBackupResponse(
                Response.json({
                    success: true,
                    application: "onebots",
                    instance_id: "instance-a",
                    message: "已备份",
                }),
                "instance-a",
            ),
        ).resolves.toEqual({ success: true, message: "已备份" });

        await expect(
            parseSystemBackupResponse(
                Response.json({
                    success: true,
                    application: "onebots",
                    instance_id: "instance-b",
                }),
                "instance-a",
            ),
        ).resolves.toEqual({
            success: false,
            message: "备份回执实例不匹配：期望 instance-a，实际 instance-b",
        });
    });

    it("保留失败诊断并拒绝空成功响应", async () => {
        await expect(
            parseSystemBackupResponse(
                Response.json({ success: false, message: "仓库不可达" }, { status: 400 }),
                "instance-a",
            ),
        ).resolves.toEqual({ success: false, message: "仓库不可达" });
        await expect(
            parseSystemBackupResponse(new Response(null, { status: 200 }), "instance-a"),
        ).resolves.toEqual({ success: false, message: "备份响应无效（HTTP 200）" });
    });

    it("拒绝超过管理响应边界的备份回执", async () => {
        await expect(
            parseSystemBackupResponse(
                new Response("{}", {
                    headers: {
                        "content-length": String(WEB_MANAGEMENT_BODY_LIMIT_BYTES + 1),
                    },
                }),
                "instance-a",
            ),
        ).resolves.toEqual({
            success: false,
            message: "备份响应无效：响应正文超过 4 MiB 上限",
        });
    });
});
