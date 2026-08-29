import { describe, expect, it, vi } from "vitest";
import { sendTelegramMessage } from "./message-sender.js";

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

        expect(sendPhoto).toHaveBeenCalledWith("chat", "photo", { caption: "caption" });
        expect(sendDocument).toHaveBeenCalledWith("chat", "document", {
            caption: undefined,
        });
        expect(messageId).toBe(2);
    });
});
