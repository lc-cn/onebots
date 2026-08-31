import { describe, expect, it, vi } from "vitest";
import { FeishuAdapter } from "./adapter.js";

describe("FeishuAdapter.getMessage", () => {
    it("按 chat_type 区分飞书单聊与群聊", async () => {
        const fakeAdapter = {
            requireBot: () => ({
                get: vi.fn().mockResolvedValue({
                    data: {
                        code: 0,
                        data: {
                            items: [
                                {
                                    message_id: "om_1",
                                    msg_type: "text",
                                    create_time: "1710000000000",
                                    chat_id: "oc_p2p",
                                    chat_type: "p2p",
                                    sender: {
                                        id: "ou_sender",
                                        id_type: "open_id",
                                        sender_type: "user",
                                    },
                                    body: { content: '{"text":"hello"}' },
                                },
                            ],
                        },
                    },
                }),
            }),
            coerceId: (value: string) => ({ string: value }),
            createId: (value: string) => ({ string: value }),
        };

        const result = await FeishuAdapter.prototype.getMessage.call(fakeAdapter as never, "bot", {
            message_id: "om_1",
        });
        expect(result.sender).toMatchObject({
            scene_type: "private",
            scene_id: { string: "oc_p2p" },
        });
    });
});

describe("FeishuAdapter 机器人身份", () => {
    it("登录信息与状态使用平台 open_id，而不是本地账号别名", async () => {
        const me = {
            open_id: "ou_bot",
            user_id: "user_bot",
            name: "Bot",
        };
        const client = { getCachedMe: () => me, getAppId: () => "cli_app" };
        const createId = (value: string) => ({ string: value });
        const login = await FeishuAdapter.prototype.getLoginInfo.call(
            { requireBot: () => client, createId } as never,
            "local-alias",
        );
        const status = await FeishuAdapter.prototype.getStatus.call(
            {
                getAccount: () => ({ status: "online", client, config: { app_id: "cli_app" } }),
                createId,
            } as never,
            "local-alias",
        );

        expect(login.user_id).toEqual({ string: "ou_bot" });
        expect(status.bots).toEqual([{ self: { string: "ou_bot" }, online: true }]);
    });
});
