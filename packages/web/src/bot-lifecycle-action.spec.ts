import { describe, expect, it } from "vitest";
import {
    buildBotLifecycleActionRequest,
    buildBotLifecycleActionRequestInit,
    parseBotLifecycleActionResponse,
} from "./bot-lifecycle-action.js";
import { WEB_MANAGEMENT_BODY_LIMIT_BYTES } from "./management-response.js";
import type { ManagementEvidenceIdentity } from "./management-evidence-identity.js";

const identity: ManagementEvidenceIdentity = {
    application: "onebots",
    version: "1.2.8",
    instanceId: "instance-a",
    runtimeContractId: "sha256:contract-a",
};

describe("bot lifecycle action response", () => {
    it("binds a Web action to the instance that supplied the account snapshot", () => {
        expect(buildBotLifecycleActionRequest("mock", "demo", "instance-a")).toEqual({
            platform: "mock",
            uin: "demo",
            expected_instance_id: "instance-a",
        });
        expect(buildBotLifecycleActionRequest("mock", "demo")).toEqual({
            platform: "mock",
            uin: "demo",
        });

        const init = buildBotLifecycleActionRequestInit("mock", "demo", identity);
        expect(new Headers(init.headers).get("X-OneBots-Expected-Instance-Id")).toBe(
            "instance-a",
        );
        expect(JSON.parse(String(init.body))).toEqual({
            platform: "mock",
            uin: "demo",
            expected_instance_id: "instance-a",
        });
        expect(init.cache).toBe("no-store");
        expect(init.redirect).toBe("error");
    });

    it("只接受由目标实例返回且闭合账号身份的成功回执", async () => {
        await expect(
            parseBotLifecycleActionResponse(
                lifecycleResponse({
                    success: true,
                    application: "onebots",
                    instance_id: "instance-a",
                    data: { platform: "mock", uin: "demo", status: "online" },
                }),
                "启动失败",
                identity,
                "mock",
                "demo",
            ),
        ).resolves.toEqual({ success: true });
    });

    it("preserves the server's stable conflict evidence", async () => {
        const response = new Response(
            JSON.stringify({
                success: false,
                application: "onebots",
                instance_id: "instance-a",
                code: "ACCOUNT_LIFECYCLE_CONFLICT",
                message: "账号 mock.demo 正在执行上线操作，请稍后重试",
            }),
            { status: 409, headers: managementHeaders() },
        );

        await expect(
            parseBotLifecycleActionResponse(response, "停止失败", identity, "mock", "demo"),
        ).resolves.toEqual({
            success: false,
            code: "ACCOUNT_LIFECYCLE_CONFLICT",
            message: "账号 mock.demo 正在执行上线操作，请稍后重试",
        });
    });

    it("falls back for malformed responses and bounds server text", async () => {
        await expect(
            parseBotLifecycleActionResponse(
                new Response("not json", { status: 503, headers: managementHeaders() }),
                "启动机器人失败",
                identity,
                "mock",
                "demo",
            ),
        ).resolves.toEqual({ success: false, message: "启动机器人失败（HTTP 503）" });

        const result = await parseBotLifecycleActionResponse(
            lifecycleResponse(
                {
                    success: false,
                    application: "onebots",
                    instance_id: "instance-a",
                    message: `failed\n${"x".repeat(700)}`,
                },
                500,
            ),
            "停止机器人失败",
            identity,
            "mock",
            "demo",
        );
        expect(result.success).toBe(false);
        if (result.success === true) throw new Error("expected failure result");
        expect(result.message).toHaveLength(500);
        expect(result.message).not.toContain("\n");
    });

    it("reports an oversized lifecycle error without consuming it", async () => {
        const response = new Response("{}", {
            status: 500,
            headers: {
                ...managementHeaders(),
                "content-length": String(WEB_MANAGEMENT_BODY_LIMIT_BYTES + 1),
            },
        });

        await expect(
            parseBotLifecycleActionResponse(
                response,
                "停止机器人失败",
                identity,
                "mock",
                "demo",
            ),
        ).resolves.toEqual({
            success: false,
            message: "停止机器人失败：响应正文超过 4 MiB 上限",
        });
    });

    it("拒绝空 200、跨实例响应和目标账号不一致的成功正文", async () => {
        await expect(
            parseBotLifecycleActionResponse(
                new Response(null, { status: 200, headers: managementHeaders() }),
                "启动失败",
                identity,
                "mock",
                "demo",
            ),
        ).resolves.toEqual({ success: false, message: "启动失败（HTTP 200）" });

        await expect(
            parseBotLifecycleActionResponse(
                lifecycleResponse(
                    {
                        success: true,
                        application: "onebots",
                        instance_id: "instance-a",
                        data: { platform: "mock", uin: "demo" },
                    },
                    200,
                    "instance-b",
                ),
                "启动失败",
                identity,
                "mock",
                "demo",
            ),
        ).resolves.toEqual({
            success: false,
            message: "启动失败：响应实例不匹配，期望 instance-a，实际 instance-b",
        });

        await expect(
            parseBotLifecycleActionResponse(
                lifecycleResponse({
                    success: true,
                    application: "onebots",
                    instance_id: "instance-a",
                    data: { platform: "mock", uin: "other" },
                }),
                "启动失败",
                identity,
                "mock",
                "demo",
            ),
        ).resolves.toEqual({
            success: false,
            message: "启动失败：成功回执与目标账号不一致",
        });
    });
});

function managementHeaders(instanceId = "instance-a"): Record<string, string> {
    return {
        "content-type": "application/json",
        "X-OneBots-Application": "onebots",
        "X-OneBots-Version": "1.2.8",
        "X-OneBots-Instance-Id": instanceId,
        "X-OneBots-Runtime-Contract-Id": "sha256:contract-a",
    };
}

function lifecycleResponse(body: unknown, status = 200, instanceId = "instance-a"): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: managementHeaders(instanceId),
    });
}
