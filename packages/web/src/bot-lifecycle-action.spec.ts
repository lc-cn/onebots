import { describe, expect, it } from "vitest";
import {
    buildBotLifecycleActionRequest,
    parseBotLifecycleActionResponse,
} from "./bot-lifecycle-action.js";
import { WEB_MANAGEMENT_BODY_LIMIT_BYTES } from "./management-response.js";

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
    });

    it("accepts a successful response without requiring an error envelope", async () => {
        await expect(
            parseBotLifecycleActionResponse(new Response(null, { status: 200 }), "启动失败"),
        ).resolves.toEqual({ success: true });
    });

    it("preserves the server's stable conflict evidence", async () => {
        const response = new Response(
            JSON.stringify({
                success: false,
                code: "ACCOUNT_LIFECYCLE_CONFLICT",
                message: "账号 mock.demo 正在执行上线操作，请稍后重试",
            }),
            { status: 409, headers: { "content-type": "application/json" } },
        );

        await expect(parseBotLifecycleActionResponse(response, "停止失败")).resolves.toEqual({
            success: false,
            code: "ACCOUNT_LIFECYCLE_CONFLICT",
            message: "账号 mock.demo 正在执行上线操作，请稍后重试",
        });
    });

    it("falls back for malformed responses and bounds server text", async () => {
        await expect(
            parseBotLifecycleActionResponse(
                new Response("not json", { status: 503 }),
                "启动机器人失败",
            ),
        ).resolves.toEqual({ success: false, message: "启动机器人失败（HTTP 503）" });

        const result = await parseBotLifecycleActionResponse(
            new Response(JSON.stringify({ message: `failed\n${"x".repeat(700)}` }), {
                status: 500,
            }),
            "停止机器人失败",
        );
        expect(result.success).toBe(false);
        if (result.success === true) throw new Error("expected failure result");
        expect(result.message).toHaveLength(500);
        expect(result.message).not.toContain("\n");
    });

    it("reports an oversized lifecycle error without consuming it", async () => {
        const response = new Response("{}", {
            status: 500,
            headers: { "content-length": String(WEB_MANAGEMENT_BODY_LIMIT_BYTES + 1) },
        });

        await expect(parseBotLifecycleActionResponse(response, "停止机器人失败")).resolves.toEqual({
            success: false,
            message: "停止机器人失败：响应正文超过 4 MiB 上限",
        });
    });
});
