import { describe, expect, it } from "vitest";
import { ErrorCategory } from "onebots";
import { SlackError } from "./errors.js";
import { compileSlackMessage, slackUploadMessageTimestamp } from "./messages.js";

describe("Slack message compiler", () => {
    it("编译文本、提及、线程与原生附件", () => {
        expect(
            compileSlackMessage([
                { type: "text", data: { text: "hello " } },
                { type: "at", data: { user_id: "U1" } },
                { type: "reply", data: { message_id: "1.2" } },
                {
                    type: "image",
                    data: { file: "base64://aW1hZ2U=", name: "image.png", alt: "截图" },
                },
            ]),
        ).toEqual({
            text: "hello <@U1> ",
            options: { thread_ts: "1.2" },
            files: [
                {
                    source: "base64://aW1hZ2U=",
                    filename: "image.png",
                    contentType: undefined,
                    title: "image.png",
                    altText: "截图",
                },
            ],
        });
    });

    it("支持原生 Block Kit 并拒绝未知段", () => {
        expect(
            compileSlackMessage([
                {
                    type: "slack_message",
                    data: { body: { text: "fallback", blocks: [{ type: "divider" }] } },
                },
            ]),
        ).toMatchObject({ text: "fallback", options: { blocks: [{ type: "divider" }] } });
        let error: unknown;
        try {
            compileSlackMessage([{ type: "unknown", data: {} }]);
        } catch (cause) {
            error = cause;
        }
        expect(error).toBeInstanceOf(SlackError);
        expect(error).toMatchObject({
            code: "SLACK_MESSAGE_SEGMENT_UNSUPPORTED",
            category: ErrorCategory.VALIDATION,
            context: { details: { segment_type: "unknown" } },
        });
    });

    it("拒绝会让 Slack 静默丢弃 Block Kit 的文件组合", () => {
        expect(() =>
            compileSlackMessage([
                { type: "text", data: { text: "正文" } },
                { type: "image", data: { file: "base64://aW1hZ2U=" } },
                { type: "slack_message", data: { body: { blocks: [{ type: "divider" }] } } },
            ]),
        ).toThrow("不能同时发送正文与 Block Kit");
    });

    it("从 filesUploadV2 的嵌套 share 中提取真实消息时间戳", () => {
        expect(
            slackUploadMessageTimestamp({
                files: [{ files: [{ shares: { public: { C1: [{ ts: "171.0001" }] } } }] }],
            }),
        ).toBe("171.0001");
    });
});
