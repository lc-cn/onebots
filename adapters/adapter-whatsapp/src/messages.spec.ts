import { describe, expect, it } from "vitest";
import { compileWhatsAppMessages } from "./messages.js";

describe("WhatsApp 消息编译", () => {
    it("不会在首个媒体段后丢弃剩余消息", () => {
        const result = compileWhatsAppMessages("86123", [
            { type: "text", data: { text: "before" } },
            { type: "image", data: { url: "https://example.com/a.png" } },
            { type: "text", data: { text: "after" } },
        ]);
        expect(result.map(message => message.type)).toEqual(["text", "image", "text"]);
        expect(result[2]?.text?.body).toBe("after");
    });

    it("支持回复、媒体 ID、联系人与原生消息", () => {
        const result = compileWhatsAppMessages("86123", [
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
        ]);
        expect(result).toMatchObject([
            { type: "sticker", context: { message_id: "wamid.old" }, sticker: { id: "media" } },
            { type: "contacts" },
            { type: "template", template: { name: "hello" } },
        ]);
    });

    it("对不可发送的本地媒体路径给出显式错误", () => {
        expect(() =>
            compileWhatsAppMessages("86123", [{ type: "image", data: { file: "/tmp/a.png" } }]),
        ).toThrow(/media_id|HTTPS/u);
    });
});
