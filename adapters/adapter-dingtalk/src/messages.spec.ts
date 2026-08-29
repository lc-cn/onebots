import { describe, expect, it } from "vitest";
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
});
