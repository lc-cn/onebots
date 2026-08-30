import { describe, expect, test } from "vitest";
import type { Schema } from "onebots";
import { wecomSchema } from "./index.js";

describe("企业微信配置 Schema", () => {
    test("按接收模式动态展示回调配置", () => {
        for (const field of ["token", "encoding_aes_key"]) {
            expect(ruleAt(field).ui?.visibleWhen).toEqual({
                path: "receive_mode",
                oneOf: ["webhook", "manual"],
            });
        }
        expect(ruleAt("webhook_path").ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["webhook"],
        });
    });

    test("提供 manual 模式并限制 API Base URL", () => {
        expect(ruleAt("receive_mode").choices).toContainEqual({
            value: "manual",
            label: "手动接入既有 Host/队列",
        });
        expect(ruleAt("api_base_url").pattern?.test("https://qyapi.weixin.qq.com")).toBe(true);
        expect(ruleAt("api_base_url").pattern?.test("https://qyapi.weixin.qq.com?x=1")).toBe(false);
        expect(ruleAt("directory_secret").sensitive).toBe(true);
        expect(ruleAt("directory_secret").required).not.toBe(true);
    });
});

function ruleAt(path: string) {
    let node: Schema | Schema[string] = wecomSchema;
    for (const part of path.split(".")) node = (node as Schema)[part]!;
    if (!("type" in node)) throw new Error(`企业微信 Schema 字段不存在: ${path}`);
    return node;
}
