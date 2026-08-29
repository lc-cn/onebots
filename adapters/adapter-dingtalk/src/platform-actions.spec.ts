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
            code: "DINGTALK_API_PATH_INVALID",
            category: ErrorCategory.VALIDATION,
        });
    });

    it.each(["//evil.example/path", "/\\evil.example/path", "/v1.0/users?token=forged"])(
        "底层入口拒绝带 URL 语义的 path: %s",
        async path => {
            await expect(
                executeDingTalkPlatformAction({ callApi: vi.fn() } as never, "call_dingtalk_api", {
                    path,
                }),
            ).rejects.toMatchObject({ code: "DINGTALK_API_PATH_INVALID" });
        },
    );

    it("机器人撤回与已读查询使用官方端点", async () => {
        const callApi = vi.fn().mockResolvedValue({ successResult: ["key_1"] });
        const bot = { callApi } as never;
        await executeDingTalkPlatformAction(bot, "recall_robot_private_messages", {
            robotCode: "robot_1",
            processQueryKeys: ["key_1"],
        });
        await executeDingTalkPlatformAction(bot, "recall_robot_group_messages", {
            robotCode: "robot_1",
            openConversationId: "cid_group",
            processQueryKeys: ["key_1"],
        });
        await executeDingTalkPlatformAction(bot, "get_robot_private_message_status", {
            robotCode: "robot_1",
            processQueryKey: "key_1",
        });
        await executeDingTalkPlatformAction(bot, "get_robot_group_message_status", {
            robotCode: "robot_1",
            openConversationId: "cid_group",
            processQueryKey: "key_1",
        });
        expect(callApi.mock.calls).toEqual([
            [
                "/v1.0/robot/otoMessages/batchRecall",
                {
                    method: "POST",
                    body: { robotCode: "robot_1", processQueryKeys: ["key_1"] },
                },
            ],
            [
                "/v1.0/robot/groupMessages/recall",
                {
                    method: "POST",
                    body: {
                        robotCode: "robot_1",
                        openConversationId: "cid_group",
                        processQueryKeys: ["key_1"],
                    },
                },
            ],
            [
                "/v1.0/robot/oToMessages/readStatus",
                {
                    method: "GET",
                    query: { robotCode: "robot_1", processQueryKey: "key_1" },
                },
            ],
            [
                "/v1.0/robot/groupMessages/query",
                {
                    method: "POST",
                    body: {
                        robotCode: "robot_1",
                        openConversationId: "cid_group",
                        processQueryKey: "key_1",
                    },
                },
            ],
        ]);
    });
});
