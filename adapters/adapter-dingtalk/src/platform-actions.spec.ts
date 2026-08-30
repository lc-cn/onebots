import { describe, expect, it, vi } from "vitest";
import { ErrorCategory } from "onebots";
import { dingTalkCapabilities } from "./capabilities.js";
import { DingTalkError } from "./errors.js";
import { DINGTALK_PLATFORM_ACTIONS, executeDingTalkPlatformAction } from "./platform-actions.js";

describe("executeDingTalkPlatformAction", () => {
    it("所有已注册平台动作都公开能力声明", () => {
        for (const action of DINGTALK_PLATFORM_ACTIONS) {
            expect(dingTalkCapabilities.actions[action]?.support).toBe("native");
        }
    });

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

    it("通讯录与场景群动作映射到稳定的旧版 endpoint", async () => {
        const callApi = vi.fn().mockResolvedValue({ errcode: 0 });
        const bot = { callApi } as never;
        await executeDingTalkPlatformAction(bot, "create_user", { name: "用户" });
        await executeDingTalkPlatformAction(bot, "get_department", { dept_id: 1 });
        await executeDingTalkPlatformAction(bot, "add_scene_group_members", {
            open_conversation_id: "cid",
            user_ids: ["user_1"],
        });

        expect(callApi.mock.calls.map(call => call[0])).toEqual([
            "/topapi/v2/user/create",
            "/topapi/v2/department/get",
            "/topapi/im/chat/scenegroup/member/add",
        ]);
        for (const [, options] of callApi.mock.calls) {
            expect(options).toMatchObject({ method: "POST", auth: "legacy" });
        }
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

    it("拒绝显式传入的无效可选参数", async () => {
        const bot = { callApi: vi.fn() } as never;
        for (const params of [
            { path: "/v1.0/test", method: null },
            { path: "/v1.0/test", auth: null },
            { path: "/v1.0/test", body: null },
            { path: "/v1.0/test", query: null },
        ]) {
            await expect(
                executeDingTalkPlatformAction(bot, "call_dingtalk_api", params),
            ).rejects.toMatchObject({ category: ErrorCategory.VALIDATION });
        }
    });

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

    it("互动卡片动作映射到实例、投放、更新与流式端点", async () => {
        const callApi = vi.fn().mockResolvedValue({});
        const bot = { callApi } as never;
        await executeDingTalkPlatformAction(bot, "create_card_instance", {
            cardTemplateId: "template-1",
            outTrackId: "card-1",
            cardData: { cardParamMap: { title: "构建" } },
        });
        await executeDingTalkPlatformAction(bot, "deliver_card_instance", {
            outTrackId: "card-1",
            openSpaceId: "dtv1.card//IM_GROUP.cid-1",
            imGroupOpenDeliverModel: { robotCode: "robot-1" },
        });
        await executeDingTalkPlatformAction(bot, "create_and_deliver_card", {
            cardTemplateId: "template-1",
            outTrackId: "card-2",
            openSpaceId: "dtv1.card//IM_ROBOT.user-1",
        });
        await executeDingTalkPlatformAction(bot, "update_card_instance", {
            outTrackId: "card-1",
            cardData: { cardParamMap: { title: "完成" } },
        });
        await executeDingTalkPlatformAction(bot, "stream_card_instance", {
            outTrackId: "card-1",
            guid: "chunk-1",
            key: "content",
            content: "处理中",
            isFull: false,
            isFinalize: false,
            isError: false,
        });

        expect(callApi.mock.calls.map(call => [call[0], call[1].method])).toEqual([
            ["/v1.0/card/instances", "POST"],
            ["/v1.0/card/instances/deliver", "POST"],
            ["/v1.0/card/instances/createAndDeliver", "POST"],
            ["/v1.0/card/instances", "PUT"],
            ["/v1.0/card/streaming", "PUT"],
        ]);
        expect(dingTalkCapabilities.actions.stream_card_instance).toMatchObject({
            support: "native",
            permissions: ["Card.Streaming.Write"],
        });
    });

    it("互动卡片动作在请求前拒绝缺少稳定实例标识", async () => {
        const callApi = vi.fn();
        await expect(
            executeDingTalkPlatformAction({ callApi } as never, "update_card_instance", {
                cardData: { cardParamMap: {} },
            }),
        ).rejects.toMatchObject({ code: "DINGTALK_CARD_PARAM_INVALID" });
        await expect(
            executeDingTalkPlatformAction({ callApi } as never, "stream_card_instance", {
                outTrackId: "card-1",
                guid: "chunk-1",
                key: "content",
                content: "",
                isFull: false,
                isFinalize: "false",
                isError: false,
            }),
        ).rejects.toMatchObject({ code: "DINGTALK_CARD_PARAM_INVALID" });
        expect(callApi).not.toHaveBeenCalled();
    });
});
