import { describe, expect, it } from "vitest";
import { packLiteralReply } from "../outbound/assembler.js";
import { coercePlainMarkdown, formatOutboundText } from "./markdown-lite.js";

describe("微信 ClawBot 出站文本格式", () => {
    const source = [
        "开头",
        "",
        "### 方案 A",
        "> **Hi!** Thanks for asking.",
        "",
        "### 方案 B",
        "> `Hello!` Nice to meet you.",
    ].join("\n");

    it("纯文本模式去除 Markdown 标记但保留段落结构", () => {
        expect(coercePlainMarkdown(source)).toBe(
            [
                "开头",
                "",
                "方案 A",
                "Hi! Thanks for asking.",
                "",
                "方案 B",
                "Hello! Nice to meet you.",
            ].join("\n"),
        );
    });

    it("Markdown 模式原样透传", () => {
        const exactSource = `\n${source}\n`;
        expect(formatOutboundText(exactSource, "markdown")).toBe(exactSource);
        expect(
            packLiteralReply("peer", "context", exactSource, "markdown").msg?.item_list?.[0]
                ?.text_item?.text,
        ).toBe(exactSource);
    });

    it("缺省保持兼容的纯文本模式", () => {
        expect(formatOutboundText(source)).toBe(coercePlainMarkdown(source));
        expect(
            packLiteralReply("peer", "context", source).msg?.item_list?.[0]?.text_item?.text,
        ).toBe(coercePlainMarkdown(source));
    });
});
