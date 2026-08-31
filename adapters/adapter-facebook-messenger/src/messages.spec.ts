import { describe, expect, it, vi } from "vitest";
import { compileMessengerMessage, projectWebhookMessage } from "./messages.js";

describe("Facebook Messenger 消息编译", () => {
    it("编译文本、reply 与结构化 quick replies", async () => {
        const upload = vi.fn();
        await expect(
            compileMessengerMessage(
                [
                    { type: "reply", data: { id: "m0" } },
                    { type: "text", data: { text: "Hello " } },
                    { type: "text", data: { text: "World" } },
                    {
                        type: "messenger_quick_replies",
                        data: {
                            items: [{ content_type: "text", title: "Yes", payload: "YES" }],
                        },
                    },
                ],
                { upload },
            ),
        ).resolves.toEqual({
            text: "Hello World",
            reply_to: { mid: "m0" },
            quick_replies: [{ content_type: "text", title: "Yes", payload: "YES" }],
        });
        expect(upload).not.toHaveBeenCalled();
    });

    it("直接使用 HTTPS 媒体，多图使用官方 attachments 数组", async () => {
        const message = await compileMessengerMessage(
            [
                { type: "image", data: { url: "https://cdn.example/a.png" } },
                { type: "image", data: { attachment_id: "saved" } },
            ],
            { upload: vi.fn() },
        );
        expect(message).toEqual({
            attachments: [
                {
                    type: "image",
                    payload: { url: "https://cdn.example/a.png", is_reusable: false },
                },
                { type: "image", payload: { attachment_id: "saved" } },
            ],
        });
    });

    it("只把明确 base64 交给 Attachment Upload，不读取路径", async () => {
        const upload = vi.fn().mockResolvedValue("attachment");
        await expect(
            compileMessengerMessage(
                [
                    {
                        type: "audio",
                        data: {
                            data: `data:audio/mpeg;base64,${Buffer.from("audio").toString("base64")}`,
                            name: "voice.mp3",
                        },
                    },
                ],
                { upload },
            ),
        ).resolves.toEqual({
            attachment: { type: "audio", payload: { attachment_id: "attachment" } },
        });
        expect(upload).toHaveBeenCalledWith(
            "audio",
            expect.objectContaining({ filename: "voice.mp3" }),
            false,
        );
        await expect(
            compileMessengerMessage([{ type: "file", data: { path: "/etc/passwd" } }], {
                upload,
            }),
        ).rejects.toThrow(/不读取宿主本地路径/u);
    });

    it("拒绝会产生多个 message_id 的文本媒体混合和非图片多附件", async () => {
        const uploader = { upload: vi.fn() };
        await expect(
            compileMessengerMessage(
                [
                    { type: "text", data: { text: "caption" } },
                    { type: "image", data: { url: "https://cdn.example/a.png" } },
                ],
                uploader,
            ),
        ).rejects.toThrow(/拆成两条/u);
        await expect(
            compileMessengerMessage(
                [
                    { type: "video", data: { url: "https://cdn.example/a.mp4" } },
                    { type: "video", data: { url: "https://cdn.example/b.mp4" } },
                ],
                uploader,
            ),
        ).rejects.toThrow(/只支持最多 30 张图片/u);
    });

    it("无损投影文本、附件、quick reply、reply 与 referral", () => {
        expect(
            projectWebhookMessage({
                text: "hello",
                reply_to: { mid: "m0" },
                quick_reply: { payload: "YES" },
                referral: { ref: "campaign" },
                attachments: [{ type: "image", payload: { url: "https://cdn.example/a" } }],
            }),
        ).toEqual([
            { type: "reply", data: { id: "m0" } },
            { type: "text", data: { text: "hello" } },
            {
                type: "image",
                data: {
                    url: "https://cdn.example/a",
                    messenger_attachment: {
                        type: "image",
                        payload: { url: "https://cdn.example/a" },
                    },
                },
            },
            { type: "messenger_quick_reply", data: { payload: "YES" } },
            { type: "messenger_referral", data: { ref: "campaign" } },
        ]);
    });
});
