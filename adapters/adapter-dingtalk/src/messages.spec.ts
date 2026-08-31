import { describe, expect, it } from "vitest";
import { ErrorCategory } from "onebots";
import { DingTalkError } from "./errors.js";
import { buildDingTalkOutboundMessage } from "./messages.js";

describe("buildDingTalkOutboundMessage", () => {
    it("编译 Markdown 与 @ 为企业机器人和 Webhook 共用结构", () => {
        expect(
            buildDingTalkOutboundMessage([
                { type: "markdown", data: { title: "标题", text: "**正文**" } },
                { type: "at", data: { user_id: "user_1" } },
            ]),
        ).toMatchObject({
            msgKey: "sampleMarkdown",
            msgParam: { title: "标题", text: "**正文**" },
            atUserIds: ["user_1"],
            webhook: {
                msgtype: "markdown",
                markdown: { title: "标题", text: "**正文**" },
                at: { atUserIds: ["user_1"], isAtAll: false },
            },
        });
    });

    it("还原统一用户 ID，并拒绝未知或有损组合", () => {
        expect(
            buildDingTalkOutboundMessage(
                [
                    { type: "text", data: { text: "你好" } },
                    { type: "at", data: { user_id: { string: "mapped" } } },
                ],
                { resolveUserId: value => `raw-${value}` },
            ),
        ).toMatchObject({ msgParam: { content: "你好" }, atUserIds: ["raw-mapped"] });
        expectError(
            () => buildDingTalkOutboundMessage([{ type: "unknown", data: {} }]),
            "DINGTALK_MESSAGE_SEGMENT_UNSUPPORTED",
        );
        expect(() =>
            buildDingTalkOutboundMessage([
                { type: "text", data: { text: "图片" } },
                { type: "image", data: { url: "https://example.com/a.png" } },
            ]),
        ).toThrow("无法在单条消息中无损混合");
    });

    it("校验远程资源 URL 与空消息", () => {
        expect(() =>
            buildDingTalkOutboundMessage([{ type: "image", data: { url: "file:///tmp/a.png" } }]),
        ).toThrow("HTTP(S) URL");
        expect(() => buildDingTalkOutboundMessage([{ type: "text", data: {} }])).toThrow(
            "内容不能为空",
        );
    });
});

function expectError(run: () => unknown, code: string): void {
    try {
        run();
        throw new Error("预期钉钉消息编译失败");
    } catch (error) {
        expect(error).toBeInstanceOf(DingTalkError);
        expect(error).toMatchObject({ code, category: ErrorCategory.VALIDATION });
    }
}
