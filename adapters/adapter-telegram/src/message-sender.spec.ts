import { describe, expect, it, vi } from "vitest";
import { compileTelegramEditableText, sendTelegramMessage } from "./message-sender.js";

describe("sendTelegramMessage", () => {
    it("发送同一通用消息中的多个媒体段并仅给首段添加 caption", async () => {
        const sendPhoto = vi.fn().mockResolvedValue({ message_id: 1 });
        const sendDocument = vi.fn().mockResolvedValue({ message_id: 2 });
        const bot = { sendPhoto, sendDocument } as never;

        const messageId = await sendTelegramMessage(bot, "chat", [
            { type: "text", data: { text: "caption" } },
            { type: "image", data: { file: "photo" } },
            { type: "file", data: { file: "document" } },
        ]);

        expect(sendPhoto).toHaveBeenCalledWith("chat", "photo", {
            caption: "caption",
            caption_entities: undefined,
        });
        expect(sendDocument).toHaveBeenCalledWith("chat", "document", {
            caption: undefined,
            caption_entities: undefined,
        });
        expect(messageId).toBe(2);
    });

    it("上传 Base64 媒体、还原统一用户 ID 并拒绝未知段", async () => {
        const sendPhoto = vi.fn().mockResolvedValue({ message_id: 3 });
        const bot = { sendPhoto } as never;
        await sendTelegramMessage(
            bot,
            "chat",
            [
                { type: "at", data: { user_id: { string: "mapped" } } },
                { type: "image", data: { file: "base64://aW1hZ2U=", name: "image.png" } },
            ],
            { resolveUserId: () => "42" },
        );
        expect(sendPhoto).toHaveBeenCalledWith(
            "chat",
            expect.anything(),
            expect.objectContaining({
                caption: "@42 ",
                caption_entities: [
                    {
                        type: "text_link",
                        offset: 0,
                        length: 3,
                        url: "tg://user?id=42",
                    },
                ],
            }),
        );
        await expect(
            sendTelegramMessage(bot, "chat", [{ type: "unknown", data: {} }]),
        ).rejects.toThrow("不支持消息段 unknown");
    });

    it("更新文本拒绝静默丢弃媒体段", () => {
        expect(
            compileTelegramEditableText(
                [
                    { type: "text", data: { text: "hello " } },
                    { type: "at", data: { user_id: "mapped" } },
                ],
                { resolveUserId: value => `raw-${value}` },
            ),
        ).toBe("hello @raw-mapped ");
        expect(() =>
            compileTelegramEditableText([{ type: "image", data: { file: "photo" } }], {
                resolveUserId: String,
            }),
        ).toThrow("文本更新不支持消息段 image");
    });

    it("非 caption 媒体不会吞掉相邻文本", async () => {
        const sendSticker = vi.fn().mockResolvedValue({ message_id: 1 });
        const sendMessage = vi.fn().mockResolvedValue({ message_id: 2 });
        const bot = {
            getBot: () => ({ api: { sendSticker } }),
            callApi: async (_method: string, task: () => Promise<unknown>) => task(),
            sendMessage,
        } as never;

        await expect(
            sendTelegramMessage(bot, "chat", [
                { type: "text", data: { text: "keep me" } },
                { type: "sticker", data: { file: "sticker-id" } },
            ]),
        ).resolves.toBe(2);
        expect(sendMessage).toHaveBeenCalledWith("chat", "keep me", {
            entities: undefined,
        });
    });
});
