import type { MessageEvent } from "douyin-im";
import { describe, expect, it, vi } from "vitest";
import type { CommonTypes } from "onebots";
import { compileDouyinMessage, projectDouyinSegments } from "./messages.js";

vi.mock("douyin-im/protocol", () => ({
    parseMessageContent: (content: string) => ({ kind: "text", text: content, aweType: 0 }),
}));

const createId = (source: string | number): CommonTypes.Id => ({
    source,
    string: String(source),
    number: Number(source),
});

describe("Douyin 消息转换", () => {
    it("按原位置保留文本与 @ 段", () => {
        const event = {
            text: "你好 @小明 请查收",
            content: { kind: "text", text: "你好 @小明 请查收", aweType: 700 },
            mentions: [{ uid: "42", text: "@小明", location: 3, length: 3 }],
            referenceInfo: undefined,
        } as unknown as Pick<MessageEvent, "content" | "mentions" | "referenceInfo" | "text">;

        expect(projectDouyinSegments(event, createId)).toEqual([
            { type: "text", data: { text: "你好 " } },
            { type: "at", data: { user_id: createId("42"), name: "小明" } },
            { type: "text", data: { text: " 请查收" } },
        ]);
    });

    it("将连续文本与 @ 编译为一次 douyin-im 文本发送", () => {
        const operations = compileDouyinMessage(
            [
                { type: "text", data: { text: "你好 " } },
                { type: "at", data: { user_id: createId("42"), name: "小明" } },
                { type: "text", data: { text: "！" } },
            ],
            value => String((value as CommonTypes.Id).source),
        );

        expect(operations).toEqual([
            [
                { type: "text", text: "你好 " },
                { type: "at", uid: "42", name: "小明" },
                { type: "text", text: "！" },
            ],
        ]);
    });

    it("在图片前后 flush 文本并保持发送顺序", () => {
        expect(
            compileDouyinMessage(
                [
                    { type: "text", data: { text: "前" } },
                    { type: "image", data: { file: "https://example.com/image.png" } },
                    { type: "text", data: { text: "后" } },
                ],
                String,
            ),
        ).toEqual([
            { type: "text", text: "前" },
            { type: "image", data: "https://example.com/image.png" },
            { type: "text", text: "后" },
        ]);
    });

    it("在复合消息中保留纯空白文本，但拒绝只有空白的消息", () => {
        expect(
            compileDouyinMessage(
                [
                    { type: "text", data: { text: "  " } },
                    { type: "at", data: { user_id: createId("42"), name: "小明" } },
                ],
                value => String((value as CommonTypes.Id).source),
            ),
        ).toEqual([
            [
                { type: "text", text: "  " },
                { type: "at", uid: "42", name: "小明" },
            ],
        ]);
        expect(() =>
            compileDouyinMessage([{ type: "text", data: { text: " \n " } }], String),
        ).toThrow("抖音消息内容不能为空");
    });

    it("投影 reply 与图片段", () => {
        const event = {
            text: "图片",
            content: {
                kind: "image",
                text: "图片",
                aweType: 2702,
                image: {
                    oid: "image-1",
                    skey: "secret",
                    md5: "md5",
                    dataSize: 10,
                    width: 640,
                    height: 480,
                    originUrls: [],
                    largeUrls: ["https://example.com/large.png"],
                    mediumUrls: [],
                    thumbUrls: [],
                },
            },
            mentions: [],
            referenceInfo: { refMessageId: "quoted-message" },
        } as unknown as Pick<MessageEvent, "content" | "mentions" | "referenceInfo" | "text">;

        expect(projectDouyinSegments(event, createId)).toEqual([
            { type: "reply", data: { message_id: createId("quoted-message") } },
            {
                type: "image",
                data: {
                    file: "https://example.com/large.png",
                    width: 640,
                    height: 480,
                    douyin: event.content.kind === "image" ? event.content.image : undefined,
                },
            },
        ]);
    });

    it("视频仅保留可验证的平台资源字段，不把内部键冒充 file", () => {
        const video = {
            tkey: "tos/video-key",
            skey: "secret",
            md5: "md5",
            width: 1280,
            height: 720,
            checkPics: [],
        };
        const event = {
            text: "视频",
            content: { kind: "video", text: "视频", aweType: 0, video },
            mentions: [],
            referenceInfo: undefined,
        } as unknown as Pick<MessageEvent, "content" | "mentions" | "referenceInfo" | "text">;

        expect(projectDouyinSegments(event, createId)).toEqual([
            {
                type: "video",
                data: {
                    width: 1280,
                    height: 720,
                    douyin: video,
                },
            },
        ]);
    });

    it("拒绝把未实现的发送段伪装成文本", () => {
        expect(() =>
            compileDouyinMessage([{ type: "video", data: { file: "video.mp4" } }], String),
        ).toThrow("抖音发送暂不支持消息段 video");
    });

    it("拒绝无来源图片、空文本段与非法 @ 用户", () => {
        expect(() => compileDouyinMessage([{ type: "image", data: {} }], String)).toThrow(
            "抖音图片来源必须是非空字符串",
        );
        expect(() => compileDouyinMessage([{ type: "text", data: { text: "" } }], String)).toThrow(
            "抖音text必须是非空字符串",
        );
        expect(() =>
            compileDouyinMessage([{ type: "at", data: { user_id: "not-a-number" } }], String),
        ).toThrow("抖音 @ 用户 ID 必须为数字");
    });
});
