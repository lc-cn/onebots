import { describe, expect, it } from "vitest";
import { compileKfMessages } from "./messages.js";

describe("compileKfMessages", () => {
    it("保留文本、媒体、链接与位置顺序", () => {
        expect(
            compileKfMessages([
                "hello",
                { type: "image", data: { file_id: "media-1" } },
                {
                    type: "link",
                    data: { title: "Docs", url: "https://example.com", thumb_media_id: "thumb" },
                },
                { type: "location", data: { latitude: 1, longitude: 2, name: "Office" } },
            ]),
        ).toEqual([
            { msgtype: "text", text: { content: "hello" } },
            { msgtype: "image", image: { media_id: "media-1" } },
            {
                msgtype: "link",
                link: {
                    title: "Docs",
                    desc: undefined,
                    url: "https://example.com",
                    thumb_media_id: "thumb",
                },
            },
            {
                msgtype: "location",
                location: { name: "Office", address: undefined, latitude: 1, longitude: 2 },
            },
        ]);
    });

    it("原生段不能覆盖发送目标或消息 ID", () => {
        const data = new Proxy(
            {
                msgtype: "msgmenu",
                touser: "forged",
                open_kfid: "forged",
                msgid: "forged",
                msgmenu: { head_content: "Choose" },
            },
            {},
        );
        expect(
            compileKfMessages([
                {
                    type: "wecom_kf_message",
                    data,
                },
            ])[0],
        ).toEqual({ msgtype: "msgmenu", msgmenu: { head_content: "Choose" } });
    });

    it("拒绝媒体 URL 占位降级和未知消息段", () => {
        expect(() =>
            compileKfMessages([{ type: "image", data: { url: "https://example.com/a.png" } }]),
        ).toThrowError(expect.objectContaining({ code: "WECOM_KF_INVALID_MESSAGE" }));
        expect(() => compileKfMessages([{ type: "at", data: { user_id: "u1" } }])).toThrow();
    });
});
