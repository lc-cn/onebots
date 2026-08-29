import { describe, expect, it, vi } from "vitest";
import { ErrorCategory } from "onebots";
import { DingTalkError } from "./errors.js";
import { executeDingTalkPlatformAction } from "./platform-actions.js";

describe("executeDingTalkPlatformAction", () => {
    it("工作通知映射到旧版开放平台 endpoint", async () => {
        const callApi = vi.fn().mockResolvedValue({ task_id: 1 });
        await executeDingTalkPlatformAction({ callApi } as never, "send_work_notification", {
            agent_id: 1,
            userid_list: "user_1",
            msg: { msgtype: "text", text: { content: "ok" } },
        });
        expect(callApi).toHaveBeenCalledWith("/topapi/message/corpconversation/asyncsend_v2", {
            method: "POST",
            auth: "legacy",
            body: {
                agent_id: 1,
                userid_list: "user_1",
                msg: { msgtype: "text", text: { content: "ok" } },
            },
        });
    });

    it("底层入口拒绝目录穿越 path", async () => {
        const error = await executeDingTalkPlatformAction(
            { callApi: vi.fn() } as never,
            "call_dingtalk_api",
            {
                path: "/v1.0/robot/../oauth2/accessToken",
            },
        ).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(DingTalkError);
        expect(error).toMatchObject({
            code: "DINGTALK_ACTION_PATH_INVALID",
            category: ErrorCategory.VALIDATION,
        });
    });
});
