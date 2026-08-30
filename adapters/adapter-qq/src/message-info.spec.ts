import { describe, expect, it } from "vitest";
import { toQQMessageInfo } from "./message-info.js";

const createId = (value: string | number) => ({
    string: String(value),
    number: Number(value),
    source: value,
});

describe("QQ 消息详情投影", () => {
    it("保留频道消息发送者、时间、正文与附件", () => {
        const sceneId = createId("channel");
        expect(
            toQQMessageInfo(
                "channel",
                sceneId,
                {
                    id: "message",
                    timestamp: "2026-08-30T01:02:03.000Z",
                    content: "hello",
                    author: { id: "user", username: "User" },
                    attachments: [
                        { url: "https://example.com/image.png", content_type: "image/png" },
                    ],
                },
                createId,
            ),
        ).toMatchObject({
            message_id: createId("message"),
            time: Date.parse("2026-08-30T01:02:03.000Z"),
            sender: { sender_id: createId("user"), scene_id: sceneId },
            message: [
                { type: "text", data: { text: "hello" } },
                { type: "image", data: { url: "https://example.com/image.png" } },
            ],
        });
    });

    it("拒绝用当前时间和 unknown 身份掩盖畸形响应", () => {
        expect(() =>
            toQQMessageInfo(
                "direct",
                createId("dm"),
                { id: "message", timestamp: "invalid" },
                createId,
            ),
        ).toThrow(expect.objectContaining({ code: "QQ_INVALID_MESSAGE_RESPONSE" }));
    });
});
