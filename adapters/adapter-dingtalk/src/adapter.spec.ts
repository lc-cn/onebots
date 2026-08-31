import { describe, expect, it, vi } from "vitest";
import { DingTalkAdapter } from "./adapter.js";

describe("DingTalkAdapter", () => {
    it.each([
        ["private", undefined, "/v1.0/robot/otoMessages/batchRecall"],
        ["group", "cid_group", "/v1.0/robot/groupMessages/recall"],
    ] as const)("通过统一 delete_message 撤回 %s 机器人消息", async (scene, sceneId, path) => {
        const callApi = vi.fn().mockResolvedValue({ successResult: ["key_1"] });
        const bot = {
            config: { app_key: "robot_1" },
            callApi,
        };
        const adapter = {
            requireBot: vi.fn().mockReturnValue(bot),
        };

        await DingTalkAdapter.prototype.deleteMessage.call(adapter as never, "bot", {
            message_id: { string: "key_1" } as never,
            scene_type: scene,
            scene_id: sceneId ? ({ string: sceneId } as never) : undefined,
        });

        expect(callApi).toHaveBeenCalledWith(path, {
            method: "POST",
            body: {
                robotCode: "robot_1",
                processQueryKeys: ["key_1"],
                ...(sceneId ? { openConversationId: sceneId } : {}),
            },
        });
    });

    it("拒绝把自定义 Webhook 合成 ID 伪装成可撤回消息", async () => {
        await expect(
            DingTalkAdapter.prototype.deleteMessage.call({ requireBot: vi.fn() } as never, "bot", {
                message_id: { string: "webhook:generated" } as never,
                scene_type: "group",
                scene_id: { string: "cid_group" } as never,
            }),
        ).rejects.toMatchObject({ code: "DINGTALK_WEBHOOK_MESSAGE_NOT_RECALLABLE" });
    });
});

describe("DingTalkAdapter 机器人身份", () => {
    it("登录信息与状态使用平台机器人 ID，而不是本地账号别名", async () => {
        const client = {
            getCachedMe: () => ({ userid: "ding-bot", name: "Bot" }),
            getPlatformBotId: () => "ding-bot",
        };
        const createId = (value: string) => ({ string: value });
        const login = await DingTalkAdapter.prototype.getLoginInfo.call(
            { requireBot: () => client, createId } as never,
            "local-alias",
        );
        const status = await DingTalkAdapter.prototype.getStatus.call(
            { getAccount: () => ({ status: "online", client }), createId } as never,
            "local-alias",
        );

        expect(login.user_id).toEqual({ string: "ding-bot" });
        expect(status.bots).toEqual([{ self: { string: "ding-bot" }, online: true }]);
    });
});
