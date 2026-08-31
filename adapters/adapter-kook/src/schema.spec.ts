import { describe, expect, test } from "vitest";
import type { Schema, ValidationRule } from "onebots";
import { kookSchema } from "./index.js";

describe("KOOK 配置 Schema", () => {
    test("Webhook 凭据只在 Webhook 模式显示", () => {
        expect(ruleAt("verify_token").ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["webhook"],
        });
        expect(ruleAt("encrypt_key").ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["webhook"],
        });
    });

    test("API Base URL 只接受 HTTPS 根地址", () => {
        const pattern = ruleAt("api_base_url").pattern;
        expect(pattern?.test("https://www.kookapp.cn/api")).toBe(true);
        expect(pattern?.test("http://localhost:3000/api")).toBe(false);
        expect(pattern?.test("https://example.test/api?token=secret")).toBe(false);
    });

    test("提供显式 manual 接入模式", () => {
        expect(ruleAt("receive_mode").choices).toContainEqual({
            value: "manual",
            label: "手动接入既有连接",
        });
    });
});

function ruleAt(path: string): ValidationRule {
    let node: Schema | ValidationRule = kookSchema;
    for (const part of path.split(".")) node = (node as Schema)[part]!;
    if (!("type" in node)) throw new Error(`KOOK Schema 字段不存在: ${path}`);
    return node;
}
