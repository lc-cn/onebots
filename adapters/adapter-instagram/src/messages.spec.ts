import { describe, expect, it, vi } from "vitest";
import { compileInstagramMessage, projectWebhookMessage } from "./messages.js";

describe("Instagram message projection", () => {
    it("编译 text、reply 与 quick replies，并验证 Instagram 上限", async () => {
        const upload = vi.fn();
        await expect(
            compileInstagramMessage(
                [
                    { type: "text", data: { text: "Choose" } },
                    { type: "reply", data: { id: "m0" } },
                    {
                        type: "instagram_quick_replies",
                        data: {
                            items: [
                                { content_type: "text", title: "Yes", payload: "YES" },
                                { content_type: "user_email", payload: "EMAIL" },
                            ],
                        },
                    },
                ],
                { upload },
            ),
        ).resolves.toEqual({
            text: "Choose",
            reply_to: { mid: "m0" },
            quick_replies: [
                { content_type: "text", title: "Yes", payload: "YES" },
                { content_type: "user_email", payload: "EMAIL" },
            ],
        });
        await expect(
            compileInstagramMessage(
                [
                    { type: "text", data: { text: "Choose" } },
                    {
                        type: "instagram_quick_replies",
                        data: {
                            items: [
                                {
                                    content_type: "text",
                                    title: "This label is over twenty chars",
                                    payload: "NO",
                                },
                            ],
                        },
                    },
                ],
                { upload },
            ),
        ).rejects.toThrow(/20/u);
    });

    it("媒体 URL 只接受 HTTPS，base64 经 Attachment Upload API", async () => {
        const upload = vi.fn().mockResolvedValue("attachment-1");
        await expect(
            compileInstagramMessage(
                [{ type: "image", data: { url: "https://cdn.example/image.png" } }],
                { upload },
            ),
        ).resolves.toEqual({
            attachment: {
                type: "image",
                payload: { url: "https://cdn.example/image.png" },
            },
        });
        await expect(
            compileInstagramMessage(
                [{ type: "audio", data: { data: Buffer.from("audio").toString("base64") } }],
                { upload },
            ),
        ).resolves.toEqual({
            attachment: { type: "audio", payload: { attachment_id: "attachment-1" } },
        });
        expect(upload).toHaveBeenCalledWith(
            "audio",
            expect.objectContaining({ filename: "attachment.bin" }),
            true,
        );
        await expect(
            compileInstagramMessage(
                [{ type: "image", data: { url: "http://cdn.example/image.png" } }],
                { upload },
            ),
        ).rejects.toThrow(/HTTPS/u);
    });

    it("拒绝隐式拆消息，并完整保留 story reply、quick reply 与原生附件", async () => {
        await expect(
            compileInstagramMessage(
                [
                    { type: "text", data: { text: "caption" } },
                    { type: "image", data: { url: "https://cdn.example/image.png" } },
                ],
                { upload: vi.fn() },
            ),
        ).rejects.toThrow(/拆成两条/u);
        expect(
            projectWebhookMessage({
                mid: "m1",
                text: "story reply",
                reply_to: { story: { id: "s1", url: "https://cdn.example/story" } },
                quick_reply: { payload: "YES" },
                attachments: [{ type: "share", payload: { url: "https://instagram.com/p/x" } }],
            }),
        ).toEqual([
            { type: "text", data: { text: "story reply" } },
            {
                type: "instagram_attachment",
                data: {
                    url: "https://instagram.com/p/x",
                    instagram_attachment: {
                        type: "share",
                        payload: { url: "https://instagram.com/p/x" },
                    },
                },
            },
            { type: "instagram_quick_reply", data: { payload: "YES" } },
            {
                type: "instagram_reply_context",
                data: { story: { id: "s1", url: "https://cdn.example/story" } },
            },
        ]);
    });
});
