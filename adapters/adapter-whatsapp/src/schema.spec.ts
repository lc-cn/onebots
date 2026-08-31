import { describe, expect, test } from "vitest";
import type { Schema } from "onebots";
import { whatsappSchema } from "./index.js";

describe("WhatsApp 配置 Schema", () => {
    test("按接收模式动态展示 Webhook 配置", () => {
        for (const field of ["app_secret", "webhook_verify_token", "webhook_path"]) {
            expect(ruleAt(field).ui?.visibleWhen).toEqual({
                path: "receive_mode",
                oneOf: ["webhook"],
            });
        }
    });

    test("提供 manual 模式并限制 Graph API Origin", () => {
        expect(ruleAt("receive_mode").choices).toContainEqual({
            value: "manual",
            label: "手动接入既有 Host/队列",
        });
        expect(ruleAt("api_base_url").pattern?.test("https://graph.facebook.com")).toBe(true);
        expect(ruleAt("api_base_url").pattern?.test("https://graph.facebook.com/v23.0")).toBe(
            false,
        );
    });
});

function ruleAt(path: string) {
    let node: Schema | Schema[string] = whatsappSchema;
    for (const part of path.split(".")) node = (node as Schema)[part]!;
    if (!("type" in node)) throw new Error(`WhatsApp Schema 字段不存在: ${path}`);
    return node;
}
