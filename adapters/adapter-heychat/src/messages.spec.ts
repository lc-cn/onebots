import { describe, expect, it } from "vitest";
import { HeychatApiError } from "./errors.js";
import { compileHeychatMessage } from "./messages.js";

describe("compileHeychatMessage", () => {
    it("将文本、提及、回复与图片编译为官方 Markdown 请求", () => {
        const message = compileHeychatMessage([
            { type: "reply", data: { id: "msg-1" } },
            { type: "at", data: { id: "42" } },
            { type: "text", data: { text: "你好" } },
            {
                type: "image",
                data: { url: "https://example.com/a.png", width: 320, height: 180 },
            },
        ]);

        expect(message).toMatchObject({
            msg_type: 10,
            msg: "@{id:42} 你好\n\n![](https://example.com/a.png)",
            reply_id: "msg-1",
            at_user_id: "42",
        });
        expect(JSON.parse(message.addition)).toEqual({
            img_files_info: [{ url: "https://example.com/a.png", width: 320, height: 180 }],
        });
    });

    it("将单张图片编译为 msg_type=3", () => {
        expect(
            compileHeychatMessage([
                { type: "image", data: { url: "https://example.com/image.webp" } },
            ]),
        ).toMatchObject({
            msg_type: 3,
            img: "https://example.com/image.webp",
        });
    });

    it("允许原生卡片请求体但拒绝与通用段混用", () => {
        expect(
            compileHeychatMessage([
                {
                    type: "heychat_message",
                    data: { body: { msg_type: 20, msg: '{"data":[]}' } },
                },
            ]),
        ).toEqual({ msg_type: 20, msg: '{"data":[]}', addition: "{}", reply_id: "" });

        expect(() =>
            compileHeychatMessage([
                { type: "heychat_message", data: { body: { msg_type: 20, msg: "{}" } } },
                { type: "text", data: { text: "ambiguous" } },
            ]),
        ).toThrow(HeychatApiError);
    });
});
