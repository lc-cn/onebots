import { describe, expect, it } from "vitest";
import { compileICQQMessage, projectICQQMessageSegments } from "./messages.js";

describe("ICQQ 消息编译", () => {
    it("保留 Milky 投影所需的超级表情和贴纸语义", () => {
        expect(
            compileICQQMessage([
                { type: "face", data: { id: "66", is_large: true } },
                {
                    type: "image",
                    data: { file: "base64://aGVsbG8=", asface: true, summary: "[贴纸]" },
                },
            ]),
        ).toMatchObject([
            { type: "face", id: 66, big: true },
            { type: "image", asface: true, summary: "[贴纸]" },
        ]);
    });
    it("拒绝静默丢弃未知发送段", () => {
        expect(() => compileICQQMessage([{ type: "unknown", data: {} }])).toThrow(
            "ICQQ 不支持消息段 unknown",
        );
    });

    it("支持受控原生元素并保留未知接收元素", () => {
        expect(
            compileICQQMessage([{ type: "icqq", data: { element: { type: "poke", id: 1 } } }]),
        ).toEqual([{ type: "poke", id: 1 }]);
        expect(
            projectICQQMessageSegments([
                { type: "icqq_raw", data: { type: "markdown", content: "# title" } },
            ]),
        ).toEqual([
            {
                type: "icqq_raw",
                data: { element: { type: "markdown", content: "# title" } },
            },
        ]);
    });

    it("严格校验 Base64 媒体与整数 ID", () => {
        expect(() =>
            compileICQQMessage([{ type: "image", data: { file: "base64://***" } }]),
        ).toThrow("无效 Base64");
        expect(() => compileICQQMessage([{ type: "face", data: { id: "x" } }])).toThrow("安全整数");
    });

    it("使用独立 tiny_id 编译频道提及，并保持分享字段顺序", () => {
        expect(
            compileICQQMessage([
                { type: "at", data: { id: "tiny-user" } },
                {
                    type: "share",
                    data: {
                        url: "https://example.com",
                        title: "OneBots",
                        image: "https://example.com/cover.png",
                        content: "统一 IM 网关",
                        audio: "https://example.com/audio.mp3",
                    },
                },
            ]),
        ).toEqual([
            { type: "at", qq: 0, id: "tiny-user", text: undefined, dummy: undefined },
            {
                type: "share",
                url: "https://example.com",
                title: "OneBots",
                image: "https://example.com/cover.png",
                content: "统一 IM 网关",
                audio: "https://example.com/audio.mp3",
            },
        ]);
    });

    it("编译 ICQQ 原生可表达的丰富 canonical 消息段", () => {
        expect(
            compileICQQMessage([
                { type: "flash", data: { file: "https://example.com/flash.jpg" } },
                { type: "rps", data: { id: 2 } },
                { type: "dice", data: { id: 6 } },
                {
                    type: "location",
                    data: { lat: 23.1, lng: 113.2, address: "广州" },
                },
                { type: "poke", data: { id: 1 } },
                { type: "markdown", data: { content: "# OneBots" } },
                {
                    type: "forward",
                    data: { forward_id: "resource", filename: "聊天记录" },
                },
                {
                    type: "node",
                    data: {
                        user_id: 10001,
                        nickname: "Alice",
                        message: [{ type: "text", data: { text: "hello" } }],
                    },
                },
            ]),
        ).toMatchObject([
            { type: "flash" },
            { type: "rps", id: 2 },
            { type: "dice", id: 6 },
            { type: "location", lat: 23.1, lng: 113.2, address: "广州" },
            { type: "poke", id: 1 },
            { type: "markdown", content: "# OneBots" },
            { type: "multimsg", resid: "resource", filename: "聊天记录" },
            { type: "node", user_id: 10001, nickname: "Alice", message: ["hello"] },
        ]);
    });

    it("将丰富原生消息段投影回 canonical 语义", () => {
        expect(
            projectICQQMessageSegments([
                { type: "flash", file: "flash", url: "https://example.com/flash.jpg" },
                { type: "location", lat: 1, lng: 2, address: "地址" },
                { type: "markdown", content: "# title" },
                {
                    type: "multimsg",
                    resid: "resource",
                    filename: "MultiMsg",
                    preview: ["Alice: hello"],
                },
                { type: "file", file: "file", fid: "fid", name: "demo.txt", size: 5 },
            ]),
        ).toEqual([
            {
                type: "flash",
                data: { file: "flash", url: "https://example.com/flash.jpg", name: undefined },
            },
            {
                type: "location",
                data: { lat: 1, lng: 2, address: "地址", id: undefined },
            },
            { type: "markdown", data: { content: "# title" } },
            {
                type: "forward",
                data: {
                    forward_id: "resource",
                    filename: "MultiMsg",
                    preview: ["Alice: hello"],
                    title: undefined,
                    summary: undefined,
                    prompt: undefined,
                },
            },
            {
                type: "file",
                data: {
                    file: "file",
                    file_id: "fid",
                    file_name: "demo.txt",
                    file_size: 5,
                    md5: undefined,
                    sha1: undefined,
                },
            },
        ]);
    });

    it("保留 QQNT 媒体元数据、按钮、论坛和引用节点", () => {
        expect(
            projectICQQMessageSegments([
                {
                    type: "image",
                    file: "image-file",
                    url: "https://example.com/image.jpg",
                    md5: "image-md5",
                    sha1: "image-sha1",
                    width: 640,
                    height: 480,
                    size: 1024,
                    summary: "[图片]",
                    nt: true,
                },
                { type: "button", content: { appid: 1, rows: [] } },
                { type: "forum", id: "post-1", create_time: 100 },
                {
                    type: "quote",
                    user_id: 10001,
                    time: 100,
                    seq: 2,
                    rand: 3,
                    message: ["quoted", { type: "face", id: 66, big: true }],
                },
                {
                    type: "node",
                    user_id: 10002,
                    nickname: "Bob",
                    message: "forwarded",
                },
            ]),
        ).toMatchObject([
            {
                type: "image",
                data: {
                    md5: "image-md5",
                    sha1: "image-sha1",
                    width: 640,
                    height: 480,
                    size: 1024,
                    summary: "[图片]",
                    nt: true,
                },
            },
            { type: "button", data: { content: { appid: 1, rows: [] } } },
            { type: "forum", data: { id: "post-1", create_time: 100 } },
            {
                type: "quote",
                data: {
                    user_id: 10001,
                    message: [
                        { type: "text", data: { text: "quoted" } },
                        { type: "face", data: { id: "66", is_large: true } },
                    ],
                },
            },
            {
                type: "node",
                data: {
                    user_id: 10002,
                    nickname: "Bob",
                    message: [{ type: "text", data: { text: "forwarded" } }],
                },
            },
        ]);
    });
});
