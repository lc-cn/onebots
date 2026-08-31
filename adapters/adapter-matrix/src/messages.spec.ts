import { describe, expect, it } from "vitest";
import { compileMatrixMessages, projectMatrixMessageContent } from "./messages.js";

describe("Matrix 消息编译", () => {
    it("合并文本、提及与 emoji 为带 fallback 的 formatted_body", () => {
        expect(
            compileMatrixMessages([
                { type: "text", data: { text: "Hi " } },
                { type: "at", data: { user_id: "@alice:example.com", name: "Alice" } },
                { type: "emoji", data: { emoji: " 👋" } },
            ]),
        ).toEqual([
            {
                msgtype: "m.text",
                body: "Hi Alice 👋",
                format: "org.matrix.custom.html",
                formatted_body: 'Hi <a href="https://matrix.to/#/@alice:example.com">Alice</a> 👋',
            },
        ]);
    });

    it("媒体必须使用先上传得到的 mxc URI", () => {
        expect(
            compileMatrixMessages([
                { type: "image", data: { file: "mxc://hs/id", name: "a.png" } },
            ]),
        ).toEqual([{ msgtype: "m.image", body: "a.png", url: "mxc://hs/id", info: undefined }]);
        expect(() =>
            compileMatrixMessages([{ type: "image", data: { url: "https://example.com/a.png" } }]),
        ).toThrow(/upload_file/u);
    });

    it("接收端保留 Matrix 媒体 info 与 HTML fallback", () => {
        expect(
            projectMatrixMessageContent({
                msgtype: "m.file",
                body: "a.txt",
                url: "mxc://hs/id",
                info: { size: 2 },
            }),
        ).toEqual([
            {
                type: "file",
                data: { file: "mxc://hs/id", url: "mxc://hs/id", name: "a.txt", info: { size: 2 } },
            },
        ]);
    });
});
