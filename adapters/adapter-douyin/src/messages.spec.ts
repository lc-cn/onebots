import type { MessageEvent } from "douyin-im";
import { describe, expect, it } from "vitest";
import type { CommonTypes } from "onebots";
import { compileDouyinMessage, projectDouyinSegments } from "./messages.js";

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

    it("拒绝把未实现的发送段伪装成文本", () => {
        expect(() =>
            compileDouyinMessage([{ type: "video", data: { file: "video.mp4" } }], String),
        ).toThrow("抖音发送暂不支持消息段 video");
    });
});
