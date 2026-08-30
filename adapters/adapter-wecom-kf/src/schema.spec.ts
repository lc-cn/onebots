import { describe, expect, test } from "vitest";
import type { Schema } from "onebots";
import { wecomKfSchema } from "./index.js";

describe("微信客服配置 Schema", () => {
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

    test("补偿轮询间隔只在启用时显示", () => {
        expect(ruleAt("sync_poll_interval_ms").ui?.visibleWhen).toEqual({
            path: "enable_sync_poll",
            oneOf: [true],
        });
        expect(ruleAt("receive_mode").choices).toContainEqual({
            value: "manual",
            label: "手动接入既有 Host/同步器",
        });
    });
});

function ruleAt(path: string) {
    let node: Schema | Schema[string] = wecomKfSchema;
    for (const part of path.split(".")) node = (node as Schema)[part]!;
    if (!("type" in node)) throw new Error(`微信客服 Schema 字段不存在: ${path}`);
    return node;
}
