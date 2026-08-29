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
