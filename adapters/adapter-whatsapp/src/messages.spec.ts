import { describe, expect, it, vi } from "vitest";
import { compileWhatsAppMessages } from "./messages.js";

const compiler = {
    upload: async () => ({ id: "uploaded-media" }),
};

describe("WhatsApp 消息编译", () => {
    it("不会在首个媒体段后丢弃剩余消息", async () => {
        const result = await compileWhatsAppMessages(
            "86123",
            [
                { type: "text", data: { text: "before" } },
                { type: "image", data: { url: "https://example.com/a.png" } },
                { type: "text", data: { text: "after" } },
            ],
            compiler,
        );
        expect(result.map(message => message.type)).toEqual(["text", "image", "text"]);
        expect(result[2]?.text?.body).toBe("after");
    });

    it("支持回复、媒体 ID、联系人与原生消息", async () => {
        const result = await compileWhatsAppMessages(
            "86123",
            [
                { type: "reply", data: { message_id: "wamid.old" } },
                { type: "sticker", data: { media_id: "media" } },
                {
                    type: "contacts",
                    data: { contacts: [{ name: { formatted_name: "Alice" } }] },
                },
                {
                    type: "whatsapp_message",
                    data: { message: { type: "template", template: { name: "hello" } } },
                },
            ],
            compiler,
        );
        expect(result).toMatchObject([
            { type: "sticker", context: { message_id: "wamid.old" }, sticker: { id: "media" } },
            { type: "contacts", context: { message_id: "wamid.old" } },
            { type: "template", context: { message_id: "wamid.old" }, template: { name: "hello" } },
        ]);
    });

    it("上传本地或 Base64 媒体，并直接支持 template/interactive 段", async () => {
        const upload = vi.fn().mockResolvedValue({ id: "uploaded" });
        const result = await compileWhatsAppMessages(
            "86123",
            [
                { type: "image", data: { file: "base64://aW1hZ2U=", name: "image.png" } },
                { type: "template", data: { name: "hello", language: { code: "en_US" } } },
                { type: "interactive", data: { type: "button", body: { text: "选择" } } },
            ],
            { upload },
        );
        expect(upload).toHaveBeenCalledWith(expect.any(Blob), "image/png", "image.png");
        expect(result).toMatchObject([
            { type: "image", image: { id: "uploaded" } },
            { type: "template", template: { name: "hello" } },
            { type: "interactive", interactive: { type: "button" } },
        ]);
    });

    it("上传前拒绝 Cloud API 不支持的媒体 MIME 类型", async () => {
        await expect(
            compileWhatsAppMessages(
                "86123",
                [{ type: "image", data: { file: "base64://aW1hZ2U=", mime_type: "image/gif" } }],
                compiler,
            ),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_SEGMENT" });
    });
});
