import { describe, expect, test } from "vitest";
import type { Schema, ValidationRule } from "onebots";
import { lineSchema } from "./index.js";

describe("LINE 配置 Schema", () => {
    test("按接收模式动态显示 Webhook 凭据", () => {
        expect(ruleAt("channel_secret").ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["webhook", "manual"],
        });
        expect(ruleAt("destination").ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["webhook", "manual"],
        });
    });

    test("提供 manual 模式并限制 API Base URL", () => {
        expect(ruleAt("receive_mode").choices).toContainEqual({
            value: "manual",
            label: "手动接入既有 Host/队列",
        });
        expect(ruleAt("api_base_url").pattern?.test("https://api.line.me")).toBe(true);
        expect(ruleAt("api_base_url").pattern?.test("https://api.line.me?token=x")).toBe(false);
    });

    test("渠道令牌凭据有精确字段提示", () => {
        expect(ruleAt("manage_channel_tokens").default).toBe(false);
        expect(ruleAt("channel_id").ui?.visibleWhen).toEqual({
            path: "manage_channel_tokens",
            oneOf: [true],
        });
        expect(ruleAt("channel_id").pattern?.test("1234567890")).toBe(true);
        expect(ruleAt("channel_id").pattern?.test("U123")).toBe(false);
        expect(ruleAt("channel_secret").sensitive).toBe(true);
        expect(ruleAt("channel_secret").description).toContain("令牌签发");
    });
});

function ruleAt(path: string): ValidationRule {
    let node: Schema | ValidationRule = lineSchema;
    for (const part of path.split(".")) node = (node as Schema)[part]!;
    if (!("type" in node)) throw new Error(`LINE Schema 字段不存在: ${path}`);
    return node;
}
